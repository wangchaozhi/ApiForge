import { translate as t, useLocale } from '../i18n';
import { Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export function EnvironmentPanel() {
  useLocale();
  const environments = useAppStore((state) => state.environments);
  const setEnvironment = useAppStore((state) => state.setEnvironment);
  const removeEnvironment = useAppStore((state) => state.removeEnvironment);
  const replaceEnvironmentKey = useAppStore((state) => state.replaceEnvironmentKey);
  const entries = Object.entries(environments);

  const add = () => {
    let index = 1;
    let key = 'variable';
    while (key in environments) key = `variable${++index}`;
    setEnvironment(key, '');
  };

  return (
    <section className="environment-page">
      <header className="page-header">
        <div><strong>{t("Environment")}</strong><span>{t('Use variables as {syntax} in URL, headers, params, auth, or body.', { syntax: '{{key}}' })}</span></div>
        <button className="primary-button compact" onClick={add}><Plus size={14} /> {t("Add variable")}</button>
      </header>
      <div className="environment-table">
        <div className="environment-row head"><span>{t("Variable")}</span><span>{t("Value")}</span><span /></div>
        {entries.map(([key, value]) => (
          <div className="environment-row" key={key}>
            <input defaultValue={key} onBlur={(event) => replaceEnvironmentKey(key, event.target.value)} spellCheck={false} />
            <input value={value} onChange={(event) => setEnvironment(key, event.target.value)} spellCheck={false} />
            <button className="icon-button ghost" onClick={() => removeEnvironment(key)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
