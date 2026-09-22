export function createId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}
