import { createId } from '../../lib/id.ts';
import type { KeyValue, MultipartField } from '../../domain/request.ts';

export type AnyRecord = Record<string, any>;

export function row(key = '', value = '', enabled = true): KeyValue {
  return { id: createId('kv'), key, value, enabled };
}

export function multipartRow(key = '', value = '', kind: 'text' | 'file' = 'text'): MultipartField {
  return { ...row(key, value), kind };
}

export function schemaExample(schema: AnyRecord | undefined): unknown {
  if (!schema) return {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.type === 'array') return [schemaExample(schema.items)];
  if (schema.type === 'object' || schema.properties) {
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [key, schemaExample(value as AnyRecord)]),
    );
  }
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  return '';
}

export function resolveRef(document: AnyRecord, value: any): any {
  if (!value?.$ref || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value;
  return value.$ref
    .slice(2)
    .split('/')
    .reduce((current: any, part: string) => current?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], document) ?? value;
}
