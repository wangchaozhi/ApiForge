import { tokenizeGraphql, type GraphqlToken } from './lexer.ts';
import { findField, namedTypeOf, typeRefToString, type GraphqlInputValue, type GraphqlSchema } from './schema.ts';

export type GraphqlCompletionKind = 'field' | 'argument' | 'type' | 'enum' | 'keyword';

export type GraphqlCompletion = {
  label: string;
  kind: GraphqlCompletionKind;
  detail?: string;
  documentation?: string;
  deprecated?: boolean;
};

const KEYWORDS = ['query', 'mutation', 'subscription', 'fragment'];

type Frame = { type?: string };
type ArgumentFrame = { args: GraphqlInputValue[] };

const isPunct = (token: GraphqlToken | undefined, value: string) => token?.kind === 'punctuator' && token.value === value;

/**
 * Suggests completions for the cursor at `offset`: fields of the enclosing selection set,
 * arguments inside a field's parentheses, enum values for enum-typed arguments, type
 * conditions after `on`, and operation keywords at the top level.
 */
export function graphqlCompletions(schema: GraphqlSchema, source: string, offset: number): GraphqlCompletion[] {
  let tokens = tokenizeGraphql(source.slice(0, offset)).filter((token) => token.kind !== 'comment');
  // The word under the cursor is what the user is typing; context comes from before it.
  const last = tokens[tokens.length - 1];
  if (last && last.end === offset && (last.kind === 'name' || last.kind === 'variable')) tokens = tokens.slice(0, -1);

  const selections: Frame[] = [];
  const argumentStack: Array<ArgumentFrame | null> = [];
  let pendingRoot: string | undefined;
  let lastField: { parent?: string; name: string } | undefined;
  let inlineType: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];

    if (argumentStack.length) {
      if (isPunct(token, '(') || isPunct(token, '[') || isPunct(token, '{')) argumentStack.push(null);
      else if (isPunct(token, ')') || isPunct(token, ']') || isPunct(token, '}')) argumentStack.pop();
      continue;
    }

    if (selections.length === 0 && token.kind === 'name') {
      if (token.value === 'query') pendingRoot = schema.queryType;
      else if (token.value === 'mutation') pendingRoot = schema.mutationType;
      else if (token.value === 'subscription') pendingRoot = schema.subscriptionType;
      else if (previous?.kind === 'name' && previous.value === 'on') pendingRoot = token.value;
      continue;
    }

    if (isPunct(token, '(')) {
      // Variable definitions at the top level, or field arguments inside a selection set.
      const directive = isPunct(tokens[index - 2], '@');
      const field = selections.length && lastField && !directive ? findField(schema, lastField.parent, lastField.name) : undefined;
      argumentStack.push({ args: field?.args ?? [] });
      continue;
    }
    if (isPunct(token, '{')) {
      let type: string | undefined;
      if (!selections.length) type = pendingRoot ?? schema.queryType;
      else if (inlineType) type = inlineType;
      else if (lastField) type = namedTypeOf(findField(schema, lastField.parent, lastField.name)?.type);
      selections.push({ type });
      lastField = undefined;
      inlineType = undefined;
      continue;
    }
    if (isPunct(token, '}')) {
      selections.pop();
      lastField = undefined;
      inlineType = undefined;
      if (!selections.length) pendingRoot = undefined;
      continue;
    }
    if (token.kind === 'name' && selections.length) {
      const parent = selections[selections.length - 1].type;
      if (previous?.kind === 'name' && previous.value === 'on' && tokens[index - 2]?.kind === 'spread') {
        inlineType = token.value;
      } else if (!isPunct(previous, '@') && previous?.kind !== 'spread') {
        // For `alias: field`, the field replaces the alias.
        lastField = { parent, name: token.value };
        inlineType = undefined;
      }
    }
  }

  const previous = tokens[tokens.length - 1];

  if (argumentStack.length) {
    const frame = argumentStack[argumentStack.length - 1];
    if (!frame) return [];
    if (isPunct(previous, ':')) {
      // Enum argument values.
      const argName = tokens[tokens.length - 2]?.value;
      const arg = frame.args.find((item) => item.name === argName);
      const enumType = schema.byName.get(namedTypeOf(arg?.type) ?? '');
      return enumType?.kind === 'ENUM'
        ? enumType.enumValues.map((value) => ({ label: value.name, kind: 'enum' as const, documentation: value.description ?? undefined, deprecated: value.isDeprecated }))
        : [];
    }
    return frame.args.map((arg) => ({
      label: arg.name,
      kind: 'argument' as const,
      detail: typeRefToString(arg.type),
      documentation: arg.description ?? undefined,
    }));
  }

  if (!selections.length) {
    if (previous?.kind === 'name' && previous.value === 'on') return compositeTypes(schema);
    return KEYWORDS.map((keyword) => ({ label: keyword, kind: 'keyword' as const }));
  }

  if (previous?.kind === 'name' && previous.value === 'on' && tokens[tokens.length - 2]?.kind === 'spread') {
    const parent = schema.byName.get(selections[selections.length - 1].type ?? '');
    const candidates = parent?.possibleTypes.length ? parent.possibleTypes : parent ? [parent.name] : [];
    return candidates.map((name) => ({ label: name, kind: 'type' as const }));
  }
  if (previous?.kind === 'spread') return [{ label: 'on', kind: 'keyword' }];

  const parentType = schema.byName.get(selections[selections.length - 1].type ?? '');
  if (!parentType) return [];
  return [
    ...parentType.fields.map((field) => ({
      label: field.name,
      kind: 'field' as const,
      detail: typeRefToString(field.type),
      documentation: field.description ?? undefined,
      deprecated: field.isDeprecated,
    })),
    { label: '__typename', kind: 'field' as const, detail: 'String!' },
  ];
}

function compositeTypes(schema: GraphqlSchema): GraphqlCompletion[] {
  return schema.types
    .filter((type) => !type.name.startsWith('__') && ['OBJECT', 'INTERFACE', 'UNION'].includes(type.kind))
    .map((type) => ({ label: type.name, kind: 'type' as const, documentation: type.description ?? undefined }));
}
