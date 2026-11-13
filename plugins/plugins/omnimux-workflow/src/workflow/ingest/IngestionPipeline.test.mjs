import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkflowStoreError } from '../workspace/WorkflowStoreError.ts';
import {
  DISK_HEADROOM_BYTES,
  assertDiskSpace,
  copyFileIntoImported,
  uniqueImportedName,
} from './IngestionPipeline.ts';

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-ingest-'));
  mkdirSync(join(dir, '.omnimux'), { recursive: true });
  writeFileSync(join(dir, '.omnimux', 'project.json'), '{"schemaVersion":1}\n');
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('uniqueImportedName increments (n)', () => {
  const root = makeProject();
  try {
    const imported = join(root.dir, 'assets', 'imported');
    mkdirSync(imported, { recursive: true });
    writeFileSync(join(imported, 'hero.png'), 'a');
    assert.equal(uniqueImportedName(imported, 'hero.png'), 'hero (1).png');
    writeFileSync(join(imported, 'hero (1).png'), 'b');
    assert.equal(uniqueImportedName(imported, 'hero.png'), 'hero (2).png');
  } finally {
    root.cleanup();
  }
});

test('copyFileIntoImported copies then source remains', async () => {
  const root = makeProject();
  try {
    const source = join(root.dir, '..', `src-${Date.now()}.png`);
    writeFileSync(source, 'PNG-BYTES');
    const copied = await copyFileIntoImported({ projectRoot: root.dir, sourceAbs: source });
    assert.equal(copied.name, 'src-' + source.split('src-')[1]);
    assert.equal(copied.relativePath.startsWith('assets/imported/'), true);
    assert.equal(readFileSync(copied.destAbs, 'utf8'), 'PNG-BYTES');
    rmSync(source);
    assert.equal(existsSync(source), false);
    assert.equal(readFileSync(copied.destAbs, 'utf8'), 'PNG-BYTES');
  } finally {
    root.cleanup();
  }
});

test('copyFileIntoImported rejects directories', async () => {
  const root = makeProject();
  try {
    const nested = join(root.dir, 'folder');
    mkdirSync(nested);
    await assert.rejects(
      () => copyFileIntoImported({ projectRoot: root.dir, sourceAbs: nested }),
      (error) => error instanceof WorkflowStoreError && error.code === 'not-a-file',
    );
  } finally {
    root.cleanup();
  }
});

test('assertDiskSpace 413 when free is below headroom', () => {
  assert.throws(
    () => assertDiskSpace('/tmp', 100, () => ({ bavail: 1, bsize: 1 })),
    (error) => error instanceof WorkflowStoreError && error.code === 'disk-space-insufficient',
  );
  assertDiskSpace('/tmp', 100, () => ({
    bavail: DISK_HEADROOM_BYTES + 1000,
    bsize: 1,
  }));
});
