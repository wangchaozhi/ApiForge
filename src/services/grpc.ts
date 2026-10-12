import type { EngineField } from '../domain/engine.ts';
import type { NetworkSettings } from '../domain/network.ts';
import { cancelApiRequest } from './http/transport.ts';
import { isTauriRuntime } from '../platform/runtime.ts';

export type GrpcMethodInfo = {
  name: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  inputType: string;
  outputType: string;
  requestTemplate: string;
};
export type GrpcServiceInfo = { name: string; methods: GrpcMethodInfo[] };

export { grpcCallKind, type GrpcCallKind } from './protocols.ts';

export const GRPC_DESCRIPTOR_EXTENSIONS = ['proto', 'protoset', 'pb', 'bin', 'desc'];

export type GrpcNativeEvent =
  | { type: 'headers' | 'trailers'; operationId: string; metadata: Record<string, string> }
  | { type: 'message'; operationId: string; data: string };

export type GrpcSummary = { messageCount: number; elapsedMs: number };

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new Error('Native gRPC requires the Tauri desktop runtime.');
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

/** Loads services from a `.proto` source file or a binary FileDescriptorSet. */
export function inspectGrpcDescriptor(path: string) {
  return invoke<GrpcServiceInfo[]>('inspect_grpc_descriptor', { path });
}

export type GrpcInvocation = {
  endpoint: string;
  descriptorPath: string;
  service: string;
  method: string;
  requestJson: string;
  metadata: EngineField[];
  network: NetworkSettings;
};

/**
 * Runs a gRPC call of any kind. Response headers, messages and trailers are delivered through
 * `onEvent` while the call is running. For client-streaming calls `requestJson` (when not
 * blank) is sent as the first message; use `sendGrpcMessage` / `finishGrpcStream` afterwards.
 */
export async function startGrpc(
  invocation: GrpcInvocation,
  operationId: string,
  onEvent: (event: GrpcNativeEvent) => void,
) {
  if (!isTauriRuntime()) throw new Error('Native gRPC requires the Tauri desktop runtime.');
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<GrpcNativeEvent>('apiforge://grpc', ({ payload }) => {
    if (payload.operationId === operationId) onEvent(payload);
  });
  try {
    return await invoke<GrpcSummary>('start_grpc', { operationId, invocation });
  } finally {
    unlisten();
  }
}

export function sendGrpcMessage(operationId: string, requestJson: string) {
  return invoke<void>('send_grpc_message', { operationId, requestJson });
}

export function finishGrpcStream(operationId: string) {
  return invoke<void>('finish_grpc_stream', { operationId });
}

export function cancelGrpc(operationId: string) {
  return cancelApiRequest(operationId);
}
