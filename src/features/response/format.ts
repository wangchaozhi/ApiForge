import type { EditorLanguage } from '../../shared/editor/types.ts';

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function headerValue(headers: Record<string, string>, key: string) {
  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return match?.[1] ?? '';
}

export function responseLanguage(contentType: string, body: string): EditorLanguage {
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('html')) return 'html';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('javascript')) return 'javascript';
  if (contentType.includes('css')) return 'css';
  try {
    JSON.parse(body);
    return 'json';
  } catch {
    return 'plaintext';
  }
}

export function prettyBody(body: string, language: EditorLanguage) {
  if (language !== 'json') return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function countMatches(haystack: string, needle: string) {
  if (!needle) return 0;
  const source = haystack.toLowerCase();
  const query = needle.toLowerCase();
  let count = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const index = source.indexOf(query, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + Math.max(1, query.length);
  }
  return count;
}
