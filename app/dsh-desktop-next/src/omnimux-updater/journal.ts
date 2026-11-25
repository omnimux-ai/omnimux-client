/** Append-only structured JSONL journal for OmniMux update milestones and diagnostics. */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { NextUpdateState, OmniMuxUpdateChannel, OmniMuxUpdateErrorCode } from './types.ts'

const MAX_JOURNAL_BYTES = 512 * 1024

export type UpdateJournalEvent =
  | 'check-start'
  | 'check-result'
  | 'download-start'
  | 'download-cancelled'
  | 'download-complete'
  | 'prepare-complete'
  | 'install-requested'
  | 'install-handoff'
  | 'channel-switched'
  | 'update-completed'
  | 'error'

export interface UpdateJournalEntryInput {
  readonly event: UpdateJournalEvent
  readonly channel: OmniMuxUpdateChannel
  readonly phase?: NextUpdateState['phase']
  readonly targetVersion?: string
  readonly previousVersion?: string
  readonly errorCode?: OmniMuxUpdateErrorCode
  readonly detail?: string
  readonly durationMs?: number
}

/**
 * Bounded, secret-free update journal stored under `<userData>/updates/update-journal.jsonl`.
 * Failures to write the journal are swallowed so diagnostics can never break updates.
 */
export class OmniMuxUpdateJournal {
  readonly file: string

  constructor(userDataDir: string, private readonly installedVersion: string) {
    this.file = join(userDataDir, 'updates', 'update-journal.jsonl')
  }

  record(entry: UpdateJournalEntryInput): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
      if (existsSync(this.file) && statSync(this.file).size >= MAX_JOURNAL_BYTES) {
        renameSync(this.file, `${this.file}.1`)
      }
      const payload = {
        schemaVersion: 1,
        ts: new Date().toISOString(),
        pid: process.pid,
        installedVersion: this.installedVersion,
        event: entry.event,
        channel: entry.channel,
        ...(entry.phase === undefined ? {} : { phase: entry.phase }),
        ...(entry.targetVersion === undefined ? {} : { targetVersion: entry.targetVersion }),
        ...(entry.previousVersion === undefined ? {} : { previousVersion: entry.previousVersion }),
        ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
        ...(entry.detail === undefined ? {} : { detail: entry.detail.slice(0, 200) }),
        ...(entry.durationMs === undefined ? {} : { durationMs: Math.round(entry.durationMs) }),
      }
      appendFileSync(this.file, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
    } catch {
      // Never block update flow on journal I/O errors.
    }
  }
}
