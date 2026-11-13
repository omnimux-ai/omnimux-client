import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VideoError } from '../errors.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const BUNDLED_ANALYZE_PROMPT = join(HERE, '../../prompts/video-content-breakdown.md')
export const BUNDLED_REVERSE_PROMPT = join(HERE, '../../prompts/reverse-video-structured-prompt.md')

/**
 * @param {string} [overridePath]
 * @param {string} bundledPath
 */
export async function loadPromptFile(overridePath, bundledPath) {
  const path = typeof overridePath === 'string' && overridePath.trim()
    ? (isAbsolute(overridePath.trim()) ? overridePath.trim() : join(process.cwd(), overridePath.trim()))
    : bundledPath
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new VideoError('video-invalid-input', `prompt file not found: ${path}`)
    }
    throw error
  }
  if (!text.trim()) {
    throw new VideoError('video-invalid-input', `prompt file is empty: ${path}`)
  }
  return { path, text: text.trim() }
}
