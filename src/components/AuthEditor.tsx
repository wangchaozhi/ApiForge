import { translate as t, useLocale } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import type { ApiRequest, AuthConfig } from '../types/api';

type Props = {
  request: ApiRequest;
  onChange: (auth: AuthConfig) => void;
};

const authTypes: Array<{ value: AuthConfig['type']; label: MessageKey }> = [
  { value: 'none', label: "No Auth" },
  { value: 'bearer', label: "Bearer Token" },
  { value: 'basic', label: "Basic Auth" },
  { value: 'apiKey', label: "API Key" },
  { value: 'oauth2', label: "OAuth 2.0" },
];

export function AuthEditor({ request, onChange }: Props) {
  useLocale();
  const auth = request.auth ?? { type: 'none' as const };

  const setType = (type: AuthConfig['type']) => {
    if (type === 'none') onChange({ type: 'none' });
    if (type === 'bearer') onChange({ type: 'bearer', token: '' });
    if (type === 'basic') onChange({ type: 'basic', username: '', password: '' });
    if (type === 'apiKey') onChange({ type: 'apiKey', key: 'X-API-Key', value: '', addTo: 'header' });
    if (type === 'oauth2') onChange({
      type: 'oauth2',
      flow: 'authorization-code',
      authorizationUrl: '',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scopes: '',
      usePkce: true,
      accessToken: '',
    });
  };

  return (
    <div className="auth-editor">
      <div className="auth-type-column">
        <label>{t("Auth Type")}</label>
        <select value={auth.type} onChange={(event) => setType(event.target.value as AuthConfig['type'])}>
          {authTypes.map((item) => <option value={item.value} key={item.value}>{t(item.label)}</option>)}
        </select>
      </div>

      <div className="auth-fields">
        {auth.type === 'none' && (
          <div className="inline-empty">{t("This request does not add authentication automatically.")}</div>
        )}
        {auth.type === 'bearer' && (
          <label>
            <span>{t("Token")}</span>
            <input
              type="password"
              value={auth.token}
              placeholder={t("{{token}} or paste a bearer token")}
              onChange={(event) => onChange({ ...auth, token: event.target.value })}
            />
          </label>
        )}
        {auth.type === 'basic' && (
          <>
            <label>
              <span>{t("Username")}</span>
              <input value={auth.username} onChange={(event) => onChange({ ...auth, username: event.target.value })} />
            </label>
            <label>
              <span>{t("Password")}</span>
              <input type="password" value={auth.password} onChange={(event) => onChange({ ...auth, password: event.target.value })} />
            </label>
          </>
        )}
        {auth.type === 'apiKey' && (
          <>
            <label>
              <span>{t("Key")}</span>
              <input value={auth.key} onChange={(event) => onChange({ ...auth, key: event.target.value })} />
            </label>
            <label>
              <span>{t("Value")}</span>
              <input type="password" value={auth.value} onChange={(event) => onChange({ ...auth, value: event.target.value })} />
            </label>
            <label>
              <span>{t("Add to")}</span>
              <select value={auth.addTo} onChange={(event) => onChange({ ...auth, addTo: event.target.value as 'header' | 'query' })}>
                <option value="header">{t("Header")}</option>
                <option value="query">{t("Query Params")}</option>
              </select>
            </label>
          </>
        )}
        {auth.type === 'oauth2' && (
          <>
            <label>
              <span>{t('OAuth 2.0')}</span>
              <select value={auth.flow} onChange={(event) => onChange({ ...auth, flow: event.target.value as 'authorization-code' | 'client-credentials' })}>
                <option value="authorization-code">{t('Authorization Code')}</option>
                <option value="client-credentials">{t('Client Credentials')}</option>
              </select>
            </label>
            {auth.flow === 'authorization-code' && (
              <label>
                <span>{t('Authorization URL')}</span>
                <input value={auth.authorizationUrl} onChange={(event) => onChange({ ...auth, authorizationUrl: event.target.value })} spellCheck={false} />
              </label>
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
              <label className="auth-inline-toggle">
                <span>{t('Use PKCE')}</span>
                <input type="checkbox" checked={auth.usePkce} onChange={(event) => onChange({ ...auth, usePkce: event.target.checked })} />
              </label>
            )}
            <label>
              <span>{t('Access Token')}</span>
              <input type="password" value={auth.accessToken} onChange={(event) => onChange({ ...auth, accessToken: event.target.value })} />
            </label>
            <div className="inline-empty">{t('OAuth token acquisition will be added in the next runner/auth step.')}</div>
          </>
        )}
      </div>
    </div>
  );
}
