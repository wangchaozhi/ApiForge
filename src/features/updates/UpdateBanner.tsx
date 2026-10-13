import { Download, FileText, X } from 'lucide-react';
import { useState } from 'react';
import { translate as t, useLocale } from '../../i18n/index.ts';
import { progressPercent } from '../../services/updater.ts';
import { useUpdateStore } from './updateStore.ts';

export function UpdateBanner() {
  useLocale();
  const status = useUpdateStore((state) => state.status);
  const update = useUpdateStore((state) => state.update);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  const dismissedVersion = useUpdateStore((state) => state.dismissedVersion);
  const install = useUpdateStore((state) => state.install);
  const dismiss = useUpdateStore((state) => state.dismiss);
  const [showNotes, setShowNotes] = useState(false);

  const visible = update && (status === 'available' || status === 'downloading') && dismissedVersion !== update.version;
  if (!visible) return null;

  const downloading = status === 'downloading';
  const percent = progressPercent(progress);

  return (
    <section className="update-banner" role="status">
      <div className="update-banner-row">
        <Download size={15} />
        <div className="update-banner-text">
          <strong>{downloading ? t('Downloading ApiForge {version}…', { version: update.version }) : t('ApiForge {version} is available', { version: update.version })}</strong>
          <span>{downloading
            ? t('The app restarts automatically when the update is installed.')
            : t('You are on {current}. Updates are signed and verified before installing.', { current: update.currentVersion })}</span>
        </div>
        {downloading ? (
          <div className="update-progress" aria-label={t('Download progress')}>
            <div className="update-progress-track"><div className="update-progress-bar" style={{ width: `${percent ?? 100}%` }} data-indeterminate={percent === null} /></div>
            <span>{percent === null ? '' : `${percent}%`}</span>
          </div>
        ) : (
          <div className="update-banner-actions">
            {update.notes && <button className="secondary-button compact" onClick={() => setShowNotes((value) => !value)}><FileText size={13} />{t('Release notes')}</button>}
            <button className="primary-button compact" onClick={() => void install()}><Download size={13} />{t('Update now')}</button>
            <button className="icon-button" title={t('Later')} aria-label={t('Later')} onClick={dismiss}><X size={14} /></button>
          </div>
        )}
      </div>
      {error && <div className="update-banner-error">{t('Update failed: {message}', { message: error })}</div>}
      {showNotes && update.notes && !downloading && <pre className="update-banner-notes">{update.notes}</pre>}
    </section>
  );
}
