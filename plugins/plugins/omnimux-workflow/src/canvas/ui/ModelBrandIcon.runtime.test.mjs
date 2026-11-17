import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { buildSync } from 'esbuild';

const here = fileURLToPath(new URL('.', import.meta.url));

test('Muse models resolve to the Muse brand and expose the neutral M mark', async () => {
  const bundlePath = join(mkdtempSync(join(tmpdir(), 'omnimux-brand-icon-')), 'runtime.mjs');
  buildSync({
    stdin: {
      contents: "export { BRAND_SVGS, resolveModelBrand } from './ModelBrandIcon.tsx';",
      resolveDir: here,
      sourcefile: 'muse-brand-icon.tsx',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    jsx: 'automatic',
  });
  const icon = await import(pathToFileURL(bundlePath).href);
  assert.equal(icon.resolveModelBrand('muse-video'), 'muse');
  assert.equal(icon.resolveModelBrand('muse-image'), 'muse');
  assert.equal(icon.resolveModelBrand('minimax-h3-video'), 'minimax');
  assert.match(icon.BRAND_SVGS.muse, /#8B5CF6/);
  assert.match(icon.BRAND_SVGS.muse, />M</);
});
