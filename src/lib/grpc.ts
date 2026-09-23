import type { EngineField, NetworkSettings } from '../types/api';
import { isTauriRuntime } from './request';

export type GrpcMethodInfo = { name: string; clientStreaming: boolean; serverStreaming: boolean };
export type GrpcServiceInfo = { name: string; methods: GrpcMethodInfo[] };

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new Error('Native gRPC requires the Tauri desktop runtime.');
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

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

export function invokeGrpc(invocation: GrpcInvocation) {
  return invoke<string[]>('invoke_grpc', { invocation });
}
