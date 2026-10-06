import type { KeyValue } from '../../domain/request.ts';
import { row, type AnyRecord } from './schema.ts';

export function buildUrl(baseUrl: string, path: string, parameters: AnyRecord[]) {
  let url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const params: KeyValue[] = [];
  for (const parameter of parameters) {
    const schema = parameter.schema ?? {};
    const value = parameter.example ?? schema.example ?? schema.default ?? parameter.default ?? '';
    if (parameter.in === 'path') {
      url = url.replace(`{${parameter.name}}`, `{{${parameter.name}}}`);
    } else if (parameter.in === 'query') {
      params.push(row(parameter.name ?? '', String(value)));
    }
  }
  return { url, params: params.length ? params : [row()] };
}

export function openApiBaseUrl(document: AnyRecord) {
  const server = document.servers?.[0]?.url;
  if (server) return String(server).replace(/\{([^{}]+)\}/g, (_match: string, variable: string) => {
    const value = document.servers?.[0]?.variables?.[variable]?.default;
    return value === undefined ? `{{${variable}}}` : String(value);
  });
  if (document.swagger === '2.0') {
    return `${document.schemes?.[0] ?? 'https'}://${document.host ?? 'example.com'}${document.basePath ?? ''}`;
  }
  return 'https://example.com';
}
