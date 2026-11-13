import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Gate for the preset skill surface after rc.3.
 *
 * rc.3 carries presets through packaged declarations (`preset/agent-presets`
 * plus shell declarations); `sync-agent-presets.sh` no longer materialises
 * preset skills into a consumer home. These tests therefore check:
 *  - no shipped preset registers its own skill directory (`customSkillDirs`);
 *  - the composition-authoring skills ship with the owning hub package
 *    (`plugins/omnimux/skills/<id>`), not a `presets/cordis/skills` copy;
 *  - `sync-agent-presets.sh` writes nothing into the target skill root and
 *    never clobbers an existing user-owned skill.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots = []

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test('no shipped preset registers its own skill directory', () => {
  const presetsRoot = join(root, 'presets')
  const offenders = []
  for (const entry of readdirSync(presetsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const composition = join(presetsRoot, entry.name, 'agent.cordis.yml')
    if (!existsSync(composition)) continue
    if (readFileSync(composition, 'utf8').includes('customSkillDirs')) offenders.push(entry.name)
  }
  assert.deepEqual(offenders, [], `these presets still register a skill root the packaged copy cannot list: ${offenders.join(', ')}`)
})

test('the cordis composition-authoring skills ship with the hub package', () => {
  // [client-port] The skills ship from the owning hub package, not a
  // presets/cordis/skills copy (rc.3 carries presets via packaged declarations).
  for (const id of ['editing-cordis-compositions', 'cordis-plugin-development']) {
    const skill = join(root, 'plugins', 'omnimux', 'skills', id, 'SKILL.md')
    assert.equal(existsSync(skill), true, `missing ${skill}`)
    assert.match(readFileSync(skill, 'utf8'), new RegExp(`name:\\s*${id}`), `${id}/SKILL.md must declare its own name`)
  }
})

test('sync-agent-presets.sh never writes preset skills into the target skill root (rc.3)', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'omnimux-preset-skills-'))
  temporaryRoots.push(fixture)
  const scripts = join(fixture, 'scripts')
  const home = join(fixture, 'harness-home')
  mkdirSync(scripts, { recursive: true })
  mkdirSync(home, { recursive: true })
  copyFileSync(join(root, 'scripts', 'sync-agent-presets.sh'), join(scripts, 'sync-agent-presets.sh'))
  copyFileSync(join(root, 'scripts', 'resolve-omnimux-profile.sh'), join(scripts, 'resolve-omnimux-profile.sh'))
  chmodSync(join(scripts, 'sync-agent-presets.sh'), 0o755)
  cpSync(join(root, 'presets'), join(fixture, 'presets'), { recursive: true })

  // A skill the user already owns at the same name must survive untouched.
  const owned = join(home, 'skills', 'sopilot-social-agents')
  mkdirSync(owned, { recursive: true })
  writeFileSync(join(owned, 'SKILL.md'), 'user-owned\n')

  const result = spawnSync('bash', [join(scripts, 'sync-agent-presets.sh'), `--target=${home}`], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, HOME: fixture, OMNIMUX_SYNC_TARGETS: '' },
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

  // [client-port] rc.3: presets ship via the package (preset/agent-presets) and
  // shell declarations; sync-agent-presets.sh no longer writes preset skills to
  // the target home. The guard is that it writes nothing and never clobbers an
  // existing user-owned skill.
  for (const id of ['editing-cordis-compositions', 'cordis-plugin-development']) {
    assert.equal(existsSync(join(home, 'skills', id, 'SKILL.md')), false, `${id} must not be written in rc.3`)
  }
  assert.equal(readFileSync(join(owned, 'SKILL.md'), 'utf8'), 'user-owned\n', 'an existing skill was overwritten')
})
