import { createHash } from 'node:crypto'
import { access, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostRpc } from '../src/host-rpc.ts'
import { bindNativeRuntime, createHostRuntime, runtimeSnapshot } from '../src/host-runtime-bridge.ts'
import type { DesktopRuntime } from '../src/runtime.ts'
import {
  UpdateDownloadError,
  assertInstallerDigest,
  downloadDesktopUpdate,
  verifyInstallerSignature,
  type SignatureCommandRunner,
} from '../src/update-download.ts'

const temporaryRoots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-updater-sec-'))
  temporaryRoots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('legacy desktop updater security gates (#367)', () => {
  it('fails closed in downloadDesktopUpdate when expectedSha256 is missing or empty', async () => {
    const dir = await tempDir()
    const request = vi.fn()
    for (const missing of [undefined, '', '   ']) {
      await expect(downloadDesktopUpdate({
        platform: 'darwin',
        version: '2.1.0',
        destinationPath: join(dir, 'OmniMux-2.1.0-mac.dmg'),
        request,
        expectedSha256: missing as unknown as string,
      })).rejects.toMatchObject({ name: 'UpdateDownloadError', code: 'invalid-options' })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('forwards installerSha256 across host-runtime-bridge IPC without dropping it', async () => {
    const { port1, port2 } = new MessageChannel()
    const [parent, child] = [port1, port2].map(port => new HostRpc({
      send: value => port.postMessage(value),
      listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
    })) as [HostRpc, HostRpc]
    const downloadAndOpen = vi.fn(async () => {})
    const native = {
      platform: 'darwin',
      locale: 'en',
      updates: {
        isPackaged: true,
        canDownload: true,
        currentVersion: '2.0.0',
        statePath: '/tmp/state.json',
        downloadAndOpen,
      },
    } as unknown as DesktopRuntime
    const release = bindNativeRuntime(parent, native)
    try {
      const host = createHostRuntime(child, runtimeSnapshot(native))
      const digests = { darwin: 'a'.repeat(64), win32: 'b'.repeat(64) }
      await host.updates.downloadAndOpen('2.1.0', new AbortController().signal, 'stable', digests)
      expect(downloadAndOpen).toHaveBeenCalledWith('2.1.0', expect.any(AbortSignal), 'stable', digests)
    } finally {
      await release()
      parent.close()
      child.close()
      port1.close()
      port2.close()
    }
  })

  it('rejects tampered files and symlinks in assertInstallerDigest', async () => {
    const dir = await tempDir()
    const file = join(dir, 'installer.dmg')
    const link = join(dir, 'installer-link.dmg')
    const content = Buffer.from('installer-bytes')
    await writeFile(file, content)
    await symlink(file, link)
    const goodDigest = createHash('sha256').update(content).digest('hex')

    await expect(assertInstallerDigest(file, goodDigest)).resolves.toBeUndefined()
    await expect(assertInstallerDigest(file, '0'.repeat(64))).rejects.toMatchObject({ code: 'invalid-artifact' })
    await expect(assertInstallerDigest(link, goodDigest)).rejects.toMatchObject({ code: 'invalid-artifact' })
  })

  it('verifies Windows Authenticode signatures, pins to installed executable thumbprint by default, and rejects unsigned or tampered installers', async () => {
    const dir = await tempDir()
    const exe = join(dir, 'OmniMux-2.1.0-windows.exe')
    await writeFile(exe, Buffer.from('MZ-placeholder'))

    const validThumb = 'ab'.repeat(20)
    const seenFiles: string[] = []
    const validRunner: SignatureCommandRunner = vi.fn(async (file) => {
      seenFiles.push(file)
      return {
        stdout: JSON.stringify({ Status: 'Valid', Thumbprint: validThumb }),
        stderr: '',
      }
    })
    await expect(verifyInstallerSignature(exe, 'win32', {
      runCommand: validRunner,
      expectedSignerThumbprint: validThumb,
    })).resolves.toBeUndefined()
    expect(seenFiles[0]).toMatch(/WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i)

    // When expectedSignerThumbprint is omitted, pin candidate thumbprint against installed executable.
    const pinnedMismatchRunner: SignatureCommandRunner = vi.fn(async (_file, _args, _opts) => {
      const callIdx = (pinnedMismatchRunner as ReturnType<typeof vi.fn>).mock.calls.length
      return {
        stdout: JSON.stringify({
          Status: 'Valid',
          Thumbprint: callIdx === 1 ? validThumb : 'cd'.repeat(20),
        }),
        stderr: '',
      }
    })
    await expect(verifyInstallerSignature(exe, 'win32', {
      runCommand: pinnedMismatchRunner,
      installedExecutablePath: 'C:\\Program Files\\OmniMux\\OmniMux.exe',
    })).rejects.toMatchObject({ code: 'invalid-artifact' })

    const unsignedRunner: SignatureCommandRunner = vi.fn(async () => ({
      stdout: JSON.stringify({ Status: 'NotSigned', Thumbprint: '' }),
      stderr: '',
    }))
    await expect(verifyInstallerSignature(exe, 'win32', {
      runCommand: unsignedRunner,
    })).rejects.toBeInstanceOf(UpdateDownloadError)

    const mismatchRunner: SignatureCommandRunner = vi.fn(async () => ({
      stdout: JSON.stringify({ Status: 'Valid', Thumbprint: 'cd'.repeat(20) }),
      stderr: '',
    }))
    await expect(verifyInstallerSignature(exe, 'win32', {
      runCommand: mismatchRunner,
      expectedSignerThumbprint: validThumb,
    })).rejects.toMatchObject({ code: 'invalid-artifact' })
  })

  it('verifies macOS DMG codesign Designated Requirement + TeamIdentifier match, rejects spoofed output, and always detaches', async () => {
    const dir = await tempDir()
    const dmg = join(dir, 'OmniMux-2.1.0-mac.dmg')
    await writeFile(dmg, Buffer.from('dmg-placeholder'))
    const installedExecutablePath = '/Applications/OmniMux.app/Contents/MacOS/OmniMux'
    const readMountEntries = async () => [{ name: 'OmniMux.app', isDirectory: () => true }]

    const detachCalls: string[][] = []
    const codesignVerifyArgs: string[][] = []
    const matchingRunner: SignatureCommandRunner = vi.fn(async (file, args) => {
      if (file === '/usr/bin/hdiutil' && args[0] === 'detach') detachCalls.push([...args])
      if (file === '/usr/bin/codesign' && args[0] === '--verify') codesignVerifyArgs.push([...args])
      if (file === '/usr/bin/codesign' && args[0] === '-dv') {
        return { stdout: '', stderr: 'Authority=Developer ID\nTeamIdentifier=TEAM123456\n' }
      }
      return { stdout: '', stderr: '' }
    })
    await expect(verifyInstallerSignature(dmg, 'darwin', {
      installedExecutablePath,
      runCommand: matchingRunner,
      readMountEntries,
    })).resolves.toBeUndefined()
    expect(detachCalls).toHaveLength(1)
    expect(codesignVerifyArgs).toHaveLength(2)
    expect(codesignVerifyArgs[0]).toContain('/Applications/OmniMux.app')
    expect(codesignVerifyArgs[1]).toContain('-R')
    expect(codesignVerifyArgs[1]).toContain('=anchor apple generic and certificate leaf[subject.OU] = "TEAM123456"')

    // Reject duplicate / newline-injected TeamIdentifier lines in codesign stderr
    const spoofDetach: string[][] = []
    const spoofRunner: SignatureCommandRunner = vi.fn(async (file, args) => {
      if (file === '/usr/bin/hdiutil' && args[0] === 'detach') spoofDetach.push([...args])
      if (file === '/usr/bin/codesign' && args[0] === '-dv') {
        const target = args[args.length - 1] ?? ''
        return {
          stdout: '',
          stderr: target.startsWith('/Applications/')
            ? 'TeamIdentifier=TEAM123456\n'
            : 'Executable=/tmp/foo\nTeamIdentifier=TEAM123456\nTeamIdentifier=EVIL999999\n',
        }
      }
      return { stdout: '', stderr: '' }
    })
    await expect(verifyInstallerSignature(dmg, 'darwin', {
      installedExecutablePath,
      runCommand: spoofRunner,
      readMountEntries,
    })).rejects.toMatchObject({ code: 'invalid-artifact' })
    expect(spoofDetach).toHaveLength(1)

    // Reject bundle names containing control characters
    await expect(verifyInstallerSignature(dmg, 'darwin', {
      installedExecutablePath,
      runCommand: matchingRunner,
      readMountEntries: async () => [{ name: 'OmniMux\nTeamIdentifier=TEAM123456.app', isDirectory: () => true }],
    })).rejects.toMatchObject({ code: 'invalid-artifact' })
  })

  it('cleans up temporary file and never creates destinationPath when verifyArtifact rejects', async () => {
    const dir = await tempDir()
    const destinationPath = join(dir, 'OmniMux-2.1.0-mac.dmg')
    const payload = Buffer.alloc(1024, 0x5a)
    payload.write('koly', payload.byteLength - 512, 'ascii')
    const digest = createHash('sha256').update(payload).digest('hex')
    const request = vi.fn(async (url: string) => ({
      finalUrl: url,
      response: new Response(payload, {
        status: 200,
        headers: {
          'content-length': String(payload.byteLength),
          'X-DSH-Desktop-Target-Version': '2.1.0',
        },
      }),
    }))

    await expect(downloadDesktopUpdate({
      platform: 'darwin',
      version: '2.1.0',
      destinationPath,
      expectedSha256: digest,
      request,
      verifyArtifact: async () => {
        throw new UpdateDownloadError('invalid-artifact', 'signature verification failed')
      },
    })).rejects.toMatchObject({ code: 'invalid-artifact' })

    await expect(access(destinationPath)).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })
})
