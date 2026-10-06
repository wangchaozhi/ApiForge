import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const sourceFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
});
const nameOf = (path) => relative(root, path).split(sep).join('/');
const graph = new Map(sourceFiles(root).map((path) => {
  const source = readFileSync(path, 'utf8');
  const imports = [...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)]
    .map((match) => match[1]).filter((spec) => spec.startsWith('.'))
    .map((spec) => resolve(dirname(path), spec));
  return [path, imports];
}));

test('module imports resolve and lower layers do not depend on UI or state', () => {
  for (const [path, dependencies] of graph) {
    const name = nameOf(path);
    for (const dependency of dependencies) {
      const target = nameOf(dependency);
      assert.ok(existsSync(dependency), `${name} imports missing ${target}`);
      if (name.startsWith('domain/')) assert.ok(target.startsWith('domain/'), `${name} depends on ${target}`);
      if (/^(services|platform|shared)\//.test(name)) {
        assert.ok(!/^(app|features|store)\//.test(target), `${name} depends on ${target}`);
      }
      if (name.startsWith('store/')) assert.ok(!/^(app|features|services|shared)\//.test(target), `${name} depends on ${target}`);
      if (!/^(lib|types)\//.test(name)) {
        assert.ok(!/^lib\/(request|curl|history|openapi)\.ts$/.test(target) && target !== 'types/api.ts', `${name} must import its module directly`);
      }
    }
  }
});

test('source modules have no circular local dependencies', () => {
  const visited = new Set();
  const active = new Set();
  const visit = (path, trail) => {
    assert.ok(!active.has(path), `Circular dependency: ${[...trail, path].map(nameOf).join(' -> ')}`);
    if (visited.has(path)) return;
    active.add(path);
    for (const dependency of graph.get(path) ?? []) visit(dependency, [...trail, path]);
    active.delete(path);
    visited.add(path);
  };
  for (const path of graph.keys()) visit(path, []);
});
