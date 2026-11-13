import { readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, sep, join } from 'node:path'

export const AGENT_NOTE_LIFECYCLES = ['proposed', 'implemented', 'rejected']
export const AGENT_NOTE_CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing']
export const AGENT_NOTE_ARCHIVE = 'archived'
export const ROOT_ALLOWLIST = new Set(['AGENTS.md', 'CLAUDE.md'])

export function getAgentNoteRoot(repoRoot) {
  return resolve(repoRoot, '.agents/notes')
}

export function walkAgentNoteTree(repoRoot) {
  const noteRoot = getAgentNoteRoot(repoRoot)
  const notes = []
  const errors = []

  if (!existsSync(noteRoot)) {
    return { notes, errors: ['structure: .agents/notes directory does not exist'] }
  }

  // Check top-level directory entries
  for (const entry of readdirSync(noteRoot, { withFileTypes: true })) {
    if (entry.name === 'INDEX.md') {
      errors.push('structure: INDEX.md — centralized Agent Note indexes are forbidden; browse the lifecycle/class tree')
      continue
    }
    if (entry.isDirectory() && entry.name !== AGENT_NOTE_ARCHIVE && !AGENT_NOTE_LIFECYCLES.includes(entry.name)) {
      errors.push(`structure: ${entry.name}/ — unknown lifecycle folder (allowed: ${AGENT_NOTE_LIFECYCLES.join(', ')}, plus ${AGENT_NOTE_ARCHIVE}/)`)
    }
  }

  // Walk active lifecycles
  for (const lifecycle of AGENT_NOTE_LIFECYCLES) {
    const lifecycleDir = join(noteRoot, lifecycle)
    if (!existsSync(lifecycleDir)) continue

    const classes = readdirSync(lifecycleDir, { withFileTypes: true })
    for (const clsEntry of classes) {
      if (clsEntry.isFile()) {
        if (ROOT_ALLOWLIST.has(clsEntry.name)) continue
        errors.push(`structure: ${lifecycle}/${clsEntry.name} — root files in lifecycle directory must be in allowlist (${[...ROOT_ALLOWLIST].join(', ')})`)
        continue
      }
      if (!clsEntry.isDirectory()) continue

      const cls = clsEntry.name
      if (!AGENT_NOTE_CLASSES.includes(cls)) {
        errors.push(`structure: ${lifecycle}/${cls} — unknown class folder "${cls}" (allowed: ${AGENT_NOTE_CLASSES.join(', ')})`)
        continue
      }

      const files = readdirSync(join(lifecycleDir, cls), { withFileTypes: true })
      for (const fileEntry of files) {
        if (!fileEntry.isFile()) continue
        const filename = fileEntry.name

        // Skip non-markdown files like .i18n.yaml in note list (checked separately by pairing gate)
        if (filename.endsWith('.i18n.yaml')) continue
        // zh counterpart is paired with en note
        if (filename.endsWith('.zh.md')) continue
        if (!filename.endsWith('.md')) continue

        const rel = `${lifecycle}/${cls}/${filename}`
        if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(filename)) {
          errors.push(`structure: ${rel} — filename must match yyyy-mm-dd-topic.md`)
          continue
        }

        const date = filename.slice(0, 10)
        notes.push({ lifecycle, class: cls, filename, rel, date, fullPath: join(lifecycleDir, cls, filename) })
      }
    }
  }

  return { notes, errors }
}
