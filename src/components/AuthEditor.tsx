import { Copy, KeyRound, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { translate as t, useLocale } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { createId } from '../lib/id';
import { interpolate, sendApiRequest } from '../lib/request';
import { getActiveEnvironmentValues, useAppStore } from '../store/appStore';
import type { ApiRequest, AuthConfig, EngineField } from '../types/api';

type Props = {
  request: ApiRequest;
  onChange: (auth: AuthConfig) => void;
};

const authTypes: Array<{ value: AuthConfig['type']; label: MessageKey }> = [
  { value: 'none', label: 'No Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apiKey', label: 'API Key' },
  { value: 'oauth2', label: 'OAuth 2.0' },
];

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export function AuthEditor({ request, onChange }: Props) {
  useLocale();
  const variables = useAppStore(getActiveEnvironmentValues);
  const networkSettings = useAppStore((state) => state.networkSettings);
  const auth = request.auth ?? { type: 'none' as const };

  const [authorizationCode, setAuthorizationCode] = useState('');
  const [codeVerifier, setCodeVerifier] = useState('');
  const [generatedAuthorizationUrl, setGeneratedAuthorizationUrl] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);

  const setType = (type: AuthConfig['type']) => {
    setAuthorizationCode('');
    setCodeVerifier('');
    setGeneratedAuthorizationUrl('');
    setTokenMessage(null);

    if (type === 'none') onChange({ type: 'none' });
    if (type === 'bearer') onChange({ type: 'bearer', token: '' });
    if (type === 'basic') onChange({ type: 'basic', username: '', password: '' });
    if (type === 'apiKey') onChange({ type: 'apiKey', key: 'X-API-Key', value: '', addTo: 'header' });
    if (type === 'oauth2') onChange({
      type: 'oauth2',
      flow: 'authorization-code',
      authorizationUrl: '',
      tokenUrl: '',
      redirectUri: '',
      clientId: '',
      clientSecret: '',
      scopes: '',
      usePkce: true,
      accessToken: '',
    });
  };

  const exchangeToken = async (
    oauth: Extract<AuthConfig, { type: 'oauth2' }>,
    fields: EngineField[],
  ) => {
    setTokenBusy(true);
    setTokenMessage(null);
    try {
      const response = await sendApiRequest({
        method: 'POST',
        url: interpolate(oauth.tokenUrl, variables),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: { type: 'urlencoded', fields },
        network: networkSettings,
      }, createId('oauth-token'));

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(response.body) as Record<string, unknown>;
      } catch {
        throw new Error(t('OAuth token endpoint did not return JSON.'));
      }

      if (response.status < 200 || response.status >= 300) {
        const detail = typeof payload.error_description === 'string'
          ? payload.error_description
          : typeof payload.error === 'string'
            ? payload.error
            : `${response.status} ${response.statusText}`;
        throw new Error(detail);
      }

      const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
      if (!accessToken) throw new Error(t('OAuth token response did not include access_token.'));

      onChange({ ...oauth, accessToken });
      setTokenMessage(t('Access token acquired for this session.'));
    } catch (error) {
      setTokenMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTokenBusy(false);
    }
  };

  const acquireClientCredentials = async (oauth: Extract<AuthConfig, { type: 'oauth2' }>) => {
    const clientId = interpolate(oauth.clientId, variables);
    const clientSecret = interpolate(oauth.clientSecret, variables);
    const scope = interpolate(oauth.scopes, variables);
    const fields: EngineField[] = [
      { key: 'grant_type', value: 'client_credentials' },
      { key: 'client_id', value: clientId },
    ];
    if (clientSecret) fields.push({ key: 'client_secret', value: clientSecret });
    if (scope) fields.push({ key: 'scope', value: scope });
    await exchangeToken(oauth, fields);
  };

  const generateAuthorizationUrl = async (oauth: Extract<AuthConfig, { type: 'oauth2' }>) => {
    try {
      const url = new URL(interpolate(oauth.authorizationUrl, variables));
      const redirectUri = interpolate(oauth.redirectUri, variables);
      const scope = interpolate(oauth.scopes, variables);
      const state = randomToken(18);
      let verifier = '';

      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', interpolate(oauth.clientId, variables));
      url.searchParams.set('state', state);
      if (redirectUri) url.searchParams.set('redirect_uri', redirectUri);
      if (scope) url.searchParams.set('scope', scope);

      if (oauth.usePkce) {
        verifier = randomToken(32);
        url.searchParams.set('code_challenge', await sha256Base64Url(verifier));
        url.searchParams.set('code_challenge_method', 'S256');
      }

      setCodeVerifier(verifier);
      setGeneratedAuthorizationUrl(url.toString());
      setTokenMessage(t('Authorization URL generated. Open it in your browser, then paste the returned code below.'));
    } catch (error) {
      setTokenMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const exchangeAuthorizationCode = async (oauth: Extract<AuthConfig, { type: 'oauth2' }>) => {
    const code = authorizationCode.trim();
    if (!code) {
      setTokenMessage(t('Authorization code is required.'));
      return;
    }

    const fields: EngineField[] = [
      { key: 'grant_type', value: 'authorization_code' },
      { key: 'code', value: code },
      { key: 'client_id', value: interpolate(oauth.clientId, variables) },
    ];
    const clientSecret = interpolate(oauth.clientSecret, variables);
    const redirectUri = interpolate(oauth.redirectUri, variables);
    if (clientSecret) fields.push({ key: 'client_secret', value: clientSecret });
    if (redirectUri) fields.push({ key: 'redirect_uri', value: redirectUri });
    if (oauth.usePkce && codeVerifier) fields.push({ key: 'code_verifier', value: codeVerifier });
    await exchangeToken(oauth, fields);
  };

  return (
    <div className="auth-editor">
      <div className="auth-type-column">
        <label>{t('Auth Type')}</label>
        <select value={auth.type} onChange={(event) => setType(event.target.value as AuthConfig['type'])}>
          {authTypes.map((item) => <option value={item.value} key={item.value}>{t(item.label)}</option>)}
        </select>
      </div>

      <div className="auth-fields">
        {auth.type === 'none' && (
          <div className="inline-empty">{t('This request does not add authentication automatically.')}</div>
        )}
        {auth.type === 'bearer' && (
          <label>
            <span>{t('Token')}</span>
            <input
              type="password"
              value={auth.token}
              placeholder={t('{{token}} or paste a bearer token')}
              onChange={(event) => onChange({ ...auth, token: event.target.value })}
            />
          </label>
        )}
        {auth.type === 'basic' && (
          <>
            <label>
              <span>{t('Username')}</span>
              <input value={auth.username} onChange={(event) => onChange({ ...auth, username: event.target.value })} />
            </label>
            <label>
              <span>{t('Password')}</span>
              <input type="password" value={auth.password} onChange={(event) => onChange({ ...auth, password: event.target.value })} />
            </label>
          </>
        )}
        {auth.type === 'apiKey' && (
          <>
            <label>
              <span>{t('Key')}</span>
              <input value={auth.key} onChange={(event) => onChange({ ...auth, key: event.target.value })} />
            </label>
            <label>
              <span>{t('Value')}</span>
              <input type="password" value={auth.value} onChange={(event) => onChange({ ...auth, value: event.target.value })} />
            </label>
            <label>
              <span>{t('Add to')}</span>
              <select value={auth.addTo} onChange={(event) => onChange({ ...auth, addTo: event.target.value as 'header' | 'query' })}>
                <option value="header">{t('Header')}</option>
                <option value="query">{t('Query Params')}</option>
              </select>
            </label>
          </>
        )}
        {auth.type === 'oauth2' && (
          <>
            <label>
              <span>{t('OAuth 2.0')}</span>
              <select value={auth.flow} onChange={(event) => {
                setAuthorizationCode('');
                setCodeVerifier('');
                setGeneratedAuthorizationUrl('');
                setTokenMessage(null);
                onChange({ ...auth, flow: event.target.value as 'authorization-code' | 'client-credentials' });
              }}>
                <option value="authorization-code">{t('Authorization Code')}</option>
                <option value="client-credentials">{t('Client Credentials')}</option>
              </select>
            </label>

            {auth.flow === 'authorization-code' && (
              <>
                <label>
                  <span>{t('Authorization URL')}</span>
                  <input value={auth.authorizationUrl} onChange={(event) => onChange({ ...auth, authorizationUrl: event.target.value })} spellCheck={false} />
                </label>
                <label>
                  <span>{t('Redirect URI')}</span>
                  <input value={auth.redirectUri} onChange={(event) => onChange({ ...auth, redirectUri: event.target.value })} spellCheck={false} />
                </label>
              </>
            )}

            <label>
              <span>{t('Token URL')}</span>
              <input value={auth.tokenUrl} onChange={(event) => onChange({ ...auth, tokenUrl: event.target.value })} spellCheck={false} />
            </label>
            <label>
              <span>{t('Client ID')}</span>
              <input value={auth.clientId} onChange={(event) => onChange({ ...auth, clientId: event.target.value })} spellCheck={false} />
            </label>
            <label>
              <span>{t('Client Secret')}</span>
              <input type="password" value={auth.clientSecret} onChange={(event) => onChange({ ...auth, clientSecret: event.target.value })} />
            </label>
            <label>
              <span>{t('Scopes')}</span>
              <input value={auth.scopes} onChange={(event) => onChange({ ...auth, scopes: event.target.value })} placeholder="read write" spellCheck={false} />
            </label>

            {auth.flow === 'authorization-code' && (
              <>
                <label className="auth-inline-toggle">
                  <span>{t('Use PKCE')}</span>
                  <input type="checkbox" checked={auth.usePkce} onChange={(event) => onChange({ ...auth, usePkce: event.target.checked })} />
                </label>

                <div className="oauth-actions">
                  <button
                    className="secondary-button compact"
                    disabled={!auth.authorizationUrl || !auth.clientId || tokenBusy}
                    onClick={() => void generateAuthorizationUrl(auth)}
                  >
                    <KeyRound size={13} /> {t('Generate authorization URL')}
                  </button>
                  {generatedAuthorizationUrl && (
                    <button
                      className="secondary-button compact"
                      onClick={() => void navigator.clipboard.writeText(generatedAuthorizationUrl)}
                    >
                      <Copy size={13} /> {t('Copy authorization URL')}
                    </button>
                  )}
                </div>

                {generatedAuthorizationUrl && (
                  <label>
                    <span>{t('Generated authorization URL')}</span>
                    <textarea value={generatedAuthorizationUrl} readOnly rows={3} />
                  </label>
                )}

                <label>
                  <span>{t('Authorization Code')}</span>
                  <input value={authorizationCode} onChange={(event) => setAuthorizationCode(event.target.value)} spellCheck={false} />
                </label>

                <button
                  className="primary-button compact oauth-token-button"
                  disabled={!auth.tokenUrl || !auth.clientId || !authorizationCode.trim() || tokenBusy}
                  onClick={() => void exchangeAuthorizationCode(auth)}
                >
                  <RefreshCw size={13} className={tokenBusy ? 'spin' : ''} /> {t('Exchange code for token')}
                </button>
              </>
            )}

            {auth.flow === 'client-credentials' && (
              <button
                className="primary-button compact oauth-token-button"
                disabled={!auth.tokenUrl || !auth.clientId || tokenBusy}
                onClick={() => void acquireClientCredentials(auth)}
              >
                <RefreshCw size={13} className={tokenBusy ? 'spin' : ''} /> {t('Get access token')}
              </button>
            )}

            <label>
              <span>{t('Access Token')}</span>
              <input type="password" value={auth.accessToken} onChange={(event) => onChange({ ...auth, accessToken: event.target.value })} />
            </label>

            <div className="inline-empty">
              {tokenMessage ?? t('OAuth secrets and access tokens are session-only and excluded from workspace persistence.')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
