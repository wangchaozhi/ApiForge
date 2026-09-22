import { translate as t } from '../i18n';
import YAML from 'yaml';
import { createId } from './id';
import type { ApiCollection, ApiRequest, AuthConfig, HttpMethod, KeyValue, MultipartField } from '../types/api';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

type AnyRecord = Record<string, any>;

type ImportedOpenApi = {
  collection: ApiCollection;
  requests: ApiRequest[];
};

function row(key = '', value = '', enabled = true): KeyValue {
  return { id: createId('kv'), key, value, enabled };
}

function multipartRow(key = '', value = '', kind: 'text' | 'file' = 'text'): MultipartField {
  return { ...row(key, value), kind };
}

function schemaExample(schema: AnyRecord | undefined): unknown {
  if (!schema) return {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.type === 'array') return [schemaExample(schema.items)];
  if (schema.type === 'object' || schema.properties) {
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [key, schemaExample(value as AnyRecord)]),
    );
  }
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  return '';
}

function resolveRef(document: AnyRecord, value: any): any {
  if (!value?.$ref || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value;
  return value.$ref
    .slice(2)
    .split('/')
    .reduce((current: any, part: string) => current?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], document) ?? value;
}

function securityAuth(document: AnyRecord, operation: AnyRecord, pathItem: AnyRecord): AuthConfig {
  const security = operation.security ?? pathItem.security ?? document.security;
  if (!Array.isArray(security) || !security.length) return { type: 'none' };
  const schemes = document.components?.securitySchemes ?? document.securityDefinitions ?? {};
  for (const requirement of security) {
    for (const name of Object.keys(requirement ?? {})) {
      const scheme = resolveRef(document, schemes[name]);
      if (!scheme) continue;
      if ((scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer')) {
        return { type: 'bearer', token: `{{${name}_token}}` };
      }
      if ((scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'basic') || scheme.type === 'basic') {
        return { type: 'basic', username: `{{${name}_username}}`, password: `{{${name}_password}}` };
      }
      if (scheme.type === 'apiKey' && scheme.name) {
        return {
          type: 'apiKey',
          key: scheme.name,
          value: `{{${name}}}`,
          addTo: scheme.in === 'query' ? 'query' : 'header',
        };
      }
    }
  }
  return { type: 'none' };
}

function multipartFieldsFromSchema(document: AnyRecord, schema: AnyRecord | undefined): MultipartField[] {
  const resolved = resolveRef(document, schema) ?? {};
  const fields = Object.entries(resolved.properties ?? {}).map(([key, value]) => {
    const property = resolveRef(document, value) ?? {};
    const isFile = property.type === 'string' && (property.format === 'binary' || property.format === 'base64');
    return multipartRow(key, isFile ? '' : String(schemaExample(property) ?? ''), isFile ? 'file' : 'text');
  });
  return fields.length ? fields : [multipartRow()];
}

function requestBody(document: AnyRecord, operation: AnyRecord, parameters: AnyRecord[]) {
  const bodyDefinition = resolveRef(document, operation.requestBody);
  const content = bodyDefinition?.content ?? {};
  const json = content['application/json'] ?? content['application/*+json'];
  if (json) {
    const example = json.example ?? schemaExample(resolveRef(document, json.schema));
    return { bodyType: 'json' as const, body: JSON.stringify(example ?? {}, null, 2) };
  }

  const multipart = content['multipart/form-data'];
  if (multipart) {
    return {
      bodyType: 'form-data' as const,
      multipartFields: multipartFieldsFromSchema(document, multipart.schema),
    };
  }

  const urlencoded = content['application/x-www-form-urlencoded'];
  if (urlencoded) {
    const schema = resolveRef(document, urlencoded.schema);
    const example = schemaExample(schema) as AnyRecord;
    return {
      bodyType: 'form-urlencoded' as const,
      formFields: Object.entries(example ?? {}).map(([key, value]) => row(key, String(value ?? ''))),
    };
  }

  // Swagger 2 body/formData compatibility.
  const bodyParameter = parameters.find((parameter) => parameter.in === 'body');
  if (bodyParameter?.schema) {
    return {
      bodyType: 'json' as const,
      body: JSON.stringify(bodyParameter.example ?? schemaExample(resolveRef(document, bodyParameter.schema)), null, 2),
    };
  }

  const formData = parameters.filter((parameter) => parameter.in === 'formData');
  if (formData.length) {
    const consumes = operation.consumes ?? document.consumes ?? [];
    const needsMultipart = consumes.includes('multipart/form-data') || formData.some((parameter) => parameter.type === 'file');
    if (needsMultipart) {
      return {
        bodyType: 'form-data' as const,
        multipartFields: formData.map((parameter) => multipartRow(
          parameter.name ?? '',
          parameter.type === 'file' ? '' : String(parameter.default ?? parameter.example ?? ''),
          parameter.type === 'file' ? 'file' : 'text',
        )),
      };
    }
    return {
      bodyType: 'form-urlencoded' as const,
      formFields: formData.map((parameter) => row(parameter.name ?? '', String(parameter.default ?? parameter.example ?? ''))),
    };
  }

  return { bodyType: 'none' as const };
}

function buildUrl(baseUrl: string, path: string, parameters: AnyRecord[]) {
  let url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const params: KeyValue[] = [];
  for (const parameter of parameters) {
    const schema = parameter.schema ?? {};
    const value = parameter.example ?? schema.example ?? schema.default ?? parameter.default ?? '';
    if (parameter.in === 'path') {
      url = url.replace(`{${parameter.name}}`, `{{${parameter.name}}}`);
    } else if (parameter.in === 'query') {
      params.push(row(parameter.name ?? '', String(value)));
    }
  }
  return { url, params: params.length ? params : [row()] };
}

function openApiBaseUrl(document: AnyRecord) {
  const server = document.servers?.[0]?.url;
  if (server) return String(server).replace(/\{([^{}]+)\}/g, (_match: string, variable: string) => {
    const value = document.servers?.[0]?.variables?.[variable]?.default;
    return value === undefined ? `{{${variable}}}` : String(value);
  });
  if (document.swagger === '2.0') {
    return `${document.schemes?.[0] ?? 'https'}://${document.host ?? 'example.com'}${document.basePath ?? ''}`;
  }
  return 'https://example.com';
}

export function parseOpenApi(source: string, fileName = 'OpenAPI'): ImportedOpenApi {
  const document = YAML.parse(source) as AnyRecord;
  if (!document || typeof document !== 'object' || (!document.openapi && !document.swagger)) {
    throw new Error(t("The selected file is not an OpenAPI/Swagger document."));
  }

  const collectionId = createId('col');
  const collectionName = document.info?.title || fileName.replace(/\.(ya?ml|json)$/i, '') || 'Imported API';
  const baseUrl = openApiBaseUrl(document);

  const requests: ApiRequest[] = [];
  const folderIds = new Map<string, string>();
  const folderRequests = new Map<string, string[]>();
  const rootRequestIds: string[] = [];

  for (const [path, pathItemValue] of Object.entries(document.paths ?? {})) {
    const pathItem = resolveRef(document, pathItemValue) as AnyRecord;
    for (const method of METHODS) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      const requestId = createId('req');
      const tag = operation.tags?.[0] as string | undefined;
      if (tag) {
        if (!folderIds.has(tag)) folderIds.set(tag, createId('folder'));
        folderRequests.set(tag, [...(folderRequests.get(tag) ?? []), requestId]);
      } else {
        rootRequestIds.push(requestId);
      }

      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
        .map((item) => resolveRef(document, item));
      const { url, params } = buildUrl(baseUrl, path, parameters);
      const headers = parameters
        .filter((item) => item.in === 'header')
        .map((item) => row(item.name ?? '', String(item.example ?? item.schema?.default ?? item.default ?? '')));
      const body = requestBody(document, operation, parameters);

      requests.push({
        id: requestId,
        name: operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase() as HttpMethod,
        url,
        params,
        headers: headers.length ? [...headers, row()] : [row()],
        bodyType: body.bodyType,
        body: body.bodyType === 'json' ? body.body : '',
        formFields: body.bodyType === 'form-urlencoded' && body.formFields.length ? [...body.formFields, row()] : [row()],
        multipartFields: body.bodyType === 'form-data' && body.multipartFields.length ? [...body.multipartFields, multipartRow()] : [multipartRow()],
        auth: securityAuth(document, operation, pathItem),
      });
    }
  }

  if (!requests.length) throw new Error(t("No HTTP operations were found in this OpenAPI document."));

  return {
    collection: {
      id: collectionId,
      name: collectionName,
      requestIds: rootRequestIds,
      folders: [...folderIds.entries()].map(([name, id]) => ({ id, name, requestIds: folderRequests.get(name) ?? [] })),
    },
    requests,
  };
}
