import { translate as t } from '../../i18n/index.ts';
import YAML from 'yaml';
import { createId } from '../../lib/id.ts';
import type { ApiCollection } from '../../domain/workspace.ts';
import type { ApiRequest, HttpMethod } from '../../domain/request.ts';
import { row, multipartRow, resolveRef, type AnyRecord } from './schema.ts';
import { securityAuth } from './security.ts';
import { requestBody } from './body.ts';
import { buildUrl, openApiBaseUrl } from './url.ts';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

type ImportedOpenApi = {
  collection: ApiCollection;
  requests: ApiRequest[];
};

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
