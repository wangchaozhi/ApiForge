import type { MultipartField } from '../../domain/request.ts';
import { row, multipartRow, resolveRef, schemaExample, type AnyRecord } from './schema.ts';

function multipartFieldsFromSchema(document: AnyRecord, schema: AnyRecord | undefined): MultipartField[] {
  const resolved = resolveRef(document, schema) ?? {};
  const fields = Object.entries(resolved.properties ?? {}).map(([key, value]) => {
    const property = resolveRef(document, value) ?? {};
    const isFile = property.type === 'string' && (property.format === 'binary' || property.format === 'base64');
    return multipartRow(key, isFile ? '' : String(schemaExample(property) ?? ''), isFile ? 'file' : 'text');
  });
  return fields.length ? fields : [multipartRow()];
}

export function requestBody(document: AnyRecord, operation: AnyRecord, parameters: AnyRecord[]) {
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
