import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'useKeyboardShortcuts.ts'), 'utf8');

test('useKeyboardShortcuts 解构 onGroupSelected / onUngroupSelected，并写入 effect deps', () => {
  assert.match(src, /onGroupSelected,\s*\n\s*onUngroupSelected,/);
  const depsBlock = src.slice(src.lastIndexOf('}, ['));
  assert.match(depsBlock, /onGroupSelected/);
  assert.match(depsBlock, /onUngroupSelected/);
});
