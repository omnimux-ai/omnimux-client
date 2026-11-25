#!/usr/bin/env node
/**
 * Sync `presets/omni-agent/{Agent.md,preset.yml}` into the two shipped forms:
 * `presets/omni-agent/agent.cordis.yml` (legacy shell) and
 * `plugins/plugins/omnimux/presets/omni-agent.patch.yml` (Desktop Next bundle).
 *
 * `Agent.md` is the single source of truth for the default OmniMux content
 * e-commerce agent prompt. Running this script twice is strictly idempotent.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const agentMdPath = join(root, 'presets/omni-agent/Agent.md')
const presetYmlPath = join(root, 'presets/omni-agent/preset.yml')
const cordisPath = join(root, 'presets/omni-agent/agent.cordis.yml')
const hubPatchPath = join(root, 'plugins/omnimux/presets/omni-agent.patch.yml')

function indentBlock(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text
    .replace(/\r\n/g, '\n')
    .trimEnd()
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `${pad}${line}`))
    .join('\n')
}

export function renderOmniAgentCordis(agentMd) {
  const indentedPersona = indentBlock(agentMd, 6)
  return `# OmniMux default agent preset (\`omni-agent\`) — content e-commerce & cross-border partner.
#
# Generated persona prefix from \`presets/omni-agent/Agent.md\` via \`node scripts/build-agent-presets.mjs\`.
# Edit \`Agent.md\`, then re-run the generator instead of hand-editing the persona block below.
#
# This file is an AGENT-PLANE composition mounted once under a standing scope.
# All domain plugins (Canvas, Clip, Products, Assets, Inspiration, Publish, Hub media)
# live on the HOST plane and are inherited dynamically through the Tool Registry.
# Specialized workflows and platform playbooks are loaded on demand via Skills.

# ── identity ────────────────────────────────────────────────────────────────

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |
${indentedPersona}

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

# ── shell ───────────────────────────────────────────────────────────────────

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

# ── filesystem ──────────────────────────────────────────────────────────────

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false

# ── background jobs ────────────────────────────────────────────────────────

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

# ── skills ──────────────────────────────────────────────────────────────────

- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'

# ── goals ───────────────────────────────────────────────────────────────────

- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'

# ── plan mode ───────────────────────────────────────────────────────────────

- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'
      config:
        section: |
              You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

              Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual workspace. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

              The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

              Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

              Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

              When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.

# ── compaction ──────────────────────────────────────────────────────────────

- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

# ── delegation and workflows ────────────────────────────────────────────────

- id: delegation
  name: cordis:group
  group: true
  isolate:
    workflowEngine: true
  config:
    - id: tool-subagent-control
      name: '@deepseek-ai/dsh-tool-subagent-control'

    # DSH 0.2.1-rc.3 exports \`./list-agents\` as its own entry and registers
    # \`list_agents\` only through it; 0.2.2-rc.5 folds the registration into the
    # main entry and drops the subpath. Keep one row whose enabled state follows
    # the installed package instead of picking one DSH line and breaking the other.
    - id: tool-subagent-list-agents
      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
      disabled: !!js "!(() => { try { return Boolean(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('@deepseek-ai/dsh-tool-subagent-control/list-agents')) } catch { return false } })()"

    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent
        backgroundMode: continuable

    - id: tool-subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
        toolName: subagent_fork
        backgroundMode: continuable

    - id: workflow-ptc
      name: '@deepseek-ai/dsh-workflow-ptc'
      config:
        provider: spawn

    - id: tool-workflow
      name: '@deepseek-ai/dsh-tool-workflow'

    - id: tool-ralph
      name: '@deepseek-ai/dsh-tool-ralph'
      config:
        subagentProvider: spawn
        maxRounds: 64

# ── remaining model-facing rows ─────────────────────────────────────────────

- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true
    searchTimeoutMs: 60000
`
}

function parsePresetMetadata(presetYml) {
  const parsed = parseYaml(presetYml)
  const meta = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  return {
    ...(typeof meta.name === 'string' ? { name: meta.name } : {}),
    ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
    ...(typeof meta.order === 'number' ? { order: meta.order } : {}),
  }
}

function stripLeadingCommentHeader(cordisYml) {
  const lines = cordisYml.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length && (lines[i].startsWith('#') || lines[i].trim() === '')) i += 1
  return lines.slice(i).join('\n').trimEnd()
}

export function renderOmniAgentPatch(agentMd, presetYml) {
  const meta = parsePresetMetadata(presetYml)
  const pluginsYaml = stripLeadingCommentHeader(renderOmniAgentCordis(agentMd))
  const indentedPlugins = indentBlock(pluginsYaml, 10)
  const metaLines = [
    '        id: omni-agent',
    ...(meta.name ? [`        name: ${meta.name}`] : []),
    ...(meta.description ? [`        description: ${meta.description}`] : []),
    ...(meta.order ? [`        order: ${meta.order}`] : []),
  ]
  return `# Agent preset omni-agent: one \`@deepseek-ai/dsh-agent-preset\` declaration
# carried by the \`omnimux\` bundle (mirrors \`@deepseek-ai/dsh-web-app/presets/*.patch.yml\`).
#
# Generated from \`presets/omni-agent/{preset.yml,Agent.md}\` via \`node scripts/build-agent-presets.mjs\`.
# Edit \`presets/omni-agent/Agent.md\` or \`preset.yml\`, then re-run the generator.
- insert:
    - id: omnimux-preset-omni-agent
      name: '@deepseek-ai/dsh-agent-preset'
      config:
${metaLines.join('\n')}
        plugins:
${indentedPlugins}
`
}

export function buildAgentPresets() {
  const agentMd = readFileSync(agentMdPath, 'utf8')
  const presetYml = readFileSync(presetYmlPath, 'utf8')
  const rendered = renderOmniAgentCordis(agentMd)
  writeFileSync(cordisPath, rendered, 'utf8')
  mkdirSync(dirname(hubPatchPath), { recursive: true })
  writeFileSync(hubPatchPath, renderOmniAgentPatch(agentMd, presetYml), 'utf8')
  return { cordisPath, hubPatchPath }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildAgentPresets()
  console.log('✓ synced presets/omni-agent/{Agent.md,preset.yml} -> presets/omni-agent/agent.cordis.yml + plugins/omnimux/presets/omni-agent.patch.yml')
}
