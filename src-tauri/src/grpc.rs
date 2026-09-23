use std::fs;

use prost::{Message, bytes::Buf};
use prost_reflect::{DescriptorPool, DynamicMessage, MethodDescriptor};
use serde::{Deserialize, Serialize};
use tonic::{
    Request, Status,
    client::Grpc,
    codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder},
    metadata::{Ascii, MetadataKey, MetadataValue},
    transport::{Channel, ClientTlsConfig, Endpoint, Identity},
};

use super::{AppError, EngineField, NetworkSettings};

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
}

fn descriptor_pool(path: &str) -> Result<DescriptorPool, AppError> {
    DescriptorPool::decode(fs::read(path)?.as_slice())
        .map_err(|error| AppError::Protocol(format!("invalid protobuf descriptor set: {error}")))
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

#[derive(Clone)]
struct DynamicCodec {
    output: prost_reflect::MessageDescriptor,
}

struct DynamicEncoder;
struct DynamicDecoder(prost_reflect::MessageDescriptor);

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
            return Ok(None);
        }
        DynamicMessage::decode(self.0.clone(), src)
            .map(Some)
            .map_err(|error| Status::internal(error.to_string()))
    }
}

async fn channel(invocation: &GrpcInvocation) -> Result<Channel, AppError> {
    let mut endpoint = Endpoint::from_shared(invocation.endpoint.clone())
        .map_err(|error| AppError::Protocol(error.to_string()))?
        .connect_timeout(std::time::Duration::from_millis(
            invocation.network.timeout_ms.max(1),
        ))
        .timeout(std::time::Duration::from_millis(
            invocation.network.timeout_ms.max(1),
        ));
    if invocation.endpoint.starts_with("https://") {
        let mut tls = ClientTlsConfig::new().with_native_roots();
        if invocation.network.client_certificate_type == "pem" {
            tls = tls.identity(Identity::from_pem(
                fs::read(invocation.network.client_certificate_path.trim())?,
                fs::read(invocation.network.client_key_path.trim())?,
            ));
        }
        endpoint = endpoint
            .tls_config(tls)
            .map_err(|error| AppError::Protocol(error.to_string()))?;
    }
    endpoint
        .connect()
        .await
        .map_err(|error| AppError::Protocol(error.to_string()))
}

fn request(
    invocation: &GrpcInvocation,
    method: &MethodDescriptor,
) -> Result<Request<DynamicMessage>, AppError> {
    let mut deserializer = serde_json::Deserializer::from_str(&invocation.request_json);
    let message = DynamicMessage::deserialize(method.input(), &mut deserializer)
        .map_err(|error| AppError::Protocol(format!("invalid request JSON: {error}")))?;
    let mut request = Request::new(message);
    for field in &invocation.metadata {
        let key = MetadataKey::<Ascii>::from_bytes(field.key.as_bytes())
            .map_err(|error| AppError::Protocol(error.to_string()))?;
        let value = MetadataValue::try_from(field.value.as_str())
            .map_err(|error| AppError::Protocol(error.to_string()))?;
        request.metadata_mut().insert(key, value);
    }
    Ok(request)
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
                })
                .collect(),
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn invoke_grpc(invocation: GrpcInvocation) -> Result<Vec<String>, AppError> {
    let pool = descriptor_pool(&invocation.descriptor_path)?;
    let method = method(&pool, &invocation.service, &invocation.method)?;
    if method.is_client_streaming() {
        return Err(AppError::Protocol(
            "client and bidirectional streaming require a live message session".into(),
        ));
    }
    let path = format!("/{}/{}", invocation.service, invocation.method)
        .parse()
        .map_err(|error| AppError::Protocol(format!("invalid gRPC path: {error}")))?;
    let codec = DynamicCodec {
        output: method.output(),
    };
    let mut client = Grpc::new(channel(&invocation).await?);
    let request = request(&invocation, &method)?;
    if method.is_server_streaming() {
        let mut stream = client
            .server_streaming(request, path, codec)
            .await
            .map_err(|error| AppError::Protocol(error.to_string()))?
            .into_inner();
        let mut responses = Vec::new();
        while let Some(message) = stream
            .message()
            .await
            .map_err(|error| AppError::Protocol(error.to_string()))?
        {
            responses.push(
                serde_json::to_string_pretty(&message)
                    .map_err(|error| AppError::Protocol(error.to_string()))?,
            );
        }
        Ok(responses)
    } else {
        let message = client
            .unary(request, path, codec)
            .await
            .map_err(|error| AppError::Protocol(error.to_string()))?
            .into_inner();
        Ok(vec![
            serde_json::to_string_pretty(&message)
                .map_err(|error| AppError::Protocol(error.to_string()))?,
        ])
    }
}
