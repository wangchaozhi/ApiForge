import { translate as t, useLocale } from '../i18n';
import { Lock, Pencil, Plus, Trash2, Unlock } from 'lucide-react';
import { useState } from 'react';
import {
  deleteSecret,
  environmentSecretKey,
  isSecretVaultUnlocked,
  loadEnvironmentSecrets,
  lockSecretVault,
  moveSecret,
  unlockSecretVault,
  writeSecret,
} from '../lib/secrets';
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
  const setEnvironmentValueForProfile = useAppStore((state) => state.setEnvironmentValueForProfile);
  const clearEnvironmentSecretValues = useAppStore((state) => state.clearEnvironmentSecretValues);
  const setEnvironmentSecret = useAppStore((state) => state.setEnvironmentSecret);
  const removeEnvironment = useAppStore((state) => state.removeEnvironment);
  const replaceEnvironmentKey = useAppStore((state) => state.replaceEnvironmentKey);

  const [masterPassword, setMasterPassword] = useState('');
  const [vaultUnlocked, setVaultUnlocked] = useState(() => isSecretVaultUnlocked());
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultMessage, setVaultMessage] = useState<string | null>(null);

  const activeProfile = profiles.find((profile) => profile.id === activeEnvironmentId) ?? profiles[0];
  const entries = Object.entries(activeProfile?.variables ?? {});
  const activeHasSecrets = entries.some(([, variable]) => variable.secret);

  const runVaultAction = async (action: () => Promise<void>) => {
    setVaultBusy(true);
    setVaultMessage(null);
    try {
      await action();
    } catch (error) {
      setVaultMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setVaultBusy(false);
    }
  };

  const unlockVault = () => runVaultAction(async () => {
    await unlockSecretVault(masterPassword);
    const restored = await loadEnvironmentSecrets(profiles);
    for (const item of restored) {
      setEnvironmentValueForProfile(item.profileId, item.key, item.value);
    }
    setMasterPassword('');
    setVaultUnlocked(true);
    setVaultMessage(t('Secret vault unlocked.'));
  });

  const lockVault = () => runVaultAction(async () => {
    await lockSecretVault();
    clearEnvironmentSecretValues();
    setVaultUnlocked(false);
    setMasterPassword('');
    setVaultMessage(t('Secret vault locked.'));
  });

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
    void runVaultAction(async () => {
      if (activeHasSecrets) {
        if (!vaultUnlocked) throw new Error(t('Unlock the secret vault before deleting this environment.'));
        for (const [key, variable] of entries) {
          if (variable.secret) await deleteSecret(environmentSecretKey(activeProfile.id, key));
        }
      }
      if (window.confirm(`${t('Delete environment')} “${activeProfile.name}”?`)) {
        deleteEnvironmentProfile(activeProfile.id);
      }
    });
  };

  const renameVariable = (key: string, nextKey: string, secret: boolean) => {
    const trimmed = nextKey.trim();
    if (!trimmed || trimmed === key || !activeProfile) return;
    void runVaultAction(async () => {
      if (secret) {
        if (!vaultUnlocked) throw new Error(t('Unlock the secret vault before editing secrets.'));
        await moveSecret(
          environmentSecretKey(activeProfile.id, key),
          environmentSecretKey(activeProfile.id, trimmed),
        );
      }
      replaceEnvironmentKey(key, trimmed);
    });
  };

  const toggleSecret = (key: string, secret: boolean) => {
    if (!activeProfile) return;
    const current = activeProfile.variables[key];
    void runVaultAction(async () => {
      if (!vaultUnlocked) throw new Error(t('Unlock the secret vault before editing secrets.'));
      const secretKey = environmentSecretKey(activeProfile.id, key);
      if (secret) {
        await writeSecret(secretKey, current?.value ?? '');
      } else {
        await deleteSecret(secretKey);
      }
      setEnvironmentSecret(key, secret);
    });
  };

  const saveSecretValue = (key: string, value: string) => {
    if (!activeProfile) return;
    void runVaultAction(async () => {
      if (!vaultUnlocked) throw new Error(t('Unlock the secret vault before editing secrets.'));
      await writeSecret(environmentSecretKey(activeProfile.id, key), value);
    });
  };

  const deleteVariable = (key: string, secret: boolean) => {
    if (!activeProfile) return;
    void runVaultAction(async () => {
      if (secret) {
        if (!vaultUnlocked) throw new Error(t('Unlock the secret vault before editing secrets.'));
        await deleteSecret(environmentSecretKey(activeProfile.id, key));
      }
      removeEnvironment(key);
    });
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
          <button
            className="secondary-button compact"
            onClick={deleteEnvironment}
            disabled={profiles.length <= 1 || vaultBusy || (activeHasSecrets && !vaultUnlocked)}
          >
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

      <div className={`environment-vault-card ${vaultUnlocked ? 'unlocked' : ''}`}>
        <div>
          <strong>{vaultUnlocked ? t('Secret vault unlocked') : t('Secret vault locked')}</strong>
          <span>{t('Secret values are encrypted with Stronghold and never written to workspace storage.')}</span>
        </div>
        <div className="environment-vault-actions">
          {!vaultUnlocked ? (
            <>
              <input
                type="password"
                value={masterPassword}
                onChange={(event) => setMasterPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && masterPassword && !vaultBusy) void unlockVault();
                }}
                placeholder={t('Master password')}
                autoComplete="off"
              />
              <button className="primary-button compact" disabled={!masterPassword || vaultBusy} onClick={() => void unlockVault()}>
                <Unlock size={13} /> {t('Unlock secrets')}
              </button>
            </>
          ) : (
            <button className="secondary-button compact" disabled={vaultBusy} onClick={() => void lockVault()}>
              <Lock size={13} /> {t('Lock secrets')}
            </button>
          )}
        </div>
      </div>

      {vaultMessage && <div className="environment-secret-note">{vaultMessage}</div>}

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
              disabled={variable.secret && !vaultUnlocked}
              onBlur={(event) => renameVariable(key, event.target.value, variable.secret)}
              spellCheck={false}
            />
            <input
              type={variable.secret ? 'password' : 'text'}
              value={variable.value}
              disabled={variable.secret && !vaultUnlocked}
              placeholder={variable.secret && !vaultUnlocked ? t('Unlock to edit') : undefined}
              onChange={(event) => setEnvironment(key, event.target.value)}
              onBlur={(event) => {
                if (variable.secret) saveSecretValue(key, event.target.value);
              }}
              spellCheck={false}
            />
            <label className="environment-secret-toggle">
              <input
                type="checkbox"
                checked={variable.secret}
                disabled={!vaultUnlocked || vaultBusy}
                onChange={(event) => toggleSecret(key, event.target.checked)}
              />
            </label>
            <button
              className="icon-button ghost"
              disabled={vaultBusy || (variable.secret && !vaultUnlocked)}
              onClick={() => deleteVariable(key, variable.secret)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
