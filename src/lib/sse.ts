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
  lastEventId: string;
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
  return { buffer: '', lastEventId: '' };
}

function parseBlock(state: SseParserState, block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  let retry: number | undefined;
  let nextEventId = state.lastEventId;

  for (const line of block.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let value = colon >= 0 ? line.slice(colon + 1) : '';
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value || 'message';
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) nextEventId = value;
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
  }

  state.lastEventId = nextEventId;
  if (!data.length) return null;

  return {
    event,
    data: data.join('\n'),
    ...(state.lastEventId ? { id: state.lastEventId } : {}),
    ...(retry === undefined ? {} : { retry }),
  };
}

export function pushSseChunk(state: SseParserState, chunk: string) {
  state.buffer += chunk;
  const events: SseEvent[] = [];
  const boundaryPattern = /(?:\r\n|\r|\n)(?:\r\n|\r|\n)/;

  while (true) {
    const boundary = boundaryPattern.exec(state.buffer);
    if (!boundary || boundary.index === undefined) break;
    const block = state.buffer.slice(0, boundary.index);
    state.buffer = state.buffer.slice(boundary.index + boundary[0].length);
    const event = parseBlock(state, block);
    if (event) events.push(event);
  }

  return events;
}

export function flushSse(state: SseParserState) {
  const block = state.buffer;
  state.buffer = '';
  return block ? parseBlock(state, block) : null;
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

  const decoder = new TextDecoder();
  const parser = createSseParserState();
  let closed = false;

  const unlisten = await listen<NativeSseEvent>('apiforge://sse', (event) => {
    const payload = event.payload;
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
      for (const parsed of pushSseChunk(parser, text)) handlers.onEvent?.(parsed);
      return;
    }

    const finalText = decoder.decode();
    if (finalText) {
      handlers.onRawText?.(finalText);
      for (const parsed of pushSseChunk(parser, finalText)) handlers.onEvent?.(parsed);
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
