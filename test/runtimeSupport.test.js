import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('runtime support policy', () => {
  test('package engines match native dependency support', () => {
    const pkg = JSON.parse(readText('package.json'));
    const lock = JSON.parse(readText('package-lock.json'));

    assert.strictEqual(pkg.engines.node, '20.x || 22.x || 24.x');
    assert.strictEqual(pkg.dependencies['better-sqlite3'], '^12.9.0');
    assert.strictEqual(lock.packages[''].engines.node, pkg.engines.node);
  });

  test('npm enforces the declared runtime support range', () => {
    assert.match(readText('.npmrc'), /^engine-strict=true\s*$/m);
  });

  test('CI matrix documents the supported Node versions', () => {
    const ci = readText('.github/workflows/ci.yml');

    assert.match(ci, /node-version:\s*\[20\.x, 22\.x, 24\.x\]/);
    assert.doesNotMatch(ci, /Node 24 is intentionally excluded/);
  });
});