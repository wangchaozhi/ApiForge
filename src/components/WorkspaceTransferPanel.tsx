import { Download, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { translate as t, useLocale } from '../i18n';
import {
  parsePostmanCollection,
  parsePostmanEnvironment,
  parseWorkspace,
  serializePostmanCollection,
  serializePostmanEnvironment,
  serializeWorkspace,
} from '../lib/workspace';
import { useAppStore } from '../store/appStore';

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function WorkspaceTransferPanel() {
  useLocale();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requests = useAppStore((state) => state.requests);
  const collections = useAppStore((state) => state.collections);
  const environmentProfiles = useAppStore((state) => state.environmentProfiles);
  const activeEnvironmentId = useAppStore((state) => state.activeEnvironmentId);
  const networkSettings = useAppStore((state) => state.networkSettings);
  const importCollection = useAppStore((state) => state.importCollection);
  const importEnvironmentProfile = useAppStore((state) => state.importEnvironmentProfile);
  const replaceWorkspace = useAppStore((state) => state.replaceWorkspace);

  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? '');
  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === collectionId) ?? collections[0],
    [collectionId, collections],
  );
  const activeEnvironment = environmentProfiles.find((profile) => profile.id === activeEnvironmentId) ?? environmentProfiles[0];

  const handleImport = async (file: File) => {
    try {
      const source = await file.text();
      const document = JSON.parse(source) as Record<string, unknown>;
      if (document.schema === 'apiforge.workspace') {
        replaceWorkspace(parseWorkspace(source).data);
      } else if (document.info && Array.isArray(document.item)) {
        const imported = parsePostmanCollection(source);
        importCollection(imported.collection, imported.requests);
      } else if (Array.isArray(document.values)) {
        importEnvironmentProfile(parsePostmanEnvironment(source));
      } else {
        throw new Error(t('Unsupported JSON file.'));
      }
      setMessage(t('Import complete.'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(t('Import failed: {message}', { message: detail }));
    }
  };

  const exportWorkspace = () => {
    downloadText(
      'apiforge-workspace.json',
      serializeWorkspace({
        requests,
        collections,
        environmentProfiles,
        activeEnvironmentId,
        networkSettings,
      }),
    );
  };

  const exportCollection = () => {
    if (!selectedCollection) return;
    downloadText(
      `${selectedCollection.name.replace(/[^A-Za-z0-9._-]+/g, '-') || 'collection'}.postman_collection.json`,
      serializePostmanCollection(selectedCollection, requests),
    );
  };

  const exportEnvironment = () => {
    if (!activeEnvironment) return;
    downloadText(
      `${activeEnvironment.name.replace(/[^A-Za-z0-9._-]+/g, '-') || 'environment'}.postman_environment.json`,
      serializePostmanEnvironment(activeEnvironment),
    );
  };

  return (
    <div className="settings-card workspace-transfer-card">
      <div className="settings-card-title">
        <Download size={16} />
        <div>
          <strong>{t('Data portability')}</strong>
          <span>{t('Backup ApiForge or exchange Postman collections and environments.')}</span>
        </div>
      </div>

      <div className="workspace-transfer-actions">
        <button className="secondary-button compact" onClick={() => inputRef.current?.click()}>
          <Upload size={13} /> {t('Import JSON')}
        </button>
        <button className="secondary-button compact" onClick={exportWorkspace}>
          <Download size={13} /> {t('Export workspace')}
        </button>
      </div>

      <label className="settings-field">
        <span>{t('Collection')}</span>
        <select value={selectedCollection?.id ?? ''} onChange={(event) => setCollectionId(event.target.value)}>
          {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
        </select>
      </label>

      <div className="workspace-transfer-actions">
        <button className="secondary-button compact" disabled={!selectedCollection} onClick={exportCollection}>
          <Download size={13} /> {t('Export collection')}
        </button>
        <button className="secondary-button compact" disabled={!activeEnvironment} onClick={exportEnvironment}>
          <Download size={13} /> {t('Export environment')}
        </button>
      </div>

      <p className="settings-description">{t('Secrets are excluded from exports by default.')}</p>
      {message && <p className="settings-description">{message}</p>}

      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImport(file);
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}
