import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('omnimux.mjs path 输出 monorepo 的 plugins 产品树与 app 目录', () => {
  const repoRoot = resolve(root, '..');
  const result = spawnSync(process.execPath, [join(root, 'scripts/omnimux.mjs'), 'path'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`product: ${root}\n`), result.stdout);
  assert.ok(result.stdout.includes(`plugins: ${join(root, 'plugins')}\n`), result.stdout);
  assert.ok(result.stdout.includes(`fork: ${join(repoRoot, 'app')}\n`), result.stdout);
});
