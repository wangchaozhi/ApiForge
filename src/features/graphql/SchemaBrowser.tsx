import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { translate as t } from '../../i18n/index.ts';
import { namedTypeOf, typeRefToString, type GraphqlSchema, type GraphqlTypeRef } from '../../services/graphql/schema.ts';

type Props = {
  schema: GraphqlSchema | null;
  loading: boolean;
  onLoad: () => void;
};

function TypeLink({ typeRef, onOpen }: { typeRef: GraphqlTypeRef; onOpen: (name: string) => void }) {
  const name = namedTypeOf(typeRef);
  return (
    <button className="graphql-type-link" disabled={!name} onClick={() => name && onOpen(name)}>
      {typeRefToString(typeRef)}
    </button>
  );
}

export function SchemaBrowser({ schema, loading, onLoad }: Props) {
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const selectedName = history[history.length - 1];
  const selected = selectedName ? schema?.byName.get(selectedName) : undefined;

  const open = (name: string) => setHistory((current) => current[current.length - 1] === name ? current : [...current, name]);
  const back = () => setHistory((current) => current.slice(0, -1));

  const roots = useMemo(() => [
    schema?.queryType && { label: 'Query', name: schema.queryType },
    schema?.mutationType && { label: 'Mutation', name: schema.mutationType },
    schema?.subscriptionType && { label: 'Subscription', name: schema.subscriptionType },
  ].filter((item): item is { label: string; name: string } => Boolean(item)), [schema]);

  const types = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (schema?.types ?? [])
      .filter((type) => !type.name.startsWith('__'))
      .filter((type) => !needle
        || type.name.toLowerCase().includes(needle)
        || (type.description ?? '').toLowerCase().includes(needle)
        || type.fields.some((field) => field.name.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [schema, search]);

  return (
    <div className="graphql-schema">
      <div className="graphql-schema-toolbar">
        {selected
          ? <button className="secondary-button compact" onClick={back}><ArrowLeft size={13} /> {t('Back')}</button>
          : <button className="secondary-button compact" disabled={loading} onClick={onLoad}><RefreshCw size={13} className={loading ? 'spin' : ''} /> {t('Load schema')}</button>}
        {selected
          ? <strong className="graphql-schema-title">{selected.name}<span>{selected.kind}</span></strong>
          : <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search schema')} spellCheck={false} />}
      </div>

      {!schema ? (
        <div className="page-empty">
          <strong>{t('No schema loaded')}</strong>
          <span>{t('Run GraphQL introspection to browse types and fields.')}</span>
        </div>
      ) : selected ? (
        <div className="graphql-schema-list">
          {selected.description && <p className="graphql-type-description">{selected.description}</p>}
          {selected.interfaces.length > 0 && (
            <div className="graphql-detail-group"><h4>{t('Implements')}</h4>{selected.interfaces.map((name) => <button key={name} className="graphql-type-link" onClick={() => open(name)}>{name}</button>)}</div>
          )}
          {selected.possibleTypes.length > 0 && (
            <div className="graphql-detail-group"><h4>{t('Possible types')}</h4>{selected.possibleTypes.map((name) => <button key={name} className="graphql-type-link" onClick={() => open(name)}>{name}</button>)}</div>
          )}
          {selected.fields.length > 0 && (
            <div className="graphql-detail-group">
              <h4>{t('Fields')}</h4>
              {selected.fields.map((field) => (
                <article key={field.name} className={`graphql-field ${field.isDeprecated ? 'deprecated' : ''}`}>
                  <div className="graphql-field-signature">
                    <strong>{field.name}</strong>
                    {field.args.length > 0 && <span>(</span>}
                    {field.args.map((arg, index) => (
                      <span key={arg.name}>{index > 0 && ', '}{arg.name}: <TypeLink typeRef={arg.type} onOpen={open} />{arg.defaultValue ? ` = ${arg.defaultValue}` : ''}</span>
                    ))}
                    {field.args.length > 0 && <span>)</span>}
                    <span>: </span><TypeLink typeRef={field.type} onOpen={open} />
                  </div>
                  {field.description && <p>{field.description}</p>}
                  {field.isDeprecated && <p className="graphql-deprecation">{t('Deprecated')}{field.deprecationReason ? `: ${field.deprecationReason}` : ''}</p>}
                </article>
              ))}
            </div>
          )}
          {selected.inputFields.length > 0 && (
            <div className="graphql-detail-group">
              <h4>{t('Input fields')}</h4>
              {selected.inputFields.map((field) => (
                <article key={field.name} className="graphql-field">
                  <div className="graphql-field-signature"><strong>{field.name}</strong><span>: </span><TypeLink typeRef={field.type} onOpen={open} />{field.defaultValue ? ` = ${field.defaultValue}` : ''}</div>
                  {field.description && <p>{field.description}</p>}
                </article>
              ))}
            </div>
          )}
          {selected.enumValues.length > 0 && (
            <div className="graphql-detail-group">
              <h4>{t('Values')}</h4>
              {selected.enumValues.map((value) => (
                <article key={value.name} className={`graphql-field ${value.isDeprecated ? 'deprecated' : ''}`}>
                  <div className="graphql-field-signature"><strong>{value.name}</strong></div>
                  {value.description && <p>{value.description}</p>}
                </article>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="graphql-schema-list">
          {roots.length > 0 && !search && (
            <div className="graphql-schema-roots">{roots.map((root) => <button key={root.label} className="graphql-type-link" onClick={() => open(root.name)}>{root.label}: {root.name}</button>)}</div>
          )}
          {types.map((type) => (
            <article className="graphql-schema-type" key={type.name} role="button" tabIndex={0} onClick={() => open(type.name)} onKeyDown={(event) => { if (event.key === 'Enter') open(type.name); }}>
              <header>
                <strong>{type.name}</strong>
                <span>{type.kind}</span>
              </header>
              {type.description && <p>{type.description}</p>}
              {type.fields.length > 0 && (
                <div className="graphql-schema-fields">
                  {type.fields.slice(0, 12).map((field) => <code key={field.name}>{field.name}</code>)}
                  {type.fields.length > 12 && <code>+{type.fields.length - 12}</code>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
