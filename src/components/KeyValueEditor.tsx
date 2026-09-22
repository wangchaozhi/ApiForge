import { Plus, Trash2 } from 'lucide-react';
import { createId } from '../lib/id';
import type { KeyValue } from '../types/api';

type Props = {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
};

export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
}: Props) {
  const patch = (id: string, values: Partial<KeyValue>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...values } : row)));
  };

  const add = () => {
    onChange([...rows, { id: createId('kv'), key: '', value: '', enabled: true }]);
  };

  const remove = (id: string) => {
    const next = rows.filter((row) => row.id !== id);
    onChange(next.length ? next : [{ id: createId('kv'), key: '', value: '', enabled: true }]);
  };

  return (
    <div className="kv-editor">
      <div className="kv-head">
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>
      {rows.map((row) => (
        <div className="kv-row" key={row.id}>
          <input
            className="check"
            type="checkbox"
            checked={row.enabled}
            onChange={(event) => patch(row.id, { enabled: event.target.checked })}
            aria-label="Enable row"
          />
          <input
            value={row.key}
            onChange={(event) => patch(row.id, { key: event.target.value })}
            placeholder={keyPlaceholder}
          />
          <input
            value={row.value}
            onChange={(event) => patch(row.id, { value: event.target.value })}
            placeholder={valuePlaceholder}
          />
          <button className="icon-button ghost" onClick={() => remove(row.id)} aria-label="Delete row">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="add-row" onClick={add}>
        <Plus size={14} /> Add row
      </button>
    </div>
  );
}
