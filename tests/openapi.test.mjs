import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenApi } from '../src/services/openapi/import.ts';

test('OpenAPI maps references, server defaults, folders, auth and JSON bodies', () => {
  const { collection, requests } = parseOpenApi(JSON.stringify({
    openapi: '3.0.0', info: { title: 'Pet API' },
    servers: [{ url: 'https://{region}.example.com', variables: { region: { default: 'eu' } } }],
    components: {
      schemas: { Pet: { type: 'object', properties: { name: { type: 'string', example: 'Milo' } } } },
      securitySchemes: { token: { type: 'http', scheme: 'bearer' } },
      parameters: { trace: { name: 'X-Trace', in: 'header', example: 'abc' } },
    },
    security: [{ token: [] }],
    paths: { '/pets/{id}': { parameters: [{ name: 'id', in: 'path' }, { $ref: '#/components/parameters/trace' }], post: {
      tags: ['Pets'], summary: 'Save pet', parameters: [{ name: 'tag', in: 'query', example: 'cat' }],
      requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
    } } },
  }));
  const [request] = requests;
  assert.equal(collection.name, 'Pet API');
  assert.deepEqual(collection.folders[0].requestIds, [request.id]);
  assert.equal(request.url, 'https://eu.example.com/pets/{{id}}');
  assert.equal(request.method, 'POST');
  assert.equal(request.params[0].value, 'cat');
  assert.equal(request.headers[0].value, 'abc');
  assert.deepEqual(JSON.parse(request.body), { name: 'Milo' });
  assert.deepEqual(request.auth, { type: 'bearer', token: '{{token_token}}' });
});

test('Swagger YAML maps multipart file fields and basic authentication', () => {
  const { requests } = parseOpenApi(`swagger: '2.0'
info:
  title: Upload API
host: example.com
basePath: /v1
securityDefinitions:
  basic: { type: basic }
security:
  - basic: []
paths:
  /upload:
    post:
      consumes: [multipart/form-data]
      parameters:
        - { in: formData, name: file, type: file }
        - { in: formData, name: label, type: string, default: photo }
      responses: {}
`);
  assert.equal(requests[0].url, 'https://example.com/v1/upload');
  assert.equal(requests[0].bodyType, 'form-data');
  assert.equal(requests[0].multipartFields[0].kind, 'file');
  assert.equal(requests[0].multipartFields[1].value, 'photo');
  assert.equal(requests[0].auth.type, 'basic');
});
