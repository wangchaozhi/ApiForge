import { translate as t, useLocale } from '../i18n';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export function EnvironmentPanel() {
  useLocale();
  const profiles = useAppStore((state) => state.environmentProfiles);
  const activeEnvironmentId = useAppStore((state) => state.activeEnvironmentId);
  const setActiveEnvironmentProfile = useAppStore((state) => state.setActiveEnvironmentProfile);
  const createEnvironmentProfile = useAppStore((state) => state.createEnvironmentProfile);
  const renameEnvironmentProfile = useAppStore((state) => state.renameEnvironmentProfile);
  const deleteEnvironmentProfile = useAppStore((state) => state.deleteEnvironmentProfile);
  const setEnvironment = useAppStore((state) => state.setEnvironment);
  const setEnvironmentSecret = useAppStore((state) => state.setEnvironmentSecret);
  const removeEnvironment = useAppStore((state) => state.removeEnvironment);
  const replaceEnvironmentKey = useAppStore((state) => state.replaceEnvironmentKey);

  const activeProfile = profiles.find((profile) => profile.id === activeEnvironmentId) ?? profiles[0];
  const entries = Object.entries(activeProfile?.variables ?? {});

  const addVariable = () => {
    const variables = activeProfile?.variables ?? {};
    let index = 1;
    let key = 'variable';
    while (key in variables) key = `variable${++index}`;
    setEnvironment(key, '');
  };

  const addEnvironment = () => {
    const name = window.prompt(t('Environment name'), t('New environment'));
    if (name?.trim()) createEnvironmentProfile(name.trim());
  };

  const renameEnvironment = () => {
    if (!activeProfile) return;
    const name = window.prompt(t('Environment name'), activeProfile.name);
    if (name?.trim()) renameEnvironmentProfile(activeProfile.id, name.trim());
  };

  const deleteEnvironment = () => {
    if (!activeProfile || profiles.length <= 1) return;
    if (window.confirm(`${t('Delete environment')} “${activeProfile.name}”?`)) {
      deleteEnvironmentProfile(activeProfile.id);
    }
  };

  return (
    <section className="environment-page">
      <header className="page-header">
        <div>
          <strong>{t('Environment')}</strong>
          <span>{t('Use variables as {syntax} in URL, headers, params, auth, or body.', { syntax: '{{key}}' })}</span>
        </div>
        <div className="environment-toolbar">
          <label>
            <span>{t('Active environment')}</span>
            <select
              value={activeProfile?.id ?? ''}
              onChange={(event) => setActiveEnvironmentProfile(event.target.value)}
            >
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>
          <button className="secondary-button compact" onClick={renameEnvironment} disabled={!activeProfile}>
            <Pencil size={13} /> {t('Rename environment')}
          </button>
          <button className="secondary-button compact" onClick={deleteEnvironment} disabled={profiles.length <= 1}>
            <Trash2 size={13} /> {t('Delete environment')}
          </button>
          <button className="secondary-button compact" onClick={addEnvironment}>
            <Plus size={13} /> {t('New environment')}
          </button>
          <button className="primary-button compact" onClick={addVariable}>
            <Plus size={14} /> {t('Add variable')}
          </button>
        </div>
      </header>

      <div className="environment-secret-note">
        {t('Secret values stay in memory for this session until the secure vault is connected.')}
      </div>

      <div className="environment-table">
        <div className="environment-row head">
          <span>{t('Variable')}</span>
          <span>{t('Value')}</span>
          <span>{t('Secret')}</span>
          <span />
        </div>
        {entries.map(([key, variable]) => (
          <div className="environment-row" key={key}>
            <input
              defaultValue={key}
              onBlur={(event) => replaceEnvironmentKey(key, event.target.value)}
              spellCheck={false}
            />
            <input
              type={variable.secret ? 'password' : 'text'}
              value={variable.value}
              onChange={(event) => setEnvironment(key, event.target.value)}
              spellCheck={false}
            />
            <label className="environment-secret-toggle">
              <input
                type="checkbox"
                checked={variable.secret}
                onChange={(event) => setEnvironmentSecret(key, event.target.checked)}
              />
            </label>
            <button className="icon-button ghost" onClick={() => removeEnvironment(key)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
