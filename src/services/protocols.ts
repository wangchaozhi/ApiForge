// Pure protocol helpers, kept free of runtime imports so they are unit-testable under Node.
import type { MessageKey } from '../i18n/messages.ts';

export type WebSocketSendKind = 'text' | 'binary' | 'ping';

/** RFC 6455 control frames (ping/pong/close) carry at most 125 payload bytes. */
export const MAX_PING_PAYLOAD_BYTES = 125;

/** Binary frames are exchanged with the native engine as Base64 text. */
export function isValidBase64(value: string) {
  const compact = value.replace(/\s+/g, '');
  if (!compact || compact.length % 4 === 1) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

/** Returns a translation key describing why a payload cannot be sent, or null when valid. */
export function validateOutgoing(kind: WebSocketSendKind, data: string): MessageKey | null {
  if (kind === 'binary' && !isValidBase64(data)) return 'Binary payload must be valid Base64.';
  if (kind === 'ping' && new TextEncoder().encode(data).length > MAX_PING_PAYLOAD_BYTES) {
    return 'Ping payload must be at most 125 bytes.';
  }
  if (kind !== 'ping' && !data) return 'Message payload is empty.';
  return null;
}

export type GrpcCallKind = 'unary' | 'serverStreaming' | 'clientStreaming' | 'bidiStreaming';

export function grpcCallKind(method: { clientStreaming: boolean; serverStreaming: boolean }): GrpcCallKind {
  if (method.clientStreaming) return method.serverStreaming ? 'bidiStreaming' : 'clientStreaming';
  return method.serverStreaming ? 'serverStreaming' : 'unary';
}
