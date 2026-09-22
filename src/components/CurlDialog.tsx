import { translate as t, useLocale } from '../i18n';
import { useEffect, useState } from 'react';
import { Clipboard, X } from 'lucide-react';

type Props = {
  mode: 'import' | 'export';
  initialValue?: string;
  onClose: () => void;
  onImport?: (value: string) => void;
};

export function CurlDialog({ mode, initialValue = '', onClose, onImport }: Props) {
  useLocale();
  const [value, setValue] = useState(initialValue);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog-card" role="dialog" aria-modal="true">
        <div className="dialog-title">
          <div>
            <strong>{mode === 'import' ? t("Import cURL") : t("Export cURL")}</strong>
            <span>{mode === 'import' ? t("Paste a cURL command to create a new request.") : t("Copy this command to your terminal.")}</span>
          </div>
          <button className="icon-button ghost" onClick={onClose}><X size={17} /></button>
        </div>
        <textarea
          autoFocus={mode === 'import'}
          className="curl-editor"
          readOnly={mode === 'export'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="curl -X POST https://api.example.com/users ..."
          spellCheck={false}
        />
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose}>{t("Cancel")}</button>
          {mode === 'export' ? (
            <button className="primary-button" onClick={() => void copy()}><Clipboard size={15} /> {copied ? t("Copied") : t("Copy cURL")}</button>
          ) : (
            <button className="primary-button" onClick={() => onImport?.(value)} disabled={!value.trim()}>{t("Import Request")}</button>
          )}
        </div>
      </div>
    </div>
  );
}
