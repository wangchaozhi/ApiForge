import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { requestToCurl, curlToRequest } from '../src/lib/curl.ts';

const network = { timeoutMs: 30000, followRedirects: true, verifyTls: true, cookiesEnabled: true, useSystemProxy: true, proxyUrl: '' };
const request = (body) => ({
  id: 'test', name: 'Test', method: 'POST', url: 'https://example.com/?a=one&b=two',
  params: [], headers: [], bodyType: 'raw', body, formFields: [], multipartFields: [], auth: { type: 'none' },
});

test('cURL export quotes shell operators and preserves apostrophes on import', () => {
  const original = request("It's a value & another?value");
  const command = requestToCurl(original, {}, network);
  assert.ok(command.includes("'https://example.com/?a=one&b=two'"));
  const imported = curlToRequest(command);
  assert.equal(imported.body, original.body);
  assert.deepEqual(imported.params.map(({ key, value }) => [key, value]), [['a', 'one'], ['b', 'two']]);
});

test('POSIX shell receives exported URL and body as literal arguments', { skip: process.platform === 'win32' }, () => {
  // Replace curl with an argument printer: no network requests are performed.
  for (const body of ['a&b', 'file?name', "it's literal", '$(printf unexpected)', '']) {
    const command = requestToCurl(request(body), {}, network);
    const result = spawnSync('/bin/sh', ['-c', 'curl() { printf "%s\\000" "$@"; };\n' + command], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const args = result.stdout.split('\0');
    assert.ok(args.includes('https://example.com/?a=one&b=two'));
    assert.equal(args[args.indexOf('--data-raw') + 1], body);
  }
});
