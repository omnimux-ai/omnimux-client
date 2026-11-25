import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { composeShippedAgentPresetRows } from '../src/agent-preset-rows.ts'

const roots: string[] = []
function tempPresetRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-preset-dedup-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('declares a shipped preset only while no active bundle already declares it', () => {
  const root = tempPresetRoot()
  mkdirSync(join(root, 'omni-agent'), { recursive: true })
  writeFileSync(join(root, 'omni-agent', 'preset.yml'), 'name: OmniMux\norder: 1\n')
  writeFileSync(join(root, 'omni-agent', 'agent.cordis.yml'), '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n')

  const composed = composeShippedAgentPresetRows({ presetRoot: root, resolvable: () => true })
  expect(composed.rows.map(row => row.id)).toEqual(['omnimux-preset-omni-agent'])
  expect(composed.skippedPresetIds).toEqual([])

  const deduped = composeShippedAgentPresetRows({
    presetRoot: root,
    resolvable: () => true,
    declaredPresetIds: new Set(['omni-agent']),
  })
  expect(deduped.rows).toEqual([])
  expect(deduped.skippedPresetIds).toEqual(['omni-agent'])
})

it('keeps a custom preset undeclared by any bundle', () => {
  const root = tempPresetRoot()
  mkdirSync(join(root, 'omni-agent'), { recursive: true })
  mkdirSync(join(root, 'custom-agent'), { recursive: true })
  for (const id of ['omni-agent', 'custom-agent']) {
    writeFileSync(join(root, id, 'preset.yml'), `name: ${id}\n`)
    writeFileSync(join(root, id, 'agent.cordis.yml'), '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n')
  }
  const composed = composeShippedAgentPresetRows({
    presetRoot: root,
    resolvable: () => true,
    declaredPresetIds: new Set(['omni-agent']),
  })
  expect(composed.rows.map(row => row.config.id)).toEqual(['custom-agent'])
  expect(composed.skippedPresetIds).toEqual(['omni-agent'])
})
