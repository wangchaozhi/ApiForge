import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { translate as t, useLocale } from '../../i18n/index.ts';
import { currentAppVersion, isUpdaterSupported } from '../../services/updater.ts';
import { useUpdateStore } from './updateStore.ts';

export function UpdateSettingsCard() {
  useLocale();
  const autoCheck = useUpdateStore((state) => state.autoCheck);
  const setAutoCheck = useUpdateStore((state) => state.setAutoCheck);
  const status = useUpdateStore((state) => state.status);
  const update = useUpdateStore((state) => state.update);
  const error = useUpdateStore((state) => state.error);
  const lastCheckedAt = useUpdateStore((state) => state.lastCheckedAt);
  const check = useUpdateStore((state) => state.check);
  const install = useUpdateStore((state) => state.install);
  const [version, setVersion] = useState<string | null>(null);
  const supported = isUpdaterSupported();

  useEffect(() => {
    void currentAppVersion().then(setVersion).catch(() => undefined);
  }, []);

  const statusText = !supported
    ? t('Updates require the desktop runtime.')
    : status === 'checking' ? t('Checking…')
      : status === 'upToDate' ? t('ApiForge is up to date.')
        : status === 'available' && update ? t('ApiForge {version} is available', { version: update.version })
          : status === 'downloading' && update ? t('Downloading ApiForge {version}…', { version: update.version })
            : status === 'error' && error ? t('Update failed: {message}', { message: error })
              : null;

  return (
    <div className="settings-card">
      <div className="settings-card-title"><Download size={16} /><div><strong>{t('Updates')}</strong><span>{version ? t('Version {version} · signed release channel', { version }) : t('Signed release channel')}</span></div></div>
      <label className="settings-toggle">
        <input type="checkbox" checked={autoCheck} disabled={!supported} onChange={(event) => setAutoCheck(event.target.checked)} />
        <div><strong>{t('Check for updates automatically')}</strong><span>{t('Checks after launch and every 6 hours. Updates install only when you confirm.')}</span></div>
      </label>
      <div className="settings-inline-action">
        {status === 'available'
          ? <button className="primary-button compact" onClick={() => void install()}><Download size={13} />{t('Update now')}</button>
          : <button className="secondary-button compact" disabled={!supported || status === 'checking' || status === 'downloading'} onClick={() => void check()}><Download size={13} />{status === 'checking' ? t('Checking…') : t('Check for updates')}</button>}
        {statusText && <span>{statusText}</span>}
      </div>
      {lastCheckedAt && <p className="settings-description">{t('Last checked {time}', { time: new Date(lastCheckedAt).toLocaleString() })}</p>}
    </div>
  );
}
