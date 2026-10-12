// Minimal GraphQL lexer shared by the formatter, completion and operation helpers.

export type GraphqlTokenKind = 'name' | 'variable' | 'number' | 'string' | 'blockString' | 'punctuator' | 'spread' | 'comment';

export type GraphqlToken = {
  kind: GraphqlTokenKind;
  value: string;
  start: number;
  end: number;
};

const PUNCTUATORS = new Set(['{', '}', '(', ')', '[', ']', ':', '=', '@', '!', '|', '&', '$']);
const isNameStart = (char: string) => /[A-Za-z_]/.test(char);
const isNameChar = (char: string) => /[A-Za-z0-9_]/.test(char);

/** Tokenizes GraphQL source. Commas and whitespace are insignificant and skipped. */
export function tokenizeGraphql(source: string): GraphqlToken[] {
  const tokens: GraphqlToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === ',' || /\s/.test(char) || char === '﻿') {
      index += 1;
      continue;
    }
    const start = index;
    if (char === '#') {
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1;
      tokens.push({ kind: 'comment', value: source.slice(start, index), start, end: index });
      continue;
    }
    if (source.startsWith('"""', index)) {
      index += 3;
      while (index < source.length && !source.startsWith('"""', index)) {
        index += source.startsWith('\\"""', index) ? 4 : 1;
      }
      index = Math.min(source.length, index + 3);
      tokens.push({ kind: 'blockString', value: source.slice(start, index), start, end: index });
      continue;
    }
    if (char === '"') {
      index += 1;
      while (index < source.length && source[index] !== '"' && source[index] !== '\n') {
        index += source[index] === '\\' ? 2 : 1;
      }
      index = Math.min(source.length, index + 1);
      tokens.push({ kind: 'string', value: source.slice(start, index), start, end: index });
      continue;
    }
    if (source.startsWith('...', index)) {
      index += 3;
      tokens.push({ kind: 'spread', value: '...', start, end: index });
      continue;
    }
    if (char === '$' && isNameStart(source[index + 1] ?? '')) {
      index += 1;
      while (index < source.length && isNameChar(source[index])) index += 1;
      tokens.push({ kind: 'variable', value: source.slice(start, index), start, end: index });
      continue;
    }
    if (isNameStart(char)) {
      while (index < source.length && isNameChar(source[index])) index += 1;
      tokens.push({ kind: 'name', value: source.slice(start, index), start, end: index });
      continue;
    }
    if (char === '-' || /[0-9]/.test(char)) {
      index += 1;
      while (index < source.length && /[0-9.eE+-]/.test(source[index])) index += 1;
      tokens.push({ kind: 'number', value: source.slice(start, index), start, end: index });
      continue;
    }
    index += 1;
    tokens.push({ kind: PUNCTUATORS.has(char) ? 'punctuator' : 'name', value: char, start, end: index });
  }
  return tokens;
}

export type GraphqlOperation = { type: 'query' | 'mutation' | 'subscription'; name?: string };

/** Lists the executable operations defined at the top level of a document. */
export function listGraphqlOperations(source: string): GraphqlOperation[] {
  const tokens = tokenizeGraphql(source).filter((token) => token.kind !== 'comment');
  const operations: GraphqlOperation[] = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === '{' && token.kind === 'punctuator') {
      if (depth === 0) {
        const previous = tokens[index - 1];
        // A bare selection set is an anonymous query.
        if (!previous || (previous.kind === 'punctuator' && previous.value === '}')) operations.push({ type: 'query' });
      }
      depth += 1;
    } else if (token.value === '}' && token.kind === 'punctuator') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && token.kind === 'name' && (token.value === 'query' || token.value === 'mutation' || token.value === 'subscription')) {
      const next = tokens[index + 1];
      operations.push({ type: token.value, name: next?.kind === 'name' ? next.value : undefined });
    }
  }
  return operations;
}

/**
 * Returns a translation key when the operation name cannot be resolved for sending,
 * otherwise null. Servers require operationName when a document holds several operations.
 */
export function operationNameProblem(source: string, operationName: string) {
  const operations = listGraphqlOperations(source);
  const name = operationName.trim();
  if (name) {
    return operations.some((operation) => operation.name === name) ? null : 'Operation name not found in the query.' as const;
  }
  return operations.length > 1 ? 'Choose an operation name: the query defines several operations.' as const : null;
}
