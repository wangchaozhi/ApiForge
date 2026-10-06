import { toEngineRequest } from '../http/buildRequest.ts';
import type { ApiRequest } from '../../domain/request.ts';
import type { NetworkSettings } from '../../domain/network.ts';

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=,%+@-]+$/.test(value)) return value;
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
