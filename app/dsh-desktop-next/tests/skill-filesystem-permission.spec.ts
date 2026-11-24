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
import { FsError, FileSystem } from '@deepseek-ai/dsh-fs'
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

async function writeValidFlatSkill(skillsDir: string, fileName: string, skillName: string): Promise<string> {
  const file = join(skillsDir, fileName)
  await writeFile(file, `---\nname: ${skillName}\ndescription: Flat skill ${skillName}\n---\n\nBody for ${skillName}\n`, 'utf8')
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
    it('isolates chmod 000 SKILL.md, flat .md, locked skill dir, and unreadable target symlinks when ctx.fs is LocalFileSystem', async () => {
      const { home, skillsDir, chmodTargets } = await createTempRoot('next-skill-eperm-fs-')
      await writeValidSkill(skillsDir, 'healthy-alpha')
      await writeValidSkill(skillsDir, 'healthy-beta')
      await writeValidFlatSkill(skillsDir, 'healthy-flat.md', 'healthy-flat')

      // 1. chmod 000 SKILL.md inside a readable skill directory
      const unreadableSkillFile = await writeValidSkill(skillsDir, 'unreadable-skill')
      await chmod(unreadableSkillFile, 0o000)
      chmodTargets.push(unreadableSkillFile)

      // 2. chmod 000 flat skill .md
      const unreadableFlat = await writeValidFlatSkill(skillsDir, 'unreadable-flat.md', 'unreadable-flat')
      await chmod(unreadableFlat, 0o000)
      chmodTargets.push(unreadableFlat)

      // 3. chmod 000 skill directory itself
      const lockedSkillDir = join(skillsDir, 'locked-skill-dir')
      await writeValidSkill(skillsDir, 'locked-skill-dir')
      await chmod(lockedSkillDir, 0o000)
      chmodTargets.push(lockedSkillDir)

      // 4. Symlink directly in skillsDir pointing into an unreadable (TCC-like) parent directory
      const lockedExternalParent = join(home, 'protected-desktop')
      const externalTargetDir = join(lockedExternalParent, 'tcc-skill')
      await mkdir(externalTargetDir, { recursive: true })
      await writeFile(
        join(externalTargetDir, 'SKILL.md'),
        '---\nname: tcc-skill\ndescription: Protected skill\n---\n\nProtected\n',
        'utf8',
      )
      await symlink(externalTargetDir, join(skillsDir, 'tcc-linked-skill'))

      // 5. Symlinked SKILL.md inside a normal skill dir pointing into the unreadable parent directory
      const symlinkFileSkillDir = join(skillsDir, 'tcc-linked-file-skill')
      await mkdir(symlinkFileSkillDir, { recursive: true })
      await symlink(join(externalTargetDir, 'SKILL.md'), join(symlinkFileSkillDir, 'SKILL.md'))

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
        expect(snapshot.skills.map(skill => skill.name)).toEqual([
          'healthy-alpha',
          'healthy-beta',
          'healthy-flat',
        ])
        expect(warnings.some(line => line.includes('tcc-linked-skill'))).toBe(true)
        expect(warnings.some(line => line.includes('unreadable-skill'))).toBe(true)
        expect(warnings.some(line => line.includes('unreadable-flat.md'))).toBe(true)
        expect(warnings.some(line => line.includes('locked-skill-dir'))).toBe(true)
        expect(warnings.some(line => line.includes('tcc-linked-file-skill'))).toBe(true)
        expect(warnings.some(line => line.includes('skill root') && line.includes('skipped'))).toBe(false)
        expect(warnings.some(line => line.includes('skill provider') && line.includes('skipped'))).toBe(false)
      } finally {
        await ctx.fiber.dispose()
      }
    })

    it('isolates chmod 000 SKILL.md and unreadable symlinks on the native Node path (without ctx.fs)', async () => {
      const { home, skillsDir, chmodTargets } = await createTempRoot('next-skill-eperm-node-')
      await writeValidSkill(skillsDir, 'healthy-one')
      const unreadableSkillFile = await writeValidSkill(skillsDir, 'unreadable-one')
      await chmod(unreadableSkillFile, 0o000)
      chmodTargets.push(unreadableSkillFile)

      const lockedExternalParent = join(home, 'protected-docs')
      const externalTargetDir = join(lockedExternalParent, 'secret-skill')
      await mkdir(externalTargetDir, { recursive: true })
      await writeFile(
        join(externalTargetDir, 'SKILL.md'),
        '---\nname: secret-skill\ndescription: Secret\n---\n\nSecret\n',
        'utf8',
      )
      await symlink(externalTargetDir, join(skillsDir, 'secret-link'))
      await chmod(lockedExternalParent, 0o000)
      chmodTargets.push(lockedExternalParent)

      const ctx = new Context()
      const warnings = captureWarnings(ctx)
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        watch: false,
      })

      try {
        const snapshot = await ctx.skills.snapshot()
        expect(snapshot.complete).toBe(true)
        expect(snapshot.skills.map(skill => skill.name)).toEqual(['healthy-one'])
        expect(warnings.some(line => line.includes('unreadable-one'))).toBe(true)
        expect(warnings.some(line => line.includes('secret-link'))).toBe(true)
      } finally {
        await ctx.fiber.dispose()
      }
    })

    it('still loads all healthy sibling skills when watch=true and an unreadable symlink exists in the root', async () => {
      const { home, skillsDir, chmodTargets } = await createTempRoot('next-skill-eperm-watch-')
      await writeValidSkill(skillsDir, 'watched-good')
      const lockedExternalParent = join(home, 'protected-downloads')
      const externalTargetDir = join(lockedExternalParent, 'tcc-watched')
      await mkdir(externalTargetDir, { recursive: true })
      await symlink(externalTargetDir, join(skillsDir, 'tcc-watched-link'))
      await chmod(lockedExternalParent, 0o000)
      chmodTargets.push(lockedExternalParent)

      const ctx = new Context()
      await ctx.plugin(LocalFileSystem, { cwd: home })
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        watch: true,
      })

      try {
        const snapshot = await ctx.skills.snapshot()
        expect(snapshot.skills.map(skill => skill.name)).toEqual(['watched-good'])
      } finally {
        await ctx.fiber.dispose()
      }
    })
  })

  it('isolates FS_PERMISSION_DENIED / EPERM thrown by ctx.fs on resolve, stat, or readText without dropping siblings', async () => {
    const { home, skillsDir } = await createTempRoot('next-skill-eperm-mock-')
    await writeValidSkill(skillsDir, 'good-alpha')
    const deniedResolve = await writeValidSkill(skillsDir, 'denied-resolve')
    const deniedStat = await writeValidSkill(skillsDir, 'denied-stat')
    const deniedRead = await writeValidSkill(skillsDir, 'denied-read')
    await writeValidSkill(skillsDir, 'good-omega')

    class FaultyPermissionFs extends LocalFileSystem {
      override async resolve(path: string, options?: Parameters<LocalFileSystem['resolve']>[1]) {
        if (path === deniedResolve) {
          throw new FsError(`cannot resolve "${path}": permission denied`, 'FS_PERMISSION_DENIED')
        }
        return await super.resolve(path, options)
      }

      override async stat(target: Parameters<LocalFileSystem['stat']>[0], signal?: AbortSignal) {
        if (target.displayPath === deniedStat) {
          const eperm = Object.assign(new Error(`EPERM: operation not permitted, stat '${target.displayPath}'`), { code: 'EPERM' })
          throw eperm
        }
        return await super.stat(target, signal)
      }

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
      expect(warnings.some(line => line.includes('denied-resolve'))).toBe(true)
      expect(warnings.some(line => line.includes('denied-stat'))).toBe(true)
      expect(warnings.some(line => line.includes('denied-read'))).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('still treats unexpected non-permission I/O errors as incomplete observations', async () => {
    const { home, skillsDir } = await createTempRoot('next-skill-io-error-')
    const brokenFile = await writeValidSkill(skillsDir, 'io-error-skill')

    class FaultyIoFs extends LocalFileSystem {
      override async readText(target: Parameters<LocalFileSystem['readText']>[0], signal?: AbortSignal) {
        if (target.displayPath === brokenFile) {
          throw new FsError(`cannot read "${target.displayPath}": disk I/O error`, 'FS_IO_ERROR')
        }
        return await super.readText(target, signal)
      }
    }

    // Keep FileSystem import type-checked
    expect(FileSystem).toBeDefined()

    const ctx = new Context()
    await ctx.plugin(FaultyIoFs, { cwd: home })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    try {
      const snapshot = await ctx.skills.snapshot()
      expect(snapshot.complete).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
