/** Next entry points reuse Stable/Beta's native packaging and credential boundaries. */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageDirectory } from '../../dsh-plugin-desktop/scripts/package-dir.mjs'
import { createLinuxPackageOptions, packageLinuxArtifacts } from '../../dsh-plugin-desktop/scripts/package-linux.ts'
import { releaseMac } from '../../dsh-plugin-desktop/scripts/release-mac.ts'
import { macReleaseArchitecture } from '../../dsh-plugin-desktop/scripts/release-mac.ts'
import { probeMacRelease, type ProbedMacIdentity } from '../../dsh-plugin-desktop/scripts/mac-signing-probe.ts'
import { withoutMacReleaseSecrets } from '../../dsh-plugin-desktop/scripts/release-preflight.ts'
import { packageMacSmoke } from '../../dsh-plugin-desktop/scripts/package-mac.ts'
import { macSmokeArchitecture } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { createWindowsPackageOptions, packageWindowsArtifact, packageWindowsInstaller } from '../../dsh-plugin-desktop/scripts/package-win.ts'
import { DESKTOP_RUNTIME_FILE } from '../src/runtime-tree.ts'
import { assertMacPackagesRunnable, macPackageCpus, macReleaseArchs, macReleaseNotarization, prepareNextMacRuntime, stagePackagedRuntime, type MacPackageArch, type MacPackageCpu } from './mac-runtime.ts'
import { linuxPackageTargets, macSmokeTarget } from './package-targets.ts'
import { rosettaAvailable } from './primary-runtime.ts'
import { runNextPackagingCommand } from './packaging-command.ts'
import { expectedNextVersion, nextRuntimeBuildPaths, prepareNextRuntime, reusableNextRuntimeTree, runtimeBuildArch, smokeNextRuntime, verifyNextRuntimeTree, verifyPackagedNextRuntime } from './prepare-runtime.ts'
import { macSigningEnvironment } from './sign-packaged.ts'
import { packagingStep, packagingStepSync } from './packaging-step.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = resolve(desktopRoot, '..')
const require = createRequire(import.meta.url)
const mode = process.argv[2]
let macSigningIdentity: ProbedMacIdentity | undefined

/**
 * Optional test-only build version for update drills.
 *
 * electron-builder merges `extraMetadata` before signing, so one value reaches
 * the packaged `package.json` (which the runtime and the updater's bundle check
 * read), `Info.plist` `CFBundleShortVersionString`/`CFBundleVersion`, and the
 * `${version}` artifact name. That produces an installable, correctly signed
 * release whose version differs from the source tree, without editing any
 * version declaration. Only the two shapes the Next channel accepts are allowed.
 * The bundled interpreter payloads and the prepared archive payload record the
 * same version.
 */
const TEST_BUILD_VERSION = process.env.DSH_NEXT_BUILD_VERSION
if (TEST_BUILD_VERSION !== undefined && !/^[0-9]+\.[0-9]+\.[0-9]+-next(?:\.[0-9]+)?$/u.test(TEST_BUILD_VERSION)) {
  throw new Error(`DSH_NEXT_BUILD_VERSION must be x.y.z-next or x.y.z-next.N; received ${TEST_BUILD_VERSION}`)
}
const buildVersion = expectedNextVersion(desktopRoot)
// Electron Builder config macros read these paths from the environment. Single-architecture
// Darwin builds use an isolated target directory; universal and non-Darwin builds keep the
// historical shared paths so Windows/Linux packaging and old entries stay compatible.
const selectedArch = runtimeBuildArch(process.platform)
process.env.DSH_NEXT_RUNTIME_DIR ??= selectedArch === undefined
  ? '.desktop-build/runtime'
  : `.desktop-build/targets/${selectedArch}/runtime`
process.env.DSH_NEXT_PAYLOAD_DIR ??= selectedArch === undefined
  ? '.desktop-build/payload'
  : `.desktop-build/targets/${selectedArch}/payload`
const run = (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void => {
  // Windows resolves the CLI path with backslashes.
  const isBuilder = args.includes('electron-builder') || args.some(arg => arg.replaceAll('\\', '/').endsWith('electron-builder/cli.js'))
  // Beta skips electron-builder's dependency rebuild with npmRebuild=false. electron-builder honours
  // that flag before it calls beforeBuild, and only a beforeBuild answer makes it leave node_modules
  // to the prepared payload, so Next drops the flag: its beforeBuild hook declines the rebuild too.
  const withoutRebuildFlag = isBuilder ? args.filter(arg => arg !== '--config.npmRebuild=false') : args
  const forwarded = [
    ...withoutRebuildFlag,
    ...(TEST_BUILD_VERSION !== undefined && isBuilder
      ? [`--config.extraMetadata.version=${TEST_BUILD_VERSION}`, `--config.buildVersion=${TEST_BUILD_VERSION}`] : []),
    ...(isBuilder && macSigningIdentity !== undefined ? ['--config.mac.sign=./scripts/sign-packaged.ts'] : []),
  ]
  if (TEST_BUILD_VERSION !== undefined && isBuilder) console.log(`Packaging with test build version ${TEST_BUILD_VERSION}; source manifests are unchanged.`)
  const isPreflight = (args.includes('run') && args.includes('check')) || args.some(arg => arg.includes('check:win-package') || arg.includes('check:linux-package'))
  const stage = isBuilder ? 'builder:total' : isPreflight ? 'build:package-preflight' : 'package:command'
  const windowsInstaller = isBuilder && mode === 'win'
  const windowsCompression = env.DSH_WINDOWS_PACKAGE_COMPRESSION
  const defaultWindowsCompression = windowsInstaller && env.ELECTRON_BUILDER_COMPRESSION_LEVEL === undefined
    && (windowsCompression === undefined || windowsCompression === '' || windowsCompression === 'normal')
  const builderEnv = {
    ...env,
    ...(windowsInstaller ? { DSH_NEXT_WINDOWS_FAST_COMPRESSION: '1' } : {}),
    ...(defaultWindowsCompression ? { ELECTRON_BUILDER_COMPRESSION_LEVEL: '3' } : {}),
    ...(isBuilder && macSigningIdentity !== undefined ? macSigningEnvironment(macSigningIdentity) : {}),
  }
  if (isBuilder && env.DSH_DESKTOP_PACKAGING_RUN_DIR !== undefined) {
    // `yarn exec electron-builder` cannot receive Node's `--import` flag. Run the
    // resolved Electron Builder CLI through Node so the measurement adapter loads
    // before the CLI, without putting secrets or script paths in the journal.
    const builderArgs = forwarded[0] === 'exec' && forwarded[1] === 'electron-builder' ? forwarded.slice(2) : forwarded.slice(1)
    const cli = require.resolve('electron-builder/cli.js')
    packagingStepSync(stage, () => runNextPackagingCommand(process.execPath,
      ['--import', new URL('./packaging-builder.mjs', import.meta.url).href, cli, ...builderArgs], cwd, builderEnv, workspaceRoot))
    return
  }
  packagingStepSync(stage, () => runNextPackagingCommand(command, forwarded, cwd, builderEnv, workspaceRoot))
}
const listCodeSigningIdentities = (env: NodeJS.ProcessEnv): string => {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { env, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw result.error ?? new Error('Signing identity discovery failed')
  return result.stdout
}

let interpretersVerified = false

/**
 * Prepare and verify every interpreter payload the platform ships. Signed macOS builds sign
 * the assembled copy so the prepared runtime stays reusable and keeps the same cache inputs.
 */
async function prepareInterpreters(): Promise<void> {
  const paths = nextRuntimeBuildPaths(desktopRoot, runtimeBuildArch(process.platform))
  const reusable = packagingStepSync('runtime:check-reuse', () => reusableNextRuntimeTree(paths.runtime, process.platform, buildVersion))
  if (reusable.length > 0) {
    console.log(`Reusing prepared primary runtime for ${reusable.map(item => item.arch).join(', ')}`)
  } else {
    const root = await packagingStep('runtime:prepare-primary', () => prepareNextRuntime({ desktopRoot, platform: process.platform, version: buildVersion }))
    packagingStepSync('runtime:verify-primary', () => verifyNextRuntimeTree(root, process.platform, buildVersion))
    // The signed build exercises the verified final bytes inside the signing hook.
    if (macSigningIdentity === undefined) packagingStepSync('runtime:smoke-primary', () => smokeNextRuntime(root, process.platform))
  }

  interpretersVerified = true
}
/**
 * Materialize and seal the payload electron-builder archives. A separate process keeps the
 * manifest transformer it borrows from electron-builder out of this entry point.
 * @param platform - Platform being packaged.
 * @param macArch - The macOS package the payload is for.
 */
const preparePayload = (platform: NodeJS.Platform, macArch?: MacPackageArch): void => packagingStepSync('payload:total', () => {
  const result = spawnSync(process.execPath, [join(desktopRoot, 'scripts', 'prepare-payload.ts'), '--platform', platform,
    ...(macArch === undefined ? [] : ['--arch', macArch]),
    ...(TEST_BUILD_VERSION === undefined ? [] : ['--version', TEST_BUILD_VERSION])], { cwd: desktopRoot, env: process.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Next payload preparation exited with ${String(result.status)}`)
})
/**
 * The shared flows call this right before electron-builder: the interpreter payloads were prepared
 * before they started and must still verify, and the archive payload is prepared now. A macOS
 * package also gets its own copy of the interpreter payloads of its CPUs, which its extra
 * resources take as `Resources/runtime`.
 * @param platform - Platform being packaged; the shared flows package the host platform.
 * @param macArch - The macOS package: a release names each in turn, other builds follow `DSH_MAC_SMOKE_ARCH`.
 */
const prepareRuntime = (platform: NodeJS.Platform = process.platform, macArch: MacPackageArch = macSmokeArchitecture(process.env)): void => {
  const cpus = macPackageCpus(macArch)
  const runtime = nextRuntimeBuildPaths(desktopRoot).runtime
  if (platform === 'darwin') prepareNextMacRuntime(desktopRoot, cpus)
  if (!interpretersVerified || platform !== process.platform) {
    verifyNextRuntimeTree(nextRuntimeBuildPaths(desktopRoot, runtimeBuildArch(platform)).runtime, platform, buildVersion)
  }
  if (platform === 'darwin') {
    packagingStepSync('runtime:stage-package', () => verifyPackagedNextRuntime(stagePackagedRuntime(desktopRoot, runtime, cpus), platform, buildVersion, cpus))
  }
  if (process.env.DSH_WINDOWS_REUSE_UNPACKED === '1' && existsSync(join(desktopRoot, '.desktop-build', 'payload', DESKTOP_RUNTIME_FILE))) {
    console.log('Reusing prepared payload for unpacked Windows application directory.')
    return
  }
  preparePayload(platform, platform === 'darwin' ? macArch : undefined)
}
const outputDir = process.env.DSH_MAC_RELEASE_OUTPUT === undefined
  ? join(desktopRoot, 'dist', mode === 'mac' ? 'mac-release' : 'mac-smoke')
  : resolve(desktopRoot, process.env.DSH_MAC_RELEASE_OUTPUT)
const shared = { env: process.env, platform: process.platform, desktopRoot, outputDir,
  releaseArch: macReleaseArchitecture(process.env),
  resetOutput: () => rmSync(outputDir, { force: true, recursive: true }), run, log: console.log, prepareRuntime }
if (mode === 'dir') {
  await prepareInterpreters()
  prepareRuntime()
  packageDirectory({ cwd: desktopRoot, electronBuilderCli: require.resolve('electron-builder/cli.js'), electronDistPath: join(dirname(require.resolve('electron/package.json')), 'dist') })
} else if (mode === 'mac' || mode === 'mac-app') {
  macSigningIdentity = await packagingStep('sign:probe', () => probeMacRelease())
  if (process.env.DSH_MAC_RELEASE_COMMON_PREP !== '1') {
    const repoRoot = resolve(workspaceRoot, '..')
    packagingStepSync('prepare:plugins', () => runNextPackagingCommand(process.execPath, [join(repoRoot, 'scripts', 'prepare-local-plugins.mjs')], repoRoot, withoutMacReleaseSecrets(process.env), workspaceRoot))
  }
  await prepareInterpreters()
  releaseMac({
    ...shared,
    listCodeSigningIdentities,
    commonPrepDone: process.env.DSH_MAC_RELEASE_COMMON_PREP === '1',
    ...(mode === 'mac-app' ? { packageTarget: 'dir' as const, notarize: false, verify: false } : {}),
  })
} else if (mode === 'mac-smoke') {
  assertMacPackagesRunnable([macSmokeArchitecture(process.env)], process.arch, rosettaAvailable)
  await prepareInterpreters()
  packageMacSmoke({ ...shared, workspaceRoot, arch: process.arch, nodeVersion: process.versions.node, target: macSmokeTarget(process.env),
    builderCli: require.resolve('electron-builder/cli.js'), verifier: join(desktopRoot, 'scripts/verify-mac-smoke.ts'), nodeExecutable: process.execPath })
} else if (mode === 'win') {
  await prepareInterpreters()
  packageWindowsInstaller({ ...createWindowsPackageOptions(), desktopRoot, workspaceRoot, run, prepareRuntime,
    verifier: join(desktopRoot, 'scripts/verify-win-installer.ts') })
} else if (mode === 'win-portable') {
  await prepareInterpreters()
  const winOptions = createWindowsPackageOptions()
  packageWindowsArtifact({ ...winOptions, env: { ...winOptions.env, DSH_PACKAGE_VERIFY_MODE: 'win-portable' }, desktopRoot, workspaceRoot, run, prepareRuntime,
    verifier: join(desktopRoot, 'scripts/verify-win-installer.ts') }, 'zip', 'portable archive')
} else if (mode === 'linux') {
  await prepareInterpreters()
  const linuxOptions = createLinuxPackageOptions()
  // The interpreter payload and the archive audit follow the host CPU, so both Linux CPUs package natively.
  packageLinuxArtifacts({ ...linuxOptions, supportedArchs: ['x64', 'arm64'], targets: linuxPackageTargets(process.env), env: { ...linuxOptions.env, DSH_PACKAGE_VERIFY_MODE: 'linux' }, desktopRoot, workspaceRoot, run, prepareRuntime,
    verifier: join(desktopRoot, 'scripts/verify-win-installer.ts') })
} else throw new Error('Expected dir, mac, mac-app, mac-smoke, win, win-portable or linux')
