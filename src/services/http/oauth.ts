import { translate as t } from '../../i18n/index.ts';
import { interpolate } from './buildRequest.ts';
import { sendApiRequest } from './transport.ts';
import type { AuthConfig } from '../../domain/request.ts';
import type { EngineField } from '../../domain/engine.ts';
import type { NetworkSettings } from '../../domain/network.ts';

export async function refreshOAuthAccessToken(
  oauth: Extract<AuthConfig, { type: 'oauth2' }>,
  variables: Record<string, string>,
  network: NetworkSettings,
): Promise<Extract<AuthConfig, { type: 'oauth2' }>> {
  if (!oauth.refreshToken || !oauth.tokenUrl) return oauth;
  if (oauth.accessToken && (!oauth.expiresAt || oauth.expiresAt > Date.now() + 30_000)) return oauth;

  const fields: EngineField[] = [
    { key: 'grant_type', value: 'refresh_token' },
    { key: 'refresh_token', value: interpolate(oauth.refreshToken, variables) },
    { key: 'client_id', value: interpolate(oauth.clientId, variables) },
  ];
  const clientSecret = interpolate(oauth.clientSecret, variables);
  if (clientSecret) fields.push({ key: 'client_secret', value: clientSecret });
  const response = await sendApiRequest({
    method: 'POST',
    url: interpolate(oauth.tokenUrl, variables),
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: { type: 'urlencoded', fields },
    network,
  }, `oauth-refresh-${crypto.randomUUID()}`);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    throw new Error(t('OAuth token endpoint did not return JSON.'));
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof payload.error_description === 'string'
      ? payload.error_description
      : typeof payload.error === 'string' ? payload.error : `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  if (!accessToken) throw new Error(t('OAuth token response did not include access_token.'));
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : Number(payload.expires_in);
  return {
    ...oauth,
    accessToken,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : oauth.refreshToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
  };
}
