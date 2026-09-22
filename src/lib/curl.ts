import { translate as t } from '../i18n';
import { createId } from './id';
import { toEngineRequest } from './request';
import type { ApiRequest, HttpMethod, KeyValue, MultipartField, NetworkSettings } from '../types/api';

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:?=&%+@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function requestToCurl(
  request: ApiRequest,
  variables: Record<string, string>,
  network: NetworkSettings,
) {
  const engine = toEngineRequest(request, variables, network);
  const parts = ['curl'];
  if (network.followRedirects) parts.push('-L');
  if (!network.verifyTls) parts.push('-k');
  if (network.timeoutMs > 0) parts.push('--max-time', String(network.timeoutMs / 1000));
  if (network.proxyUrl.trim()) parts.push('--proxy', shellQuote(network.proxyUrl.trim()));
  else if (!network.useSystemProxy) parts.push('--noproxy', shellQuote('*'));

  parts.push('-X', engine.method, shellQuote(engine.url));
  for (const [key, value] of Object.entries(engine.headers)) {
    parts.push('-H', shellQuote(`${key}: ${value}`));
  }

  if (!['GET', 'HEAD'].includes(engine.method.toUpperCase())) {
    if (engine.body.type === 'text') {
      parts.push('--data-raw', shellQuote(engine.body.content));
    } else if (engine.body.type === 'urlencoded') {
      for (const field of engine.body.fields) {
        parts.push('--data-urlencode', shellQuote(`${field.key}=${field.value}`));
      }
    } else if (engine.body.type === 'multipart') {
      for (const field of engine.body.fields) {
        const value = field.kind === 'file' ? `${field.key}=@${field.value}` : `${field.key}=${field.value}`;
        parts.push('--form', shellQuote(value));
      }
    }
  }
  return parts.join(' \\\n  ');
}

function tokenize(input: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaped = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== 'single') {
      escaped = true;
      continue;
    }
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      continue;
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function kv(key: string, value: string): KeyValue {
  return { id: createId('kv'), key, value, enabled: true };
}

function multipartField(key: string, value: string): MultipartField {
  if (value.startsWith('@')) {
    const path = value.slice(1);
    return {
      id: createId('mp'),
      key,
      value: path,
      enabled: true,
      kind: 'file',
      fileName: path.split(/[\\/]/).pop() || path,
    };
  }
  return { id: createId('mp'), key, value, enabled: true, kind: 'text' };
}

function splitAssignment(raw: string) {
  const equals = raw.indexOf('=');
  return equals >= 0 ? [raw.slice(0, equals), raw.slice(equals + 1)] as const : [raw, ''] as const;
}

export function curlToRequest(input: string): ApiRequest {
  const tokens = tokenize(input.replace(/\\\r?\n/g, ' ').replace(/^\s*>\s?/gm, ''));
  if (!tokens.length || tokens[0].toLowerCase() !== 'curl') {
    throw new Error(t("cURL command must start with \"curl\"."));
  }

  let method: HttpMethod = 'GET';
  let url = '';
  const headers: KeyValue[] = [];
  const formFields: KeyValue[] = [];
  const multipartFields: MultipartField[] = [];
  let body = '';
  let auth: ApiRequest['auth'] = { type: 'none' };
  let detectedBodyType: ApiRequest['bodyType'] | null = null;

  const nextValue = (index: number, flag: string) => {
    const value = tokens[index + 1];
    if (value === undefined) throw new Error(t('Missing value after {flag}.', { flag }));
    return value;
  };

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '-X' || token === '--request') {
      method = nextValue(i, token).toUpperCase() as HttpMethod;
      i += 1;
    } else if (token === '-H' || token === '--header') {
      const raw = nextValue(i, token);
      const colon = raw.indexOf(':');
      if (colon > 0) headers.push(kv(raw.slice(0, colon).trim(), raw.slice(colon + 1).trim()));
      i += 1;
    } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(token)) {
      body = nextValue(i, token);
      detectedBodyType = null;
      if (method === 'GET') method = 'POST';
      i += 1;
    } else if (token === '--data-urlencode') {
      const [key, value] = splitAssignment(nextValue(i, token));
      formFields.push(kv(key, value));
      detectedBodyType = 'form-urlencoded';
      if (method === 'GET') method = 'POST';
      i += 1;
    } else if (token === '-F' || token === '--form') {
      const [key, value] = splitAssignment(nextValue(i, token));
      multipartFields.push(multipartField(key, value));
      detectedBodyType = 'form-data';
      if (method === 'GET') method = 'POST';
      i += 1;
    } else if (token === '-u' || token === '--user') {
      const raw = nextValue(i, token);
      const colon = raw.indexOf(':');
      auth = {
        type: 'basic',
        username: colon >= 0 ? raw.slice(0, colon) : raw,
        password: colon >= 0 ? raw.slice(colon + 1) : '',
      };
      i += 1;
    } else if (token === '--url') {
      url = nextValue(i, token);
      i += 1;
    } else if (['--max-time', '--proxy', '--noproxy', '--cookie', '--cookie-jar'].includes(token)) {
      i += 1;
    } else if (!token.startsWith('-') && !url) {
      url = token;
    }
  }

  if (!url) throw new Error(t("No URL found in cURL command."));

  const parsed = new URL(url);
  const params = Array.from(parsed.searchParams.entries()).map(([key, value]) => kv(key, value));
  parsed.search = '';
  const contentType = headers.find((item) => item.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';

  let bodyType: ApiRequest['bodyType'] = detectedBodyType ?? 'none';
  if (body && !detectedBodyType) {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      bodyType = 'form-urlencoded';
      const parsedBody = new URLSearchParams(body);
      parsedBody.forEach((value, key) => formFields.push(kv(key, value)));
    } else {
      bodyType = contentType.includes('json') || looksLikeJson(body) ? 'json' : 'raw';
    }
  }

  if (!headers.length) headers.push(kv('', ''));
  if (!params.length) params.push(kv('', ''));
  if (!formFields.length) formFields.push(kv('', ''));
  if (!multipartFields.length) multipartFields.push({ id: createId('mp'), key: '', value: '', enabled: true, kind: 'text' });

  return {
    id: createId('req'),
    name: `${method} ${parsed.hostname || t("Imported request")}`,
    method,
    url: parsed.toString(),
    params,
    headers,
    bodyType,
    body,
    formFields,
    multipartFields,
    auth,
  };
}

function looksLikeJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
