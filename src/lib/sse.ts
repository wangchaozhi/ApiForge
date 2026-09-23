import type { EngineRequest } from '../types/api';
import { cancelApiRequest, isTauriRuntime } from './request';

export type SseEvent = {
  event: string;
  data: string;
  id?: string;
  retry?: number;
};

export type SseParserState = {
  buffer: string;
};

export type SseOpened = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
};

type NativeSseEvent =
  | {
      type: 'opened';
      operationId: string;
      status: number;
      statusText: string;
      headers: Record<string, string>;
    }
  | {
      type: 'chunk';
      operationId: string;
      bytes: number[];
    }
  | {
      type: 'closed';
      operationId: string;
    };

type SseHandlers = {
  onOpen?: (opened: SseOpened) => void;
  onEvent?: (event: SseEvent) => void;
  onRawText?: (text: string) => void;
  onClose?: () => void;
};

export function createSseParserState(): SseParserState {
  return { buffer: '' };
}

function normalizeCompletedBlock(block: string) {
  return block.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function parseSseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of normalizeCompletedBlock(block).split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let value = colon >= 0 ? line.slice(colon + 1) : '';
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value || 'message';
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
  }

  if (!data.length) return null;
  return { event, data: data.join('\n'), id, retry };
}

function findBoundary(buffer: string) {
  for (let index = 0; index < buffer.length - 1; index += 1) {
    const first = buffer[index];
    const second = buffer[index + 1];
    if (first === '\n' && second === '\n') return { index, length: 2 };
    if (first === '\r' && second === '\r') return { index, length: 2 };
    if (index < buffer.length - 3
      && buffer.slice(index, index + 4) === '\r\n\r\n') {
      return { index, length: 4 };
    }
  }
  return null;
}

export function pushSseChunk(state: SseParserState, chunk: string) {
  state.buffer += chunk;
  const events: SseEvent[] = [];

  while (true) {
    const boundary = findBoundary(state.buffer);
    if (!boundary) break;
    const block = state.buffer.slice(0, boundary.index);
    state.buffer = state.buffer.slice(boundary.index + boundary.length);
    const event = parseSseBlock(block);
    if (event) events.push(event);
  }

  return events;
}

export function flushSse(state: SseParserState) {
  const block = state.buffer;
  state.buffer = '';
  return block ? parseSseBlock(block) : null;
}

export async function streamSse(
  request: EngineRequest,
  operationId: string,
  handlers: SseHandlers = {},
) {
  if (!isTauriRuntime()) {
    throw new Error('Native SSE streaming requires the Tauri desktop runtime.');
  }

  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);

  const parser = createSseParserState();
  const decoder = new TextDecoder();
  let closed = false;

  const unlisten = await listen<NativeSseEvent>('apiforge://sse', (message) => {
    const payload = message.payload;
    if (payload.operationId !== operationId) return;

    if (payload.type === 'opened') {
      handlers.onOpen?.({
        status: payload.status,
        statusText: payload.statusText,
        headers: payload.headers,
      });
      return;
    }

    if (payload.type === 'chunk') {
      const text = decoder.decode(new Uint8Array(payload.bytes), { stream: true });
      if (!text) return;
      handlers.onRawText?.(text);
      for (const event of pushSseChunk(parser, text)) handlers.onEvent?.(event);
      return;
    }

    const tail = decoder.decode();
    if (tail) {
      handlers.onRawText?.(tail);
      for (const event of pushSseChunk(parser, tail)) handlers.onEvent?.(event);
    }
    const finalEvent = flushSse(parser);
    if (finalEvent) handlers.onEvent?.(finalEvent);
    closed = true;
    handlers.onClose?.();
  });

  try {
    await invoke('start_sse', { operationId, request });
    if (!closed) handlers.onClose?.();
  } finally {
    unlisten();
  }
}

export async function cancelSse(operationId: string) {
  await cancelApiRequest(operationId);
}
