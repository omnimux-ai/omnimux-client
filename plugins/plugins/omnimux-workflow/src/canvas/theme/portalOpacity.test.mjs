import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanPopoverOpacity } from '../../../../../scripts/guard-no-transparent-popover.mjs';

test('canvas popover opacity gate runs in the workflow plugin CI suite', () => {
  const dir = fileURLToPath(new URL('../', import.meta.url));
  const { scannedFiles, violations } = scanPopoverOpacity({ dir });
  assert.ok(scannedFiles > 0, 'The gate must scan the canvas sources');
  assert.deepEqual(violations, []);
});
