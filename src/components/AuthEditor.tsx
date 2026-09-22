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
];

export function AuthEditor({ request, onChange }: Props) {
  useLocale();
  const auth = request.auth ?? { type: 'none' as const };

  const setType = (type: AuthConfig['type']) => {
    if (type === 'none') onChange({ type: 'none' });
    if (type === 'bearer') onChange({ type: 'bearer', token: '' });
    if (type === 'basic') onChange({ type: 'basic', username: '', password: '' });
    if (type === 'apiKey') onChange({ type: 'apiKey', key: 'X-API-Key', value: '', addTo: 'header' });
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
      </div>
    </div>
  );
}
