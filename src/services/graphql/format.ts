import { tokenizeGraphql, type GraphqlToken } from './lexer.ts';

const INDENT = '  ';

const isPunct = (token: GraphqlToken | undefined, value: string) => token?.kind === 'punctuator' && token.value === value;

/** Does `token` begin a new field/spread inside a selection set, given the previous token? */
function startsSelection(token: GraphqlToken, previous: GraphqlToken | undefined, beforePrevious: GraphqlToken | undefined) {
  if (token.kind !== 'name' && token.kind !== 'spread') return false;
  if (!previous) return false;
  if (isPunct(previous, '{')) return false; // already on a fresh line
  if (isPunct(previous, ':') || isPunct(previous, '@') || previous.kind === 'spread') return false;
  // `... on Type`: the type condition follows `on`.
  if (previous.kind === 'name' && previous.value === 'on' && beforePrevious?.kind === 'spread') return false;
  return true;
}

/**
 * Pretty-prints a GraphQL document: one selection per line, two-space indentation,
 * inline arguments, variable definitions and object values. Comments are preserved on
 * their own lines. Invalid documents are formatted best-effort and never throw.
 */
export function formatGraphql(source: string): string {
  const tokens = tokenizeGraphql(source);
  if (!tokens.length) return '';

  let output = '';
  let depth = 0; // selection-set depth
  let inlineDepth = 0; // nesting inside (), [] or object values within ()
  const lineStart = () => `\n${INDENT.repeat(depth)}`;
  const trimEnd = () => { output = output.replace(/[ \t]+$/, ''); };

  let previous: GraphqlToken | undefined;
  let beforePrevious: GraphqlToken | undefined;
  for (const token of tokens) {
    const { value } = token;

    if (token.kind === 'comment') {
      if (output && !output.endsWith('\n')) {
        trimEnd();
        output += lineStart();
      }
      output += value + lineStart();
      continue;
    }

    if (inlineDepth > 0) {
      if (isPunct(token, '(') || isPunct(token, '[') || isPunct(token, '{')) {
        output += isPunct(previous, ':') ? ` ${value}` : value;
        if (isPunct(token, '{')) output += ' ';
        inlineDepth += 1;
      } else if (isPunct(token, ')') || isPunct(token, ']') || isPunct(token, '}')) {
        trimEnd();
        output += isPunct(token, '}') && !isPunct(previous, '{') ? ` ${value}` : value;
        inlineDepth -= 1;
      } else if (isPunct(token, ':')) {
        output += ':';
      } else if (isPunct(token, '!')) {
        output += '!';
      } else if (isPunct(token, '=')) {
        output += ' =';
      } else {
        const opener = isPunct(previous, '(') || isPunct(previous, '[') || isPunct(previous, '{');
        const separator = opener ? '' : isPunct(previous, ':') || isPunct(previous, '=') || isPunct(previous, '@') ? ' ' : ', ';
        output += (isPunct(previous, '@') ? '' : separator) + value;
      }
      beforePrevious = previous;
      previous = token;
      continue;
    }

    if (isPunct(token, '{')) {
      trimEnd();
      output += output && !output.endsWith('\n') ? ' {' : '{';
      depth += 1;
      output += lineStart();
    } else if (isPunct(token, '}')) {
      depth = Math.max(0, depth - 1);
      trimEnd();
      output = output.replace(/\n[ \t]*$/, '');
      output += `${lineStart()}}`;
      if (depth === 0) output += '\n\n';
    } else if (isPunct(token, '(') || isPunct(token, '[')) {
      trimEnd();
      output += value;
      inlineDepth += 1;
    } else if (isPunct(token, ':')) {
      trimEnd();
      output += ': ';
    } else if (isPunct(token, '@')) {
      trimEnd();
      output += output.endsWith('\n') || output.endsWith(' ') ? '@' : ' @';
    } else if (isPunct(token, '!')) {
      trimEnd();
      output += '!';
    } else if (isPunct(token, '=') || isPunct(token, '|') || isPunct(token, '&')) {
      trimEnd();
      output += ` ${value} `;
    } else {
      if (depth > 0 && startsSelection(token, previous, beforePrevious)) {
        trimEnd();
        output += output.endsWith('\n') ? INDENT.repeat(depth) : lineStart();
      } else if (output && !output.endsWith('\n') && !output.endsWith(' ') && !isPunct(previous, '@') && previous?.kind !== 'spread') {
        output += ' ';
      } else if (previous?.kind === 'spread' && token.kind === 'name' && token.value === 'on') {
        output += ' ';
      }
      output += value;
    }
    beforePrevious = previous;
    previous = token;
  }

  return output
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}
