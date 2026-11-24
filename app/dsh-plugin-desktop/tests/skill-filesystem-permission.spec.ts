/**
 * Issue #198: a single unreadable skill file or symlink pointing into an
 * unauthorized (e.g. macOS TCC-protected) directory must warn and skip only
 * that entry rather than aborting root discovery or wiping out all healthy
 * sibling skills in the filesystem provider.
 */
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { afterEach, describe, expect, it } from 'vitest'

const canEnforcePosixChmod = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0

const cleanupPaths: Array<{ path: string; chmodTargets?: string[] }> = []

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const entry = cleanupPaths.pop()!
    for (const target of entry.chmodTargets ?? []) {
      await chmod(target, 0o700).catch(() => {})
    }
    await rm(entry.path, { recursive: true, force: true })
  }
})

async function createTempRoot(prefix: string): Promise<{ home: string; skillsDir: string; chmodTargets: string[] }> {
  const home = await mkdtemp(join(tmpdir(), prefix))
  const skillsDir = join(home, '.agents', 'skills')
  await mkdir(skillsDir, { recursive: true })
  const chmodTargets: string[] = []
  cleanupPaths.push({ path: home, chmodTargets })
  return { home, skillsDir, chmodTargets }
}

async function writeValidSkill(skillsDir: string, dirName: string, skillName = dirName): Promise<string> {
  const dir = join(skillsDir, dirName)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  await writeFile(file, `---\nname: ${skillName}\ndescription: Valid skill ${skillName}\n---\n\nBody for ${skillName}\n`, 'utf8')
  return file
}

function captureWarnings(ctx: Context): string[] {
  const warnings: string[] = []
  const logger = ctx.logger
  const originalWarn = logger.warn
  logger.warn = ((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
    return Reflect.apply(originalWarn, logger, args)
  }) as typeof logger.warn
  return warnings
}

describe('skill-filesystem single-entry permission isolation (#198)', () => {
  describe.runIf(canEnforcePosixChmod)('real POSIX chmod 000 & unreadable symlink targets', () => {
    it('isolates chmod 000 SKILL.md and unreadable target symlinks when ctx.fs is LocalFileSystem', async () => {
      const { home, skillsDir, chmodTargets } = await createTempRoot('stable-skill-eperm-fs-')
      await writeValidSkill(skillsDir, 'healthy-alpha')
      await writeValidSkill(skillsDir, 'healthy-beta')

      const unreadableSkillFile = await writeValidSkill(skillsDir, 'unreadable-skill')
      await chmod(unreadableSkillFile, 0o000)
      chmodTargets.push(unreadableSkillFile)

      const lockedExternalParent = join(home, 'protected-desktop')
      const externalTargetDir = join(lockedExternalParent, 'tcc-skill')
      await mkdir(externalTargetDir, { recursive: true })
      await writeFile(
        join(externalTargetDir, 'SKILL.md'),
        '---\nname: tcc-skill\ndescription: Protected skill\n---\n\nProtected\n',
        'utf8',
      )
      await symlink(externalTargetDir, join(skillsDir, 'tcc-linked-skill'))
      await chmod(lockedExternalParent, 0o000)
      chmodTargets.push(lockedExternalParent)

      const ctx = new Context()
      const warnings = captureWarnings(ctx)
      await ctx.plugin(LocalFileSystem, { cwd: home })
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        watch: false,
      })

      try {
        const snapshot = await ctx.skills.snapshot()
        expect(snapshot.complete).toBe(true)
        expect(snapshot.skills.map(skill => skill.name)).toEqual(['healthy-alpha', 'healthy-beta'])
        expect(warnings.some(line => line.includes('tcc-linked-skill'))).toBe(true)
        expect(warnings.some(line => line.includes('unreadable-skill'))).toBe(true)
      } finally {
        await ctx.fiber.dispose()
      }
    })
  })

  it('isolates FS_PERMISSION_DENIED thrown by ctx.fs without skipping the filesystem provider', async () => {
    const { home, skillsDir } = await createTempRoot('stable-skill-eperm-mock-')
    await writeValidSkill(skillsDir, 'good-alpha')
    const deniedRead = await writeValidSkill(skillsDir, 'denied-read')
    await writeValidSkill(skillsDir, 'good-omega')

    class FaultyPermissionFs extends LocalFileSystem {
      override async readText(target: Parameters<LocalFileSystem['readText']>[0], signal?: AbortSignal) {
        if (target.displayPath === deniedRead) {
          throw new FsError(`cannot read "${target.displayPath}": permission denied`, 'FS_PERMISSION_DENIED')
        }
        return await super.readText(target, signal)
      }
    }

    const ctx = new Context()
    const warnings = captureWarnings(ctx)
    await ctx.plugin(FaultyPermissionFs, { cwd: home })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    try {
      const snapshot = await ctx.skills.snapshot()
      expect(snapshot.complete).toBe(true)
      expect(snapshot.skills.map(skill => skill.name)).toEqual(['good-alpha', 'good-omega'])
      expect(warnings.some(line => line.includes('denied-read'))).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
