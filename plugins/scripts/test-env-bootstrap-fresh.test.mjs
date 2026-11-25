import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentPresetPatchText, createTestEnvironmentStarter, normalizeTaskPlugins, presetRowsFromPatchText, profileBundlePresetDirectories } from './test-env-bootstrap.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKTREE_PRESETS = join(HERE, '..', 'presets');

const root = '/repo/.worktrees/task';
function starter() {
  let writes = 0, reads = 0;
  const files = new Map([[root + '/.git', 'gitdir: /repo/.git/worktrees/task\n'], ['/repo/.git/worktrees/task/commondir', '../..\n'], ['/repo/.git/worktrees/task/gitdir', root + '/.git\n']]);
  const fs = { realpathSync: p => p, lstatSync: p => ({ isSymbolicLink: () => false, isDirectory: () => !files.has(p), isFile: () => files.has(p) }), readFileSync: p => { reads++; return files.get(p); }, mkdirSync: () => { writes++; }, mkdtempSync: () => { writes++; throw new Error('must not create'); } };
  return { start: createTestEnvironmentStarter({ fs, repositoryRoot: '/repo' }), writes: () => writes, reads: () => reads };
}
const valid = { root, mode: 'ui', evidenceContext: { taskId: '3409', runId: 'unit' }, candidate: { base: 'a'.repeat(40), head: 'b'.repeat(40) }, taskPlugins: ['omnimux-inspiration'] };

test('task targets are finite, unique and hub is always included', () => {
  assert.deepEqual(normalizeTaskPlugins(['omnimux-browser', 'omnimux-inspiration']), ['omnimux', 'omnimux-browser', 'omnimux-inspiration']);
  for (const value of [null, '../omnimux', ['omnimux-video'], ['omnimux-inspiration', 'omnimux-inspiration']]) assert.throws(() => normalizeTaskPlugins(value), { code: 'TEST_ENV_OPTIONS' });
});

test('fresh input rejection precedes private resource allocation', async () => {
  for (const [change, code] of [
    [{ mode: 'live' }, 'FRESH_MODE_UNSUPPORTED'], [{ mode: 'onboarding' }, 'FRESH_MODE_UNSUPPORTED'],
    [{ taskPlugins: ['omnimux-viewer'] }, 'OPTIONS'], [{ taskPlugins: ['omnimux-inspiration', 'omnimux-inspiration'] }, 'OPTIONS'],
    [{ candidate: { ...valid.candidate, command: 'npm install' } }, 'PREPARE_CANDIDATE_REQUIRED'],
    [{ candidate: { ...valid.candidate, extraInputs: 'src' } }, 'PREPARE_CANDIDATE_REQUIRED'],
    [{ candidate: null }, 'PREPARE_CANDIDATE_REQUIRED'], [{ evidenceContext: null }, 'OPTIONS'],
  ]) {
    const f = starter();
    await assert.rejects(f.start({ ...valid, ...change }), { code: 'TEST_ENV_' + code });
    assert.equal(f.writes(), 0);
  }
});

test('legacy explicit requests retain their non-fresh refusal', async () => {
  const f = starter();
  await assert.rejects(f.start({ root, mode: 'ui', evidenceContext: valid.evidenceContext }), error => error.code === 'TEST_ENV_NOT_USER_FRESH_TASK_UNKNOWN' && error.observations.userFresh === false);
  assert.equal(f.writes(), 0);
});

test('agentPresetPatchText with worktree presetRoot emits only omni-agent and preserves !!js tags', () => {
  const patchText = agentPresetPatchText(
    { appRoot: '/unused-app-root', layout: 'unpacked' },
    {
      presetRoot: WORKTREE_PRESETS,
      createRequire: () => ({ resolve: (name) => name }),
    },
  );
  assert.match(patchText, /id:\s*omnimux-preset-omni-agent\b/);
  assert.doesNotMatch(patchText, /id:\s*omnimux-preset-(?:tiktok-agent|instagram-agent|drama-agent|standard|ptc|minimal)\b/);
  assert.match(patchText, /disabled:\s*!!js\s+"?process\.platform === 'win32'"?/);
  assert.match(patchText, /disabled:\s*!!js\s+"?process\.platform !== 'win32'"?/);
});

test('agentPresetPatchText skips a preset already declared by an installed profile bundle', () => {
  const appRoot = mkdtempSync(join(tmpdir(), 'bootstrap-preset-app-'));
  const profileDir = mkdtempSync(join(tmpdir(), 'bootstrap-preset-profile-'));
  try {
    const shipped = join(appRoot, 'preset', 'agent-presets', 'omni-agent');
    mkdirSync(shipped, { recursive: true });
    writeFileSync(join(shipped, 'preset.yml'), 'name: OmniMux\norder: 1\n');
    writeFileSync(join(shipped, 'agent.cordis.yml'), [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    prefix: hi',
      '',
    ].join('\n'));
    // Real isolated-profile layout: the product bundle lives under the profile's node_modules,
    // as materialized by the task runtime; the App root has no `omnimux` directory.
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'omnimux'] } },
    }));
    const bundlePresets = join(profileDir, 'node_modules', 'omnimux', 'presets');
    mkdirSync(bundlePresets, { recursive: true });
    writeFileSync(join(bundlePresets, 'omni-agent.patch.yml'), [
      '- insert:',
      '    - id: omnimux-preset-omni-agent',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: omni-agent',
      '        plugins: []',
      '',
    ].join('\n'));
    const patchText = agentPresetPatchText(
      { appRoot, layout: 'unpacked' },
      { profileDir, createRequire: () => ({ resolve: (name) => name }) },
    );
    // The bundle layer already carries the row; a second one is a duplicate Loader id.
    assert.equal(patchText, '', 'a bundle-declared preset must not be re-declared');
    assert.deepEqual(profileBundlePresetDirectories(profileDir), [bundlePresets]);
    // Without the bundle the shipped preset is still declared.
    const withPreset = agentPresetPatchText(
      { appRoot, layout: 'unpacked' },
      { createRequire: () => ({ resolve: (name) => name }) },
    );
    assert.match(withPreset, /id:\s*omnimux-preset-omni-agent\b/);
  } finally {
    rmSync(appRoot, { recursive: true, force: true });
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test('presetRowsFromPatchText treats an empty fragment as no extra rows', () => {
  const empty = presetRowsFromPatchText('');
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.document.errors.length, 0);

  const filled = presetRowsFromPatchText('- insert:\n    - id: omnimux-preset-omni-agent\n      name: "@deepseek-ai/dsh-agent-preset"\n      config:\n        id: omni-agent\n');
  assert.equal(filled.rows.length, 1);
  assert.equal(filled.rows[0].insert.length, 1);
});
