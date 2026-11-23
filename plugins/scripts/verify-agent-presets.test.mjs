import { test } from 'node:test'
import { ok, equal, deepEqual } from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// 本机 `python3` 缺 PyYAML 时改用仓库内解析（见 specs/local-gates-repair.spec.md「旧标准变更」）。
import { pythonYamlAvailable, personaConfigFromText, rowsFromText } from './lib/preset-yaml.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const FORK_END = [
  '    - id: tool-subagent-fork',
  "      name: '@deepseek-ai/dsh-tool-subagent'",
  '      config:',
  '        provider: fork',
  '        toolName: subagent_fork',
  '        backgroundMode: continuable',
].join('\n')

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

function toolNames(text) {
  return [...text.matchAll(/toolName: (expert_\w+)/g)].map((m) => m[1])
}

function personaConfig(rel) {
  const script = `
import sys, json, yaml
from pathlib import Path
text = Path(sys.argv[1]).read_text()
def js_ctor(loader, node):
    return False
yaml.SafeLoader.add_constructor('tag:yaml.org,2002:js', js_ctor)
data = yaml.load(text, Loader=yaml.SafeLoader)
assert isinstance(data, list), type(data)
rows = [r for r in data if isinstance(r, dict) and r.get('id') == 'persona']
assert len(rows) == 1, f'expected exactly one persona row, got {len(rows)}'
cfg = rows[0].get('config')
assert isinstance(cfg, dict), f'persona config must be a mapping, got {type(cfg).__name__}'
prefix_present = 'prefix' in cfg
print(json.dumps({
    'keys': sorted(cfg.keys()),
    'prefixIsString': isinstance(cfg.get('prefix'), str),
    'prefixLength': len(cfg['prefix']) if isinstance(cfg.get('prefix'), str) else 0,
    'prefixPresent': prefix_present,
    'prefix': cfg.get('prefix'),
}))
`
  if (!pythonYamlAvailable()) return personaConfigFromText(rel, read(rel))
  const res = spawnSync('python3', ['-c', script, join(root, rel)], { encoding: 'utf8' })
  if (res.status !== 0) {
    throw new Error(`${rel} persona config parse failed:\n${res.stderr || res.stdout}`)
  }
  return JSON.parse(res.stdout.trim())
}

function parseWithPython(rel) {
  const script = `
import sys, yaml
from pathlib import Path
p = Path(sys.argv[1])
text = p.read_text()
def js_ctor(loader, node):
    return False
yaml.SafeLoader.add_constructor('tag:yaml.org,2002:js', js_ctor)
docs = list(yaml.load_all(text, Loader=yaml.SafeLoader))
# agent.cordis.yml is a single sequence of mappings
data = docs[0]
assert isinstance(data, list), type(data)
print(len(data))
`
  if (!pythonYamlAvailable()) return rowsFromText(rel, read(rel))
  const res = spawnSync('python3', ['-c', script, join(root, rel)], { encoding: 'utf8' })
  if (res.status !== 0) {
    throw new Error(`${rel} yaml parse failed:\n${res.stderr || res.stdout}`)
  }
  return Number(res.stdout.trim())
}

test('presets directory is converged to omni-agent only with zero static expert or retired directories', () => {
  const presetsRoot = join(root, 'presets')
  const dirs = readdirSync(presetsRoot)
    .filter((name) => {
      try {
        return statSync(join(presetsRoot, name)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
  deepEqual(dirs, ['omni-agent'], `presets/ must contain only omni-agent/, found: ${dirs.join(', ')}`)
})

test('omni-agent agent.cordis.yml is structurally valid and mounts generic subagent delegation without static experts', () => {
  const rel = 'presets/omni-agent/agent.cordis.yml'
  ok(existsSync(join(root, rel)), rel)
  const text = read(rel)
  ok(!text.includes("name: '@deepseek-ai/dsh-tool-subagent    #"), 'mangled subagent line')
  ok(!text.includes("name: '@deepseek-ai/dsh-tool-s    #"), 'mangled fork line')
  ok(text.includes(FORK_END), 'complete tool-subagent-fork block')
  ok(text.includes('provider: spawn'), 'generic subagent spawn tool must be mounted')
  ok(text.includes('sampleOverCapGlobResults: false'), 'tool-fs must configure sampleOverCapGlobResults')
  deepEqual(toolNames(text), [], 'omni-agent must not mount static expert_* subagent rows')
  // Skills ship from the plugin that owns them; Creator-mode Cordis skills are
  // owned exclusively by upstream `@deepseek-ai/dsh-agent-preset/skills/` (#234).
  ok(existsSync(join(root, 'plugins/omnimux-market/skills/tiktok-growth/SKILL.md')))
  ok(existsSync(join(root, 'plugins/omnimux-market/skills/sopilot-social-agents/SKILL.md')))
  ok(!existsSync(join(root, 'plugins/omnimux/skills/cordis-plugin-development/SKILL.md')))
  ok(!existsSync(join(root, 'plugins/omnimux/skills/editing-cordis-compositions/SKILL.md')))
  const rows = parseWithPython(rel)
  ok(rows >= 8, `omni-agent parsed ${rows} top-level rows`)
})

test('preset.yml metadata matches requirements for shipped presets', () => {
  const omniPreset = read('presets/omni-agent/preset.yml')
  ok(omniPreset.includes('name: OmniMux'))
  ok(omniPreset.includes('order: 1'))
})

test('sync-agent-presets.sh maintains presets in KEEP array', () => {
  const syncScript = read('scripts/sync-agent-presets.sh')
  ok(syncScript.includes('KEEP=(omni-agent)'))
})

test('presets manifest.json defines the single source of truth whitelist for shipped presets', () => {
  const manifest = JSON.parse(read('presets/manifest.json'))
  ok(Array.isArray(manifest.shippedPresets), 'manifest.json must declare shippedPresets array')
  const shippedIds = manifest.shippedPresets.map((p) => p.id)
  deepEqual(shippedIds, [
    'omni-agent',
    'cordis',
  ], 'shippedPresets in manifest.json is the single source of truth whitelist')
  ok(Array.isArray(manifest.retiredPresetRedirects), 'manifest.json must declare retiredPresetRedirects array')
  for (const retired of ['tiktok-agent', 'instagram-agent', 'marketing-agent', 'drama-agent', 'standard', 'ptc', 'minimal']) {
    ok(manifest.retiredPresetRedirects.includes(retired), `retiredPresetRedirects must include ${retired}`)
  }
})

test('omnimux cordis.patch.yml disables upstream generic presets and defaults to omni-agent', () => {
  const patchText = read('plugins/omnimux/cordis.patch.yml')
  ok(/- id:\s*preset-standard\s*\n\s*disabled:\s*true/.test(patchText), 'preset-standard must be disabled')
  ok(/- id:\s*preset-ptc\s*\n\s*disabled:\s*true/.test(patchText), 'preset-ptc must be disabled')
  ok(/- id:\s*preset-minimal\s*\n\s*disabled:\s*true/.test(patchText), 'preset-minimal must be disabled')
  ok(!/- id:\s*preset-cordis\s*\n\s*disabled:\s*true/.test(patchText), 'native preset-cordis must remain enabled')
  ok(/- id:\s*agent-preset-registry\s*\n\s*config:\s*\n\s*default:\s*omni-agent/.test(patchText), 'agent-preset-registry default must be omni-agent')
})

test('omni-agent Agent.md and persona define distilled English content e-commerce rules and boundaries', () => {
  const agentMd = read('presets/omni-agent/Agent.md')
  const cordisText = read('presets/omni-agent/agent.cordis.yml')
  for (const heading of [
    '# Identity & Responsibility',
    '# Workspace Object Semantics',
    '# Product & Content Truth Boundary',
    '# Collaboration, Confirmation & Authorization',
    '# Production, Skills & Capability Contracts',
    '# Delegation & System Boundaries',
    '# Delivery & Communication',
  ]) {
    ok(agentMd.includes(heading), `Agent.md missing section: ${heading}`)
  }
  ok(cordisText.includes('You are OmniMux'), 'persona must establish OmniMux content e-commerce identity')
  ok(cordisText.includes('Minimal delegation'), 'persona must enforce minimal subagent delegation')
  ok(cordisText.includes('Creator Mode (`cordis`)'), 'persona must declare Creator Mode boundary')
  ok(!/\/Users\/|\/home\//.test(agentMd), 'Agent.md must not leak host-local absolute paths')
})

test('build-agent-presets is idempotent', () => {
  const beforeOmni = read('presets/omni-agent/agent.cordis.yml')
  const res = spawnSync('node', [join(root, 'scripts/build-agent-presets.mjs')], {
    cwd: root,
    encoding: 'utf8',
  })
  equal(res.status, 0, res.stderr || res.stdout)
  const afterOmni = read('presets/omni-agent/agent.cordis.yml')
  equal(afterOmni, beforeOmni)
})

// `@deepseek-ai/dsh-persona` reads its prose from the required `prefix` key.
// `text` is not in its schema at all, so a preset carrying it fails to mount
// with `$.prefix missing required value` — surfaced to the user as a failed
// session create (a dead "New conversation" button), not as a preset error.
test('every shipped preset persona row uses the persona plugin key `prefix`, never `text`', () => {
  const shipped = [
    'presets/omni-agent/agent.cordis.yml',
  ]
  for (const rel of shipped) {
    const cfg = personaConfig(rel)
    ok(cfg.prefixPresent, `${rel} persona config must set prefix, got ${cfg.keys.join(', ')}`)
    ok(!cfg.keys.includes('text'), `${rel} persona config must not set the retired text key`)
    ok(cfg.prefixIsString, `${rel} persona prefix must be a string`)
    ok(cfg.prefixLength > 0, `${rel} persona prefix must not be empty`)
  }
})

test('preset generators emit the persona `prefix` key, never `text`', async (t) => {
  const text = read('scripts/build-agent-presets.mjs')
  ok(text.includes('prefix: |'), 'shipped preset generator must emit the persona prefix key')
  ok(!/^\s*text: \|/m.test(text), 'shipped preset generator must not emit the retired persona text key')

  const home = mkdtempSync(join(tmpdir(), 'market-persona-contract-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const result = await build({
    entryPoints: [join(root, 'plugins/omnimux-market/src/expert-market.ts')],
    bundle: true, platform: 'node', format: 'esm', write: false,
  })
  const { installMarketExpertPreset } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  const expert = { id: 'contract-expert', name: '契约专家', description: '第一行\n第二行', order: 1 }
  installMarketExpertPreset(home, expert)
  const rel = relative(root, join(home, '.agent-presets', expert.id, 'agent.cordis.yml'))
  const cfg = personaConfig(rel)
  ok(cfg.prefixPresent, 'market preset must set prefix')
  ok(!cfg.keys.includes('text'), 'market preset must not set the retired text key')
  ok(cfg.prefixIsString, 'market preset prefix must be a string')
  ok(cfg.prefixLength > 0, 'market preset prefix must not be empty')
  equal(cfg.prefix, '你是「契约专家」AI Agent专家。第一行\n第二行。\n', 'market preset must preserve the complete multiline persona')
  const cordisRaw = readFileSync(join(home, '.agent-presets', expert.id, 'agent.cordis.yml'), 'utf8')
  ok(cordisRaw.includes('sampleOverCapGlobResults: false'), 'market preset must configure sampleOverCapGlobResults')
  ok(cordisRaw.includes('provider: spawn'), 'market preset tool-subagent must configure provider: spawn')
  ok(cordisRaw.includes('provider: fork'), 'market preset tool-subagent-fork must configure provider: fork')
})
