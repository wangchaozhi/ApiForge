import { useEffect } from 'react';
import { graphqlCompletions, type GraphqlCompletionKind } from '../../services/graphql/completion.ts';
import type { GraphqlSchema } from '../../services/graphql/schema.ts';
import { monaco } from '../../shared/editor/runtime.ts';

// Monaco completion providers are global per language; the provider reads the schema of
// the most recently mounted GraphQL panel.
let activeSchema: GraphqlSchema | null = null;
let registered = false;

const kinds: Record<GraphqlCompletionKind, monaco.languages.CompletionItemKind> = {
  field: monaco.languages.CompletionItemKind.Field,
  argument: monaco.languages.CompletionItemKind.Variable,
  type: monaco.languages.CompletionItemKind.Class,
  enum: monaco.languages.CompletionItemKind.EnumMember,
  keyword: monaco.languages.CompletionItemKind.Keyword,
};

function register() {
  if (registered) return;
  registered = true;
  monaco.languages.registerCompletionItemProvider('graphql', {
    triggerCharacters: ['{', '(', ':', ' ', '\n'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const suggestions = graphqlCompletions(activeSchema ?? emptySchema, model.getValue(), model.getOffsetAt(position))
        .filter((item) => activeSchema || item.kind === 'keyword')
        .map((item): monaco.languages.CompletionItem => ({
          label: item.label,
          kind: kinds[item.kind],
          detail: item.detail,
          documentation: item.documentation,
          insertText: item.kind === 'argument' ? `${item.label}: ` : item.label,
          tags: item.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
          sortText: item.deprecated ? `~${item.label}` : item.label,
          range,
        }));
      return { suggestions };
    },
  });
}

const emptySchema: GraphqlSchema = { types: [], byName: new Map() };

/** Feeds the loaded schema to GraphQL editor completion while the panel is mounted. */
export function useGraphqlCompletion(schema: GraphqlSchema | null) {
  useEffect(() => {
    register();
    activeSchema = schema;
    return () => {
      if (activeSchema === schema) activeSchema = null;
    };
  }, [schema]);
}
