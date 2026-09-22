import { FileUp, Plus, Trash2 } from 'lucide-react';
import { createId } from '../lib/id';
import { isTauriRuntime } from '../lib/request';
import type { MultipartField } from '../types/api';

type Props = {
  rows: MultipartField[];
  onChange: (rows: MultipartField[]) => void;
};

function emptyRow(): MultipartField {
  return { id: createId('mp'), key: '', value: '', enabled: true, kind: 'text' };
}

export function MultipartEditor({ rows, onChange }: Props) {
  const patch = (id: string, values: Partial<MultipartField>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...values } : row)));
  };

  const remove = (id: string) => {
    const next = rows.filter((row) => row.id !== id);
    onChange(next.length ? next : [emptyRow()]);
  };

  const chooseFile = async (id: string) => {
    if (!isTauriRuntime()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: false, directory: false });
    if (!selected || Array.isArray(selected)) return;
    const fileName = selected.split(/[\\/]/).pop() || selected;
    patch(id, { value: selected, fileName });
  };

  return (
    <div className="kv-editor multipart-editor">
      <div className="kv-head multipart-head">
        <span />
        <span>Type</span>
        <span>Key</span>
        <span>Value / File</span>
        <span />
      </div>
      {rows.map((row) => (
        <div className="kv-row multipart-row" key={row.id}>
          <input
            className="check"
            type="checkbox"
            checked={row.enabled}
            onChange={(event) => patch(row.id, { enabled: event.target.checked })}
            aria-label="Enable row"
          />
          <select
            value={row.kind}
            onChange={(event) => patch(row.id, {
              kind: event.target.value as MultipartField['kind'],
              value: '',
              fileName: undefined,
            })}
          >
            <option value="text">Text</option>
            <option value="file">File</option>
          </select>
          <input value={row.key} onChange={(event) => patch(row.id, { key: event.target.value })} placeholder="Key" />
          {row.kind === 'text' ? (
            <input value={row.value} onChange={(event) => patch(row.id, { value: event.target.value })} placeholder="Value" />
          ) : (
            <button
              className="file-picker-button"
              type="button"
              onClick={() => void chooseFile(row.id)}
              disabled={!isTauriRuntime()}
              title={isTauriRuntime() ? row.value || 'Choose file' : 'File picking is available in the desktop app'}
            >
              <FileUp size={13} />
              <span>{row.fileName || (isTauriRuntime() ? 'Choose file…' : 'Desktop only')}</span>
            </button>
          )}
          <button className="icon-button ghost" onClick={() => remove(row.id)} aria-label="Delete row">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="add-row" onClick={() => onChange([...rows, emptyRow()])}>
        <Plus size={14} /> Add row
      </button>
    </div>
  );
}
