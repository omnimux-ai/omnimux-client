import { homedir } from 'node:os'
import { join } from 'node:path'

export function hubHomeDir() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function hubProfileName() {
  const raw = process.env.OMNIMUX_PLUGIN_PROFILE
  return raw && raw.trim() !== '' ? raw : 'omnimux'
}
