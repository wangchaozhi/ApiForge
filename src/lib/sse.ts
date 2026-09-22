export type SseEvent = {
  event: string;
  data: string;
  id?: string;
  retry?: number;
};

export type SseParserState = {
  buffer: string;
};

export function createSseParserState(): SseParserState {
  return { buffer: '' };
}

function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let value = colon >= 0 ? line.slice(colon + 1) : '';
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value || 'message';
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
    else if (field === 'retry') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 0) retry = parsed;
    }
  }

  if (!data.length && id === undefined && retry === undefined && event === 'message') return null;
  return { event, data: data.join('\n'), id, retry };
}

export function pushSseChunk(state: SseParserState, chunk: string) {
  state.buffer += chunk.replace(/\r\n/g, '\n');
  const events: SseEvent[] = [];

  while (true) {
    const boundary = state.buffer.indexOf('\n\n');
    if (boundary < 0) break;
    const block = state.buffer.slice(0, boundary);
    state.buffer = state.buffer.slice(boundary + 2);
    const event = parseBlock(block);
    if (event) events.push(event);
  }

  return events;
}

export function flushSse(state: SseParserState) {
  const block = state.buffer;
  state.buffer = '';
  return block ? parseBlock(block) : null;
}
