import { join } from 'node:path'
import { summarizePackagingJournal } from './packaging-step.ts'

const runDir = process.argv[2] ?? process.env.DSH_DESKTOP_PACKAGING_RUN_DIR
if (!runDir) throw new Error('Pass the packaging run directory or set DSH_DESKTOP_PACKAGING_RUN_DIR.')
console.log(JSON.stringify(summarizePackagingJournal(join(runDir, 'events.jsonl')), null, 2))
