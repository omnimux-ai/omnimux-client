import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve the official DSH home, matching the hub / assets convention.
 * @param {string | undefined} [homeDir]
 * @param {{ DSH_HOME?: string }} [env]
 */
export function resolveDshHome(homeDir, env = process.env) {
  return homeDir || env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * All local inspirations live under `<dsh home>/omnimux/inspirations/`.
 * @param {{ homeDir?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveInspirationPaths(opts = {}) {
  const home = resolveDshHome(opts.homeDir, opts.env)
  const dir = join(home, 'omnimux', 'inspirations')
  const mediaDir = join(dir, 'media')
  return {
    dir,
    libraryFile: join(dir, 'library.json'),
    mediaDir,
    coversDir: join(mediaDir, 'covers'),
    videosDir: join(mediaDir, 'videos'),
    imagesDir: join(mediaDir, 'images'),
  }
}
