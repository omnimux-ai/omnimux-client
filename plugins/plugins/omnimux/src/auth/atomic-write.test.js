import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { atomicWriteFileSync } from './atomic-write.js'

describe('atomicWriteFileSync', () => {
  it('writes content atomically with 0600 file permissions and 0700 directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'omnimux-atomic-'))
    try {
      const targetDir = join(tmp, 'nested', 'config')
      const targetFile = join(targetDir, 'secrets.json')

      atomicWriteFileSync(targetFile, JSON.stringify({ token: 'test-val' }))

      const content = readFileSync(targetFile, 'utf8')
      assert.equal(content, '{"token":"test-val"}')

      const dirStat = statSync(targetDir)
      // Mask mode with 0777 to check permission bits
      assert.equal(dirStat.mode & 0o777, 0o700)

      const fileStat = statSync(targetFile)
      assert.equal(fileStat.mode & 0o777, 0o600)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('atomically overwrites existing file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'omnimux-atomic-'))
    try {
      const targetFile = join(tmp, 'file.txt')
      atomicWriteFileSync(targetFile, 'first')
      assert.equal(readFileSync(targetFile, 'utf8'), 'first')

      atomicWriteFileSync(targetFile, 'second')
      assert.equal(readFileSync(targetFile, 'utf8'), 'second')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
