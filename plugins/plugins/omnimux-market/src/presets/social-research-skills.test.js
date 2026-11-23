import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const DATA_LAYER_SKILL = 'omnimux-social-data'
const WORKFLOW_SKILLS = [
  'omnimux-outlier-post-finder',
  'omnimux-creator-teardown',
  'omnimux-transcript-intelligence',
  'omnimux-trend-discovery',
  'omnimux-competitor-research',
  'omnimux-social-listening',
  'omnimux-product-demand',
  'omnimux-content-repurposing',
]
const ALL_SOCIAL_RESEARCH_SKILLS = [DATA_LAYER_SKILL, ...WORKFLOW_SKILLS]

const REQUIRED_WORKFLOW_SECTIONS = [
  '## Overview',
  '## When to Use',
  '## Data Sources',
  '## Workflow',
  '## Output Format',
  '## Pitfalls',
]

function parseFrontmatter(markdown, label) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)
  assert.ok(match, `${label}: missing YAML frontmatter`)
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let value = kv[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    fields[kv[1]] = value
  }
  return fields
}

test('all 9 social research preset skills are declared in dsh.manifest.json and packaged via package.json files', () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'dsh.manifest.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

  assert.ok(Array.isArray(manifest.skills), 'dsh.manifest.json must declare a skills array')
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('skills'), 'package.json files must include "skills"')

  for (const id of ALL_SOCIAL_RESEARCH_SKILLS) {
    const relPath = `skills/${id}/SKILL.md`
    assert.ok(manifest.skills.includes(relPath), `dsh.manifest.json missing ${relPath}`)
    assert.equal(existsSync(join(PACKAGE_ROOT, relPath)), true, `missing file ${relPath}`)
  }
})

test('every social research SKILL.md has matching frontmatter name, Chinese trigger keywords, and zero dead tools or local paths', () => {
  for (const id of ALL_SOCIAL_RESEARCH_SKILLS) {
    const relPath = `skills/${id}/SKILL.md`
    const text = readFileSync(join(PACKAGE_ROOT, relPath), 'utf8')
    const fm = parseFrontmatter(text, relPath)

    assert.equal(fm.name, id, `${relPath}: frontmatter name must match directory id`)
    assert.ok(typeof fm.description === 'string' && fm.description.length >= 20, `${relPath}: description must be non-empty`)
    assert.match(fm.description, /[\u4e00-\u9fff]/, `${relPath}: description must contain Chinese trigger keywords`)
    assert.match(fm.description, /触发[：:]/, `${relPath}: description must declare explicit Chinese trigger phrases`)

    // Dead / unshipped tool names and host-local paths must never leak into shipped skills.
    assert.doesNotMatch(text, /\bharvest_[a-z0-9_]+\b/, `${relPath}: must not reference unshipped harvest_* tools`)
    assert.doesNotMatch(text, /\bvideo_breakdown_analyze\b/, `${relPath}: must not reference unshipped video_breakdown_analyze`)
    assert.doesNotMatch(text, /\/Users\/|\/home\//, `${relPath}: must not contain host-local absolute paths`)
  }
})

test('all 8 workflow skills follow the 6-section workflow-first contract and honest boundaries', () => {
  for (const id of WORKFLOW_SKILLS) {
    const relPath = `skills/${id}/SKILL.md`
    const text = readFileSync(join(PACKAGE_ROOT, relPath), 'utf8')

    for (const heading of REQUIRED_WORKFLOW_SECTIONS) {
      assert.ok(text.includes(heading), `${relPath}: missing required section "${heading}"`)
    }
    assert.ok(text.includes(DATA_LAYER_SKILL), `${relPath}: must reference data layer "${DATA_LAYER_SKILL}"`)
    assert.match(text, /公开数据 only/, `${relPath}: must declare public-data-only boundary`)
    assert.match(text, /URL|url/, `${relPath}: must require source URL citation`)
  }

  const outlierText = readFileSync(join(PACKAGE_ROOT, 'skills/omnimux-outlier-post-finder/SKILL.md'), 'utf8')
  for (const marker of ['中位数', '≥5x', '2x–5x', '1.5x–2x', '<10']) {
    assert.ok(outlierText.includes(marker), `omnimux-outlier-post-finder missing baseline/lift marker "${marker}"`)
  }

  const dataLayerText = readFileSync(join(PACKAGE_ROOT, 'skills/omnimux-social-data/SKILL.md'), 'utf8')
  for (const boundary of ['评论正文', '受众人口学', '广告库']) {
    assert.ok(dataLayerText.includes(boundary), `omnimux-social-data missing explicit unsupported boundary "${boundary}"`)
  }
})

test('README.md and TRIGGER-MATRIX.md ship with the skill bundle and cover all 9 skills without dead tools', () => {
  const refsDir = join(PACKAGE_ROOT, 'skills', DATA_LAYER_SKILL, 'references')
  for (const filename of ['README.md', 'TRIGGER-MATRIX.md']) {
    const filePath = join(refsDir, filename)
    assert.equal(existsSync(filePath), true, `missing ${filename} in ${refsDir}`)
    const text = readFileSync(filePath, 'utf8')
    for (const id of ALL_SOCIAL_RESEARCH_SKILLS) {
      assert.ok(text.includes(id), `${filename} must list skill "${id}"`)
    }
    assert.doesNotMatch(text, /\bharvest_[a-z0-9_]+\b/, `${filename} must not reference unshipped harvest_* tools`)
    assert.doesNotMatch(text, /\bvideo_breakdown_analyze\b/, `${filename} must not reference unshipped video_breakdown_analyze`)
    assert.doesNotMatch(text, /\/Users\/|\/home\//, `${filename} must not contain host-local absolute paths`)
  }
})
