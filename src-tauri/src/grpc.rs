use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD as BASE64_STANDARD, STANDARD_NO_PAD as BASE64_NO_PAD},
};
use hyper_util::rt::TokioIo;
use prost::{Message, bytes::Buf};
use prost_reflect::{
    DescriptorPool, DynamicMessage, Kind, MessageDescriptor, MethodDescriptor, ReflectMessage,
    SerializeOptions,
    Value,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio_tungstenite::MaybeTlsStream;
use tokio_util::sync::CancellationToken;
use tonic::{
    Request, Status,
    client::Grpc,
    codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder},
    codegen::http::{Uri, uri::PathAndQuery},
    metadata::{
        AsciiMetadataKey, AsciiMetadataValue, BinaryMetadataKey, BinaryMetadataValue,
        KeyAndValueRef, MetadataMap,
    },
    transport::{Channel, Endpoint},
};

use crate::{
    error::AppError,
    models::{EngineField, NetworkSettings},
    state::HttpState,
    transport,
};

const GRPC_EVENT_NAME: &str = "apiforge://grpc";
/// Nested message fields are pre-filled in request templates up to this depth.
const TEMPLATE_DEPTH: usize = 3;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrpcInvocation {
    endpoint: String,
    descriptor_path: String,
    service: String,
    method: String,
    request_json: String,
    metadata: Vec<EngineField>,
    network: NetworkSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrpcServiceInfo {
    name: String,
    methods: Vec<GrpcMethodInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GrpcMethodInfo {
    name: String,
    client_streaming: bool,
    server_streaming: bool,
    input_type: String,
    output_type: String,
    request_template: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrpcSummary {
    message_count: usize,
    elapsed_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum GrpcEvent {
    Headers {
        operation_id: String,
        metadata: HashMap<String, String>,
    },
    Message {
        operation_id: String,
        data: String,
    },
    Trailers {
        operation_id: String,
        metadata: HashMap<String, String>,
    },
}

type StreamSender = (MessageDescriptor, UnboundedSender<DynamicMessage>);

/// Open client-streaming / bidirectional calls, keyed by operation id. Dropping the sender
/// half-closes the request stream.
pub(crate) struct GrpcState {
    streams: Mutex<HashMap<String, StreamSender>>,
}

impl GrpcState {
    pub(crate) fn new() -> Self {
        Self {
            streams: Mutex::new(HashMap::new()),
        }
    }

    fn streams(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, StreamSender>>, AppError> {
        self.streams
            .lock()
            .map_err(|_| AppError::Protocol("gRPC stream lock is poisoned".into()))
    }
}

/// Loads a `.proto` source file (compiled in-process, imports resolved relative to its
/// directory) or a binary `FileDescriptorSet` (`protoc --descriptor_set_out --include_imports`).
fn descriptor_pool(path: &str) -> Result<DescriptorPool, AppError> {
    let file = Path::new(path);
    let is_proto = file
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("proto"));
    if !is_proto {
        return DescriptorPool::decode(fs::read(file)?.as_slice()).map_err(|error| {
            AppError::Protocol(format!("invalid protobuf descriptor set: {error}"))
        });
    }
    let include = file
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = file
        .file_name()
        .ok_or_else(|| AppError::Protocol("invalid .proto path".into()))?;
    let mut compiler = protox::Compiler::new([include])
        .map_err(|error| AppError::Protocol(format!("protobuf compile error: {error}")))?;
    compiler.include_imports(true);
    compiler
        .open_files([name])
        .map_err(|error| AppError::Protocol(format!("protobuf compile error: {error}")))?;
    Ok(compiler.descriptor_pool())
}

fn method(
    pool: &DescriptorPool,
    service: &str,
    method: &str,
) -> Result<MethodDescriptor, AppError> {
    pool.get_service_by_name(service)
        .ok_or_else(|| AppError::Protocol(format!("gRPC service not found: {service}")))?
        .methods()
        .find(|candidate| candidate.name() == method)
        .ok_or_else(|| AppError::Protocol(format!("gRPC method not found: {service}/{method}")))
}

fn fill_template(message: &mut DynamicMessage, depth: usize) {
    if depth >= TEMPLATE_DEPTH {
        return;
    }
    for field in message.descriptor().fields() {
        if field.is_list() || field.is_map() || field.containing_oneof().is_some() {
            continue;
        }
        if let Kind::Message(child) = field.kind() {
            if child.full_name().starts_with("google.protobuf.") {
                continue;
            }
            let mut nested = DynamicMessage::new(child);
            fill_template(&mut nested, depth + 1);
            message.set_field(&field, Value::Message(nested));
        }
    }
}

fn to_json(message: &DynamicMessage, skip_default_fields: bool) -> Result<String, AppError> {
    let mut output = Vec::new();
    let mut serializer = serde_json::Serializer::pretty(&mut output);
    message
        .serialize_with_options(
            &mut serializer,
            &SerializeOptions::new().skip_default_fields(skip_default_fields),
        )
        .map_err(|error| AppError::Protocol(error.to_string()))?;
    String::from_utf8(output).map_err(|error| AppError::Protocol(error.to_string()))
}

fn request_template(input: MessageDescriptor) -> String {
    let mut message = DynamicMessage::new(input);
    fill_template(&mut message, 0);
    to_json(&message, false).unwrap_or_else(|_| "{}".into())
}

fn parse_message(descriptor: MessageDescriptor, json: &str) -> Result<DynamicMessage, AppError> {
    let json = if json.trim().is_empty() { "{}" } else { json };
    let mut deserializer = serde_json::Deserializer::from_str(json);
    let message = DynamicMessage::deserialize(descriptor, &mut deserializer)
        .map_err(|error| AppError::Protocol(format!("invalid request JSON: {error}")))?;
    deserializer
        .end()
        .map_err(|error| AppError::Protocol(format!("invalid request JSON: {error}")))?;
    Ok(message)
}

/// Copies user metadata into a request. Keys ending in `-bin` carry Base64-encoded binary
/// values as required by the gRPC wire format.
fn apply_metadata(map: &mut MetadataMap, fields: &[EngineField]) -> Result<(), AppError> {
    for field in fields {
        let key = field.key.trim().to_ascii_lowercase();
        if key.ends_with("-bin") {
            let name = BinaryMetadataKey::from_bytes(key.as_bytes())
                .map_err(|_| AppError::InvalidHeaderName(field.key.clone()))?;
            let encoded = field.value.trim();
            let bytes = BASE64_STANDARD
                .decode(encoded)
                .or_else(|_| BASE64_NO_PAD.decode(encoded))
                .map_err(|_| {
                    AppError::Protocol(format!("metadata {key} must be Base64 encoded"))
                })?;
            map.append_bin(name, BinaryMetadataValue::from_bytes(&bytes));
        } else {
            let name = AsciiMetadataKey::from_bytes(key.as_bytes())
                .map_err(|_| AppError::InvalidHeaderName(field.key.clone()))?;
            let value = AsciiMetadataValue::try_from(field.value.as_str())
                .map_err(|_| AppError::InvalidHeaderValue(field.key.clone()))?;
            map.append(name, value);
        }
    }
    Ok(())
}

fn metadata_to_map(map: &MetadataMap) -> HashMap<String, String> {
    let mut result = HashMap::<String, String>::new();
    for entry in map.iter() {
        let (key, value) = match entry {
            KeyAndValueRef::Ascii(key, value) => (
                key.as_str().to_string(),
                value.to_str().unwrap_or("<invalid>").to_string(),
            ),
            KeyAndValueRef::Binary(key, value) => (
                key.as_str().to_string(),
                value
                    .to_bytes()
                    .map(|bytes| BASE64_STANDARD.encode(bytes))
                    .unwrap_or_else(|_| "<invalid>".into()),
            ),
        };
        result
            .entry(key)
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(&value);
            })
            .or_insert(value);
    }
    result
}

fn status_error(status: Status) -> AppError {
    let code = status.code();
    let message = status.message();
    AppError::Protocol(if message.is_empty() {
        format!("gRPC status {code:?} ({})", code as i32)
    } else {
        format!("gRPC status {code:?} ({}): {message}", code as i32)
    })
}

#[derive(Clone)]
struct DynamicCodec {
    output: MessageDescriptor,
}

struct DynamicEncoder;
struct DynamicDecoder(MessageDescriptor);

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder
    }
    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder(self.output.clone())
    }
}

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(dst)
            .map_err(|error| Status::internal(error.to_string()))
    }
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        if !src.has_remaining() {
            // A zero-length frame is a valid, fully defaulted message.
            return Ok(Some(DynamicMessage::new(self.0.clone())));
        }
        DynamicMessage::decode(self.0.clone(), src)
            .map(Some)
            .map_err(|error| Status::internal(error.to_string()))
    }
}

/// Connects a channel through the shared transport so gRPC honours the proxy, TLS
/// verification, and client-certificate settings like every other protocol.
async fn channel(endpoint: &str, network: &NetworkSettings, unary: bool) -> Result<Channel, AppError> {
    let origin: Uri = endpoint
        .trim()
        .parse()
        .map_err(|error| AppError::Protocol(format!("invalid gRPC endpoint: {error}")))?;
    let secure = match origin.scheme_str() {
        Some("http") => false,
        Some("https") => true,
        _ => {
            return Err(AppError::Protocol(
                "gRPC endpoints must start with http:// or https://".into(),
            ));
        }
    };
    let host = origin
        .host()
        .ok_or_else(|| AppError::Protocol("gRPC endpoint has no host".into()))?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = origin.port_u16().unwrap_or(if secure { 443 } else { 80 });
    let authority = origin
        .authority()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| host.clone());

    let timeout = Duration::from_millis(network.timeout_ms.max(1));
    let mut builder = Endpoint::from_shared(format!("http://{authority}"))
        .map_err(|error| AppError::Protocol(error.to_string()))?
        .origin(origin)
        .connect_timeout(timeout);
    if unary {
        // Streams are long-lived; only unary calls get an overall deadline.
        builder = builder.timeout(timeout);
    }

    let tls = if secure {
        Some(tokio_native_tls::TlsConnector::from(
            transport::tls_connector(network, &["h2"])?,
        ))
    } else {
        None
    };
    let network = Arc::new(network.clone());
    let connector = tower::service_fn(move |_: Uri| {
        let network = Arc::clone(&network);
        let tls = tls.clone();
        let host = host.clone();
        async move {
            let tcp = transport::connect_tcp(&host, port, &network)
                .await
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let stream = match tls {
                Some(tls) => MaybeTlsStream::NativeTls(
                    tls.connect(&host, tcp)
                        .await
                        .map_err(|error| std::io::Error::other(error.to_string()))?,
                ),
                None => MaybeTlsStream::Plain(tcp),
            };
            Ok::<_, std::io::Error>(TokioIo::new(stream))
        }
    });
    builder
        .connect_with_connector(connector)
        .await
        .map_err(|error| AppError::Protocol(format!("gRPC connection failed: {error:?}")))
}

type Emit<'a> = &'a (dyn Fn(GrpcEvent) -> Result<(), AppError> + Send + Sync);

struct Call<'a> {
    operation_id: &'a str,
    emit: Emit<'a>,
    messages: usize,
}

impl Call<'_> {
    fn headers(&self, metadata: &MetadataMap) -> Result<(), AppError> {
        (self.emit)(GrpcEvent::Headers {
                operation_id: self.operation_id.to_string(),
            metadata: metadata_to_map(metadata),
        })
    }

    fn message(&mut self, message: &DynamicMessage) -> Result<(), AppError> {
        self.messages += 1;
        (self.emit)(GrpcEvent::Message {
            operation_id: self.operation_id.to_string(),
            data: to_json(message, true)?,
        })
    }

    fn trailers(&self, metadata: Option<MetadataMap>) -> Result<(), AppError> {
        if let Some(metadata) = metadata.filter(|value| !value.is_empty()) {
            (self.emit)(GrpcEvent::Trailers {
                operation_id: self.operation_id.to_string(),
                metadata: metadata_to_map(&metadata),
            })?;
        }
        Ok(())
    }

    async fn drain(&mut self, mut stream: tonic::Streaming<DynamicMessage>) -> Result<(), AppError> {
        while let Some(message) = stream.message().await.map_err(status_error)? {
            self.message(&message)?;
        }
        self.trailers(stream.trailers().await.map_err(status_error)?)
    }
}

async fn execute(
    call: &mut Call<'_>,
    invocation: &GrpcInvocation,
    method: &MethodDescriptor,
    outbound: Option<mpsc::UnboundedReceiver<DynamicMessage>>,
) -> Result<(), AppError> {
    let unary = !method.is_client_streaming() && !method.is_server_streaming();
    let mut client = Grpc::new(channel(&invocation.endpoint, &invocation.network, unary).await?);
    client
        .ready()
        .await
        .map_err(|error| AppError::Protocol(format!("gRPC channel not ready: {error}")))?;
    let path = PathAndQuery::try_from(format!("/{}/{}", invocation.service, invocation.method))
        .map_err(|error| AppError::Protocol(format!("invalid gRPC path: {error}")))?;
    let codec = DynamicCodec {
        output: method.output(),
    };

    if let Some(outbound) = outbound {
        let stream = futures_util::stream::unfold(outbound, |mut receiver| async move {
            receiver.recv().await.map(|message| (message, receiver))
        });
        let mut request = Request::new(stream);
        apply_metadata(request.metadata_mut(), &invocation.metadata)?;
        if method.is_server_streaming() {
            let response = client
                .streaming(request, path, codec)
                .await
                .map_err(status_error)?;
            call.headers(response.metadata())?;
            call.drain(response.into_inner()).await
        } else {
            let response = client
                .client_streaming(request, path, codec)
                .await
                .map_err(status_error)?;
            call.headers(response.metadata())?;
            call.message(response.get_ref())
        }
    } else {
        let message = parse_message(method.input(), &invocation.request_json)?;
        let mut request = Request::new(message);
        apply_metadata(request.metadata_mut(), &invocation.metadata)?;
        if method.is_server_streaming() {
            let response = client
                .server_streaming(request, path, codec)
                .await
                .map_err(status_error)?;
            call.headers(response.metadata())?;
            call.drain(response.into_inner()).await
        } else {
            let response = client
                .unary(request, path, codec)
                .await
                .map_err(status_error)?;
            call.headers(response.metadata())?;
            call.message(response.get_ref())
        }
    }
}

#[tauri::command]
pub(crate) fn inspect_grpc_descriptor(path: String) -> Result<Vec<GrpcServiceInfo>, AppError> {
    let pool = descriptor_pool(&path)?;
    Ok(pool
        .services()
        .map(|service| GrpcServiceInfo {
            name: service.full_name().to_string(),
            methods: service
                .methods()
                .map(|method| GrpcMethodInfo {
                    name: method.name().to_string(),
                    client_streaming: method.is_client_streaming(),
                    server_streaming: method.is_server_streaming(),
                    input_type: method.input().full_name().to_string(),
                    output_type: method.output().full_name().to_string(),
                    request_template: request_template(method.input()),
                })
                .collect(),
        })
        .collect())
}

/// Runs any kind of gRPC call. Response messages stream to the UI as `apiforge://grpc`
/// events; client-streaming calls stay open for `send_grpc_message` until
/// `finish_grpc_stream` half-closes them. Cancel with `cancel_request`.
#[tauri::command]
pub(crate) async fn start_grpc(
    operation_id: String,
    invocation: GrpcInvocation,
    app: AppHandle,
    http_state: State<'_, HttpState>,
    grpc_state: State<'_, GrpcState>,
) -> Result<GrpcSummary, AppError> {
    let pool = descriptor_pool(&invocation.descriptor_path)?;
    let method = method(&pool, &invocation.service, &invocation.method)?;

    let outbound = if method.is_client_streaming() {
        let (sender, receiver) = mpsc::unbounded_channel();
        if !invocation.request_json.trim().is_empty() {
            let first = parse_message(method.input(), &invocation.request_json)?;
            let _ = sender.send(first);
        }
        grpc_state
            .streams()?
            .insert(operation_id.clone(), (method.input(), sender));
        Some(receiver)
    } else {
        None
    };

    let token = CancellationToken::new();
    http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?
        .insert(operation_id.clone(), token.clone());

    let started = Instant::now();
    let emit = |event: GrpcEvent| Ok(app.emit(GRPC_EVENT_NAME, event)?);
    let mut call = Call {
        operation_id: &operation_id,
        emit: &emit,
        messages: 0,
    };
    let result = tokio::select! {
        _ = token.cancelled() => Err(AppError::Cancelled),
        result = execute(&mut call, &invocation, &method, outbound) => result,
    };
    let message_count = call.messages;

    grpc_state.streams()?.remove(&operation_id);
    http_state
        .cancellations
        .lock()
        .map_err(|_| AppError::CancellationLock)?
        .remove(&operation_id);

    result.map(|()| GrpcSummary {
        message_count,
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub(crate) fn send_grpc_message(
    operation_id: String,
    request_json: String,
    grpc_state: State<'_, GrpcState>,
) -> Result<(), AppError> {
    let streams = grpc_state.streams()?;
    let (descriptor, sender) = streams
        .get(&operation_id)
        .ok_or_else(|| AppError::Protocol("gRPC request stream is not open".into()))?;
    let message = parse_message(descriptor.clone(), &request_json)?;
    sender
        .send(message)
        .map_err(|_| AppError::Protocol("gRPC request stream is closed".into()))
}

#[tauri::command]
pub(crate) fn finish_grpc_stream(
    operation_id: String,
    grpc_state: State<'_, GrpcState>,
) -> Result<(), AppError> {
    grpc_state.streams()?.remove(&operation_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROTO: &str = r#"
syntax = "proto3";
package demo.v1;
import "google/protobuf/timestamp.proto";
import "common.proto";

message Point { int32 x = 1; int32 y = 2; }
message Route { string name = 1; Point start = 2; repeated Point stops = 3;
  google.protobuf.Timestamp at = 4; demo.common.Tag tag = 5;
  oneof target { Point end = 6; string place = 7; } }
message Ack { int64 count = 1; }

service Router {
  rpc Get(Route) returns (Ack);
  rpc Watch(Route) returns (stream Ack);
  rpc Upload(stream Point) returns (Ack);
  rpc Chat(stream Point) returns (stream Ack);
}
"#;

    fn write_protos(test: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("apiforge-grpc-{}-{test}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("router.proto"), PROTO).unwrap();
        fs::write(
            dir.join("common.proto"),
            "syntax = \"proto3\";\npackage demo.common;\nmessage Tag { string value = 1; }\n",
        )
        .unwrap();
        dir.join("router.proto")
    }

    #[test]
    fn compiles_proto_sources_with_imports() {
        let path = write_protos("compile");
        let services = inspect_grpc_descriptor(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].name, "demo.v1.Router");
        let kinds = services[0]
            .methods
            .iter()
            .map(|method| (method.name.as_str(), method.client_streaming, method.server_streaming))
            .collect::<Vec<_>>();
        assert_eq!(
            kinds,
            [("Get", false, false), ("Watch", false, true), ("Upload", true, false), ("Chat", true, true)]
        );
    }

    #[test]
    fn decodes_descriptor_sets() {
        let path = write_protos("descriptor-set");
        let pool = descriptor_pool(&path.to_string_lossy()).unwrap();
        let set_path = path.with_extension("protoset");
        fs::write(&set_path, pool.encode_to_vec()).unwrap();
        let decoded = descriptor_pool(&set_path.to_string_lossy()).unwrap();
        assert!(decoded.get_service_by_name("demo.v1.Router").is_some());
        assert!(descriptor_pool(&path.with_extension("missing").to_string_lossy()).is_err());
    }

    #[test]
    fn builds_request_templates_and_parses_json() {
        let pool = descriptor_pool(&write_protos("template").to_string_lossy()).unwrap();
        let get = method(&pool, "demo.v1.Router", "Get").unwrap();
        let template: serde_json::Value =
            serde_json::from_str(&request_template(get.input())).unwrap();
        assert_eq!(template["name"], "");
        assert_eq!(template["start"]["x"], 0);
        assert_eq!(template["tag"]["value"], "");
        assert_eq!(template["stops"], serde_json::json!([]));
        assert!(template.get("end").is_none(), "oneof members are not pre-filled");

        let message = parse_message(get.input(), r#"{"name":"r1","start":{"x":3}}"#).unwrap();
        let json: serde_json::Value = serde_json::from_str(&to_json(&message, true).unwrap()).unwrap();
        assert_eq!(json, serde_json::json!({"name":"r1","start":{"x":3}}));
        assert!(parse_message(get.input(), "  ").is_ok());
        assert!(parse_message(get.input(), r#"{"name":1}"#).is_err());
        assert!(parse_message(get.input(), r#"{} trailing"#).is_err());
        assert!(method(&pool, "demo.v1.Router", "Nope").is_err());
    }

    #[test]
    fn applies_ascii_and_binary_metadata() {
        let mut map = MetadataMap::new();
        apply_metadata(
            &mut map,
            &[
                EngineField { key: "X-Trace".into(), value: "abc".into() },
                EngineField { key: "token-bin".into(), value: "AAEC".into() },
                EngineField { key: "x-trace".into(), value: "def".into() },
            ],
        )
        .unwrap();
        let flattened = metadata_to_map(&map);
        assert_eq!(flattened["x-trace"], "abc, def");
        assert_eq!(flattened["token-bin"], "AAEC");

        let invalid = [EngineField { key: "token-bin".into(), value: "%%%".into() }];
        assert!(apply_metadata(&mut MetadataMap::new(), &invalid).is_err());
    }

    #[test]
    fn formats_status_errors() {
        let error = status_error(Status::unavailable("down"));
        assert_eq!(error.to_string(), "protocol error: gRPC status Unavailable (14): down");
    }

    /// Minimal dynamic `demo.v1.Router` server: `Get` replies with the route name length and
    /// echoes `x-echo` metadata; `Chat` replies to every point with `x + y`.
    mod server {
        use super::*;
        use futures_util::Stream;
        use std::{
            convert::Infallible,
            future::Future,
            pin::Pin,
            task::{Context, Poll},
        };
        use tonic::{body::Body, codegen::http, server::NamedService};

        #[derive(Clone)]
        pub(super) struct Router(pub(super) DescriptorPool);

        impl NamedService for Router {
            const NAME: &'static str = "demo.v1.Router";
        }

        fn ack(pool: &DescriptorPool, count: i64) -> DynamicMessage {
            let mut message =
                DynamicMessage::new(pool.get_message_by_name("demo.v1.Ack").unwrap());
            message.set_field_by_name("count", Value::I64(count));
            message
        }

        fn int(message: &DynamicMessage, name: &str) -> i64 {
            message
                .get_field_by_name(name)
                .and_then(|value| value.as_i32())
                .unwrap_or_default()
                .into()
        }

        type AckStream = Pin<Box<dyn Stream<Item = Result<DynamicMessage, Status>> + Send>>;

        impl tower::Service<http::Request<Body>> for Router {
            type Response = http::Response<Body>;
            type Error = Infallible;
            type Future =
                Pin<Box<dyn Future<Output = Result<Self::Response, Infallible>> + Send>>;

            fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Infallible>> {
                Poll::Ready(Ok(()))
            }

            fn call(&mut self, request: http::Request<Body>) -> Self::Future {
                let pool = self.0.clone();
                Box::pin(async move {
                    let route = pool.get_message_by_name("demo.v1.Route").unwrap();
                    let point = pool.get_message_by_name("demo.v1.Point").unwrap();
                    let path = request.uri().path().to_string();
                    Ok(match path.as_str() {
                        "/demo.v1.Router/Get" => {
                            let service =
                                tower::service_fn(move |request: Request<DynamicMessage>| {
                                    let pool = pool.clone();
                                    async move {
                                        let length = request
                                            .get_ref()
                                            .get_field_by_name("name")
                                            .and_then(|value| value.as_str().map(str::len))
                                            .unwrap_or_default();
                                        let mut response =
                                            tonic::Response::new(ack(&pool, length as i64));
                                        if let Some(echo) = request.metadata().get("x-echo") {
                                            response.metadata_mut().insert("x-echo", echo.clone());
                                        }
                                        Ok::<_, Status>(response)
                                    }
                                });
                            tonic::server::Grpc::new(DynamicCodec { output: route })
                                .unary(service, request)
                                .await
                        }
                        "/demo.v1.Router/Chat" => {
                            let service = tower::service_fn(
                                move |request: Request<tonic::Streaming<DynamicMessage>>| {
                                    let pool = pool.clone();
                                    async move {
                                        let replies = futures_util::stream::unfold(
                                            request.into_inner(),
                                            move |mut inbound| {
                                                let pool = pool.clone();
                                                async move {
                                                    let point =
                                                        inbound.message().await.ok().flatten()?;
                                                    let sum = int(&point, "x") + int(&point, "y");
                                                    Some((Ok(ack(&pool, sum)), inbound))
                                                }
                                            },
                                        );
                                        Ok::<_, Status>(tonic::Response::new(
                                            Box::pin(replies) as AckStream
                                        ))
                                    }
                                },
                            );
                            tonic::server::Grpc::new(DynamicCodec { output: point })
                                .streaming(service, request)
                                .await
                        }
                        _ => Status::unimplemented(path).into_http(),
                    })
                })
            }
        }
    }

    async fn spawn_server(pool: DescriptorPool) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(
            tonic::transport::Server::builder()
                .add_service(server::Router(pool))
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener)),
        );
        port
    }

    fn invocation(
        path: &Path,
        port: u16,
        method: &str,
        request_json: &str,
        proxy: &str,
    ) -> GrpcInvocation {
        GrpcInvocation {
            endpoint: format!("http://127.0.0.1:{port}"),
            descriptor_path: path.to_string_lossy().into_owned(),
            service: "demo.v1.Router".into(),
            method: method.into(),
            request_json: request_json.into(),
            metadata: vec![EngineField {
                key: "x-echo".into(),
                value: "hi".into(),
            }],
            network: crate::transport::tests::network(proxy),
        }
    }

    fn json(data: &str) -> serde_json::Value {
        serde_json::from_str(data).unwrap()
    }

    #[tokio::test]
    async fn invokes_unary_calls_end_to_end() {
        let path = write_protos("e2e-unary");
        let pool = descriptor_pool(&path.to_string_lossy()).unwrap();
        let port = spawn_server(pool.clone()).await;
        let invocation = invocation(&path, port, "Get", r#"{"name":"abcd"}"#, "");
        let method = method(&pool, "demo.v1.Router", "Get").unwrap();

        let events = Mutex::new(Vec::new());
        let emit = |event: GrpcEvent| {
            events.lock().unwrap().push(event);
            Ok(())
        };
        let mut call = Call {
            operation_id: "op",
            emit: &emit,
            messages: 0,
        };
        execute(&mut call, &invocation, &method, None).await.unwrap();
        assert_eq!(call.messages, 1);

        let events = events.into_inner().unwrap();
        assert!(
            matches!(&events[0], GrpcEvent::Headers { metadata, .. } if metadata["x-echo"] == "hi")
        );
        assert!(
            matches!(&events[1], GrpcEvent::Message { data, .. } if json(data) == serde_json::json!({"count": "4"}))
        );
    }

    #[tokio::test]
    async fn streams_bidirectional_calls_through_proxy() {
        let path = write_protos("e2e-bidi");
        let pool = descriptor_pool(&path.to_string_lossy()).unwrap();
        let port = spawn_server(pool.clone()).await;
        let proxy = crate::transport::tests::spawn_connect_proxy(None).await;
        let invocation = invocation(&path, port, "Chat", "", &format!("http://{proxy}"));
        let method = method(&pool, "demo.v1.Router", "Chat").unwrap();

        let (sender, receiver) = mpsc::unbounded_channel();
        sender
            .send(parse_message(method.input(), r#"{"x":1,"y":2}"#).unwrap())
            .unwrap();
        sender
            .send(parse_message(method.input(), r#"{"x":10}"#).unwrap())
            .unwrap();
        drop(sender);

        let events = Mutex::new(Vec::new());
        let emit = |event: GrpcEvent| {
            events.lock().unwrap().push(event);
            Ok(())
        };
        let mut call = Call {
            operation_id: "op",
            emit: &emit,
            messages: 0,
        };
        execute(&mut call, &invocation, &method, Some(receiver))
            .await
            .unwrap();
        assert_eq!(call.messages, 2);

        let counts = events
            .into_inner()
            .unwrap()
            .into_iter()
            .filter_map(|event| match event {
                GrpcEvent::Message { data, .. } => Some(json(&data)["count"].clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(counts, [serde_json::json!("3"), serde_json::json!("10")]);
    }

    #[tokio::test]
    async fn reports_unimplemented_methods_as_status_errors() {
        let path = write_protos("e2e-unimplemented");
        let pool = descriptor_pool(&path.to_string_lossy()).unwrap();
        let port = spawn_server(pool.clone()).await;
        let invocation = invocation(&path, port, "Watch", "{}", "");
        let method = method(&pool, "demo.v1.Router", "Watch").unwrap();
        let emit = |_: GrpcEvent| Ok(());
        let mut call = Call {
            operation_id: "op",
            emit: &emit,
            messages: 0,
        };
        let error = execute(&mut call, &invocation, &method, None)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Unimplemented (12)"), "{error}");
    }

    #[tokio::test]
    async fn rejects_unsupported_endpoints() {
        let network = crate::transport::tests::network("");
        assert!(channel("grpc://localhost:1", &network, true).await.is_err());
        assert!(channel("localhost:50051", &network, true).await.is_err());
    }
}
