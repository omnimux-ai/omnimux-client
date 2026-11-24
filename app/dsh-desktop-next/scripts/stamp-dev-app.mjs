#!/usr/bin/env node
/**
 * Stamp an unpacked macOS Desktop Next `.app` bundle with Dev channel identity
 * in `Contents/Info.plist` after verifying its `Contents/Resources/build-info.json`.
 *
 * Fail-closed: refuses to mutate Info.plist unless `build-info.json` proves this
 * bundle was produced for the `development` channel (`package-dev` / `dsh-desktop-next`).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEV_BUNDLE_ID = 'ai.omnimux.desktop.dev'
export const DEV_DISPLAY_NAME = 'OmniMux Dev'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function findCandidateApp() {
  for (const dirName of ['mac-arm64', 'mac']) {
    const dir = join(packageRoot, 'dist', dirName)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.app')) return join(dir, name)
    }
  }
  return null
}

function setOrAddPlistString(plistPath, keyPath, value) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${keyPath} ${value}`, plistPath], { stdio: 'ignore' })
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${keyPath} string ${value}`, plistPath], { stdio: 'ignore' })
  }
}

/** @param {string | null} appPath */
export function stampNextDevApp(appPath = findCandidateApp()) {
  if (!appPath || !existsSync(appPath)) {
    throw new Error(`stamp-dev-app: target app bundle not found (${appPath ?? 'none'})`)
  }
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(plistPath)) throw new Error(`stamp-dev-app: Info.plist not found at ${plistPath}`)

  const buildInfoPath = join(appPath, 'Contents', 'Resources', 'build-info.json')
  let info
  try {
    info = JSON.parse(readFileSync(buildInfoPath, 'utf8'))
  } catch (cause) {
    throw new Error(
      `stamp-dev-app: build-info.json is missing or unreadable; rebuild with corepack yarn package:dev (${buildInfoPath})`,
      { cause },
    )
  }
  if (info?.channel !== 'package-dev' || info?.releaseChannel !== 'development' || info?.shell !== 'dsh-desktop-next') {
    throw new Error(
      `stamp-dev-app: requires a dsh-desktop-next development build (channel=package-dev, releaseChannel=development), received ${JSON.stringify({ channel: info?.channel, releaseChannel: info?.releaseChannel, shell: info?.shell })}; rebuild with corepack yarn package:dev`,
    )
  }

  setOrAddPlistString(plistPath, 'CFBundleIdentifier', DEV_BUNDLE_ID)
  setOrAddPlistString(plistPath, 'CFBundleDisplayName', DEV_DISPLAY_NAME)

  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :LSEnvironment dict', plistPath], { stdio: 'ignore' })
  } catch { /* LSEnvironment dict already exists. */ }
  setOrAddPlistString(plistPath, 'LSEnvironment:OMNIMUX_CHANNEL', 'dev')

  return plistPath
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plistPath = stampNextDevApp(process.argv[2])
  process.stdout.write(`✓ Stamped Next Dev identity (${DEV_BUNDLE_ID}) into ${plistPath}\n`)
}
