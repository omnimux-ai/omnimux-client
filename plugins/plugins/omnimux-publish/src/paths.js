import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve the official DSH home, matching the hub auth/store.js convention.
 * @param {string | undefined} homeDir
 * @param {{ DSH_HOME?: string }} [env]
 */
export function resolveDshHome(homeDir, env = process.env) {
  return homeDir || env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * All omnimux-publish state lives under `<dsh home>/omnimux/publish/` unless the
 * `dataDir` config overrides it (tests do exactly that). This directory is
 * the only disk area this plugin writes.
 * @param {{ homeDir?: string, dataDir?: string, accountsOverlayPath?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolvePublishPaths(opts = {}) {
  const home = resolveDshHome(opts.homeDir, opts.env)
  const dir = opts.dataDir || join(home, 'omnimux', 'publish')
  return {
    home,
    dir,
    recordsFile: join(dir, 'records.json'),
    mediaIndexFile: join(dir, 'media.json'),
    mediaDir: join(dir, 'media'),
    // omnimux-accounts overlay, read-only for us (data-file coupling, no hub import)
    accountsOverlayPath: opts.accountsOverlayPath || join(home, 'omnimux', 'accounts.json'),
  }
}
