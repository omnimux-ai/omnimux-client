import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Plugin root: works both from the built bundle (dist/index.js → root is
 * one level up) and from source (src/workflow/routes/ → three levels up).
 * Detected by locating package.json.
 */
export function resolvePluginRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..'), join(here, '..', '..', '..')];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return candidates[0] ?? process.cwd();
}
