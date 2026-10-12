import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGraphql } from '../src/services/graphql/format.ts';
import { listGraphqlOperations, operationNameProblem, tokenizeGraphql } from '../src/services/graphql/lexer.ts';
import { fieldSignature, namedTypeOf, parseIntrospection, typeRefToString } from '../src/services/graphql/schema.ts';
import { graphqlCompletions } from '../src/services/graphql/completion.ts';
import { zhCN } from '../src/i18n/messages.ts';

const named = (kind, name) => ({ kind, name, ofType: null });
const nonNull = (ofType) => ({ kind: 'NON_NULL', name: null, ofType });
const list = (ofType) => ({ kind: 'LIST', name: null, ofType });
const field = (name, type, args = []) => ({ name, description: `${name} docs`, args, type, isDeprecated: name === 'legacy' });
const arg = (name, type) => ({ name, description: null, defaultValue: null, type });
const type = (kind, name, extra = {}) => ({ kind, name, description: null, fields: null, inputFields: null, enumValues: null, interfaces: [], possibleTypes: null, ...extra });

const schema = parseIntrospection({
  data: {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      subscriptionType: null,
      types: [
        type('OBJECT', 'Query', { fields: [
          field('user', named('OBJECT', 'User'), [arg('id', nonNull(named('SCALAR', 'ID')))]),
          field('search', list(named('UNION', 'SearchResult')), [arg('term', named('SCALAR', 'String')), arg('order', named('ENUM', 'Order'))]),
        ] }),
        type('OBJECT', 'Mutation', { fields: [field('rename', named('OBJECT', 'User'), [arg('name', nonNull(named('SCALAR', 'String')))])] }),
        type('OBJECT', 'User', { fields: [
          field('id', nonNull(named('SCALAR', 'ID'))),
          field('name', named('SCALAR', 'String')),
          field('legacy', named('SCALAR', 'String')),
          field('friends', nonNull(list(nonNull(named('OBJECT', 'User')))), [arg('first', named('SCALAR', 'Int'))]),
        ] }),
        type('OBJECT', 'Post', { fields: [field('title', named('SCALAR', 'String'))] }),
        type('UNION', 'SearchResult', { possibleTypes: [{ name: 'User' }, { name: 'Post' }] }),
        type('ENUM', 'Order', { enumValues: [{ name: 'ASC' }, { name: 'DESC', isDeprecated: true }] }),
        type('SCALAR', 'ID'), type('SCALAR', 'String'), type('SCALAR', 'Int'),
        type('OBJECT', '__Schema'),
      ],
    },
  },
});

const labels = (source) => {
  const offset = source.indexOf('|');
  return graphqlCompletions(schema, source.replace('|', ''), offset).map((item) => item.label);
};

test('tokenizer skips commas and keeps strings, spreads and variables intact', () => {
  const tokens = tokenizeGraphql('a(b: "x, {y}", c: $v) { ...F } # note\n"""block "" text"""');
  assert.deepEqual(tokens.map((token) => token.kind), ['name', 'punctuator', 'name', 'punctuator', 'string', 'name', 'punctuator', 'variable', 'punctuator', 'punctuator', 'spread', 'name', 'punctuator', 'comment', 'blockString']);
  assert.equal(tokens[4].value, '"x, {y}"');
});

test('formatter produces stable, indented output', () => {
  const source = 'query Q($id:ID!,$n:Int=10){user(id:$id){id,name ...on Admin{level} friends(first:$n,where:{tags:["a","b"]})@include(if:true){id} alias:name}}\nfragment F on User{id}';
  const expected = [
    'query Q($id: ID!, $n: Int = 10) {',
    '  user(id: $id) {',
    '    id',
    '    name',
    '    ... on Admin {',
    '      level',
    '    }',
    '    friends(first: $n, where: { tags: ["a", "b"] }) @include(if: true) {',
    '      id',
    '    }',
    '    alias: name',
    '  }',
    '}',
    '',
    'fragment F on User {',
    '  id',
    '}',
    '',
  ].join('\n');
  assert.equal(formatGraphql(source), expected);
  assert.equal(formatGraphql(expected), expected);
  assert.equal(formatGraphql('   '), '');
  assert.equal(formatGraphql('{ a(f: {}, g: {x: 1}) { b } }'), '{\n  a(f: {}, g: { x: 1 }) {\n    b\n  }\n}\n');
  assert.match(formatGraphql('{ a # keep me\n b }'), /# keep me\n {2}b/);
});

test('operations and operation-name validation', () => {
  assert.deepEqual(listGraphqlOperations('query A { a } mutation B { b } fragment F on T { c } { d }'), [
    { type: 'query', name: 'A' }, { type: 'mutation', name: 'B' }, { type: 'query' },
  ]);
  assert.equal(operationNameProblem('query A { a } query B { b }', ''), 'Choose an operation name: the query defines several operations.');
  assert.equal(operationNameProblem('query A { a } query B { b }', 'B'), null);
  assert.equal(operationNameProblem('query A { a }', 'C'), 'Operation name not found in the query.');
  assert.equal(operationNameProblem('{ a }', ''), null);
  for (const key of ['Choose an operation name: the query defines several operations.', 'Operation name not found in the query.']) {
    assert.ok(Object.hasOwn(zhCN, key), key);
  }
});

test('introspection types render in SDL notation', () => {
  const friends = schema.byName.get('User').fields.find((item) => item.name === 'friends');
  assert.equal(typeRefToString(friends.type), '[User!]!');
  assert.equal(namedTypeOf(friends.type), 'User');
  assert.equal(fieldSignature(friends), 'friends(first: Int): [User!]!');
  assert.throws(() => parseIntrospection({ errors: [{ message: 'introspection disabled' }] }), /introspection disabled/);
  assert.throws(() => parseIntrospection({ data: {} }));
});

test('completion follows the cursor through selections, arguments and fragments', () => {
  assert.deepEqual(labels('|'), ['query', 'mutation', 'subscription', 'fragment']);
  assert.deepEqual(labels('{ |'), ['user', 'search', '__typename']);
  assert.deepEqual(labels('query { user(id: 1) { na| } }'), ['id', 'name', 'legacy', 'friends', '__typename']);
  assert.deepEqual(labels('{ user { friends(first: 2) { friends { | } } } }'), ['id', 'name', 'legacy', 'friends', '__typename']);
  assert.deepEqual(labels('{ me: user(|) { id } }'), ['id']);
  assert.deepEqual(labels('{ search(term: "x", |) }'), ['term', 'order']);
  assert.deepEqual(labels('{ search(order: |) }'), ['ASC', 'DESC']);
  assert.deepEqual(labels('{ search { ... on | } }'), ['User', 'Post']);
  assert.deepEqual(labels('{ search { ... on Post { | } } }'), ['title', '__typename']);
  assert.deepEqual(labels('mutation { rename(name: "n") { | } }'), ['id', 'name', 'legacy', 'friends', '__typename']);
  assert.deepEqual(labels('fragment F on User { | }'), ['id', 'name', 'legacy', 'friends', '__typename']);
  assert.deepEqual(labels('{ user @include(if: |) { id } }'), []);
  assert.deepEqual(labels('query Q($id: ID!) { user(id: $id) { | } }'), ['id', 'name', 'legacy', 'friends', '__typename']);
  assert.deepEqual(labels('{ unknown { | } }'), []);
  const user = graphqlCompletions(schema, '{ user { } }', 9).find((item) => item.label === 'friends');
  assert.equal(user.detail, '[User!]!');
  assert.equal(graphqlCompletions(schema, '{ user { } }', 9).find((item) => item.label === 'legacy').deprecated, true);
});
