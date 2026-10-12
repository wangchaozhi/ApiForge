// GraphQL introspection model used by the schema browser and editor completion.

export type GraphqlTypeRef = { kind: string; name?: string | null; ofType?: GraphqlTypeRef | null };

export type GraphqlInputValue = {
  name: string;
  description?: string | null;
  type: GraphqlTypeRef;
  defaultValue?: string | null;
};

export type GraphqlField = {
  name: string;
  description?: string | null;
  args: GraphqlInputValue[];
  type: GraphqlTypeRef;
  isDeprecated?: boolean;
  deprecationReason?: string | null;
};

export type GraphqlEnumValue = { name: string; description?: string | null; isDeprecated?: boolean; deprecationReason?: string | null };

export type GraphqlNamedType = {
  kind: string;
  name: string;
  description?: string | null;
  fields: GraphqlField[];
  inputFields: GraphqlInputValue[];
  enumValues: GraphqlEnumValue[];
  interfaces: string[];
  possibleTypes: string[];
};

export type GraphqlSchema = {
  queryType?: string;
  mutationType?: string;
  subscriptionType?: string;
  types: GraphqlNamedType[];
  byName: Map<string, GraphqlNamedType>;
};

function typeRefSelection(depth: number): string {
  return depth <= 0 ? 'kind name' : `kind name ofType { ${typeRefSelection(depth - 1)} }`;
}

/**
 * Builds the introspection query. `ofTypeDepth` bounds how many list/non-null wrappers are
 * resolved; servers with query-depth limits may need a shallower query.
 */
export function buildIntrospectionQuery(ofTypeDepth = 6) {
  const typeRef = typeRefSelection(ofTypeDepth);
  // Arguments sit one level deeper than field types, so they get one wrapper less.
  const argTypeRef = typeRefSelection(Math.max(0, ofTypeDepth - 1));
  return `query ApiForgeIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args { name description defaultValue type { ${argTypeRef} } }
        type { ${typeRef} }
        isDeprecated
        deprecationReason
      }
      inputFields { name description defaultValue type { ${typeRef} } }
      interfaces { name }
      enumValues(includeDeprecated: true) { name description isDeprecated deprecationReason }
      possibleTypes { name }
    }
  }
}`;
}

/** Type-reference depths tried in order: full detail first, then depth-limit friendly. */
export const INTROSPECTION_DEPTHS = [6, 4, 3, 2, 1];

type RawType = {
  kind: string;
  name: string;
  description?: string | null;
  fields?: Array<Partial<GraphqlField> & { name: string }> | null;
  inputFields?: GraphqlInputValue[] | null;
  enumValues?: GraphqlEnumValue[] | null;
  interfaces?: Array<{ name: string }> | null;
  possibleTypes?: Array<{ name: string }> | null;
};

type IntrospectionPayload = {
  data?: {
    __schema?: {
      queryType?: { name: string } | null;
      mutationType?: { name: string } | null;
      subscriptionType?: { name: string } | null;
      types?: RawType[];
    };
  };
  errors?: Array<{ message?: string }>;
};

const UNKNOWN_TYPE: GraphqlTypeRef = { kind: 'SCALAR', name: 'Unknown' };

/** Normalizes an introspection response. Throws with the server's messages on errors. */
export function parseIntrospection(payload: unknown): GraphqlSchema {
  const body = payload as IntrospectionPayload;
  if (body?.errors?.length) {
    throw new Error(body.errors.map((item) => item.message ?? 'GraphQL error').join('\n'));
  }
  const schema = body?.data?.__schema;
  if (!schema?.types) throw new Error('The response does not contain an introspection schema.');
  const types = schema.types.map((type): GraphqlNamedType => ({
    kind: type.kind,
    name: type.name,
    description: type.description,
    fields: (type.fields ?? []).map((field) => ({
      name: field.name,
      description: field.description,
      args: field.args ?? [],
      type: field.type ?? UNKNOWN_TYPE,
      isDeprecated: field.isDeprecated,
      deprecationReason: field.deprecationReason,
    })),
    inputFields: type.inputFields ?? [],
    enumValues: type.enumValues ?? [],
    interfaces: (type.interfaces ?? []).map((item) => item.name),
    possibleTypes: (type.possibleTypes ?? []).map((item) => item.name),
  }));
  return {
    queryType: schema.queryType?.name,
    mutationType: schema.mutationType?.name ?? undefined,
    subscriptionType: schema.subscriptionType?.name ?? undefined,
    types,
    byName: new Map(types.map((type) => [type.name, type])),
  };
}

/** Renders a type reference in SDL notation, e.g. `[User!]!`. */
export function typeRefToString(ref: GraphqlTypeRef | null | undefined): string {
  if (!ref) return 'Unknown';
  if (ref.kind === 'NON_NULL') return `${typeRefToString(ref.ofType)}!`;
  if (ref.kind === 'LIST') return `[${typeRefToString(ref.ofType)}]`;
  return ref.name ?? 'Unknown';
}

/** Unwraps lists and non-null wrappers to the named type. */
export function namedTypeOf(ref: GraphqlTypeRef | null | undefined): string | undefined {
  let current = ref;
  while (current && !current.name) current = current.ofType;
  return current?.name ?? undefined;
}

export function fieldSignature(field: GraphqlField) {
  const args = field.args.length
    ? `(${field.args.map((arg) => `${arg.name}: ${typeRefToString(arg.type)}`).join(', ')})`
    : '';
  return `${field.name}${args}: ${typeRefToString(field.type)}`;
}

/** Field lookup that also knows the meta field available on every composite type. */
export function findField(schema: GraphqlSchema, typeName: string | undefined, fieldName: string) {
  if (!typeName) return undefined;
  if (fieldName === '__typename') return { name: '__typename', args: [], type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'String' } } } satisfies GraphqlField;
  return schema.byName.get(typeName)?.fields.find((field) => field.name === fieldName);
}
