import { execFileSync } from 'node:child_process'
import { readBlobsAtRef } from './silent-catch-delta.mjs'

function git(root, args) {
  return execFileSync('git', ['-C', root, '--no-replace-objects', ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function resolveTree(root, ref) {
  const sha = git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim()
  const entries = new Map()
  for (const record of git(root, ['ls-tree', '-r', '-t', '-z', '--full-tree', sha]).split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t')
    const [mode, , object] = record.slice(0, tab).split(' ')
    entries.set(record.slice(tab + 1), { mode, object })
  }
  return {
    sha,
    entries,
    readText(paths) {
      const contents = new Map()
      // Batch reads stay bounded and never use the checkout as a fallback.
      for (let start = 0; start < paths.length; start += 256) {
        const part = paths.slice(start, start + 256)
        const batchPaths = part.filter(file => !file.includes('\n'))
        const blobs = readBlobsAtRef(root, sha, batchPaths)
        if (!blobs) throw new Error(`无法读取 Git 文本 ${sha}`)
        for (const file of part) {
          const content = file.includes('\n')
            ? git(root, ['cat-file', 'blob', entries.get(file).object])
            : blobs.get(file)
          if (typeof content !== 'string') throw new Error(`缺少 Git 文本 ${sha}:${file}`)
          contents.set(file, content)
        }
      }
      return contents
    },
  }
}

export function compareDocTrees(args, cwd = process.cwd()) {
  if (args.length !== 4 || args[0] !== '--base' || args[2] !== '--head' || !args[1] || !args[3]) {
    throw new Error('用法：--base <commit> --head <commit>')
  }
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim()
  return { base: resolveTree(root, args[1]), head: resolveTree(root, args[3]) }
}

// Reports stable identities for unchanged historical problems and new failures.
export function reportDocDelta(label, before, after) {
  const existing = after.filter(key => before.has(key))
  const added = after.filter(key => !before.has(key))
  for (const key of existing.sort()) console.warn(`[${label}] 存量 ${key}`)
  for (const key of added.sort()) console.error(`[${label}] 新增 ${key}`)
  console.log(`[${label}] 新增 ${added.length} 项，存量 ${existing.length} 项`)
  return added.length === 0 ? 0 : 1
}
