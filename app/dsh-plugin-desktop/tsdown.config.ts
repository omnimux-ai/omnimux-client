import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

function readBakedRetiredTiersJson(): string {
  const tiersPath = fileURLToPath(new URL('../config/plugin-tiers.json', import.meta.url))
  const parsed = JSON.parse(readFileSync(tiersPath, 'utf8')) as { tiers?: { retired?: unknown } }
  const retired = parsed.tiers?.retired
  if (!Array.isArray(retired) || retired.some(name => typeof name !== 'string' || name === '')) {
    throw new Error(`tsdown config: invalid tiers.retired in ${tiersPath}`)
  }
  return JSON.stringify({ tiers: { retired } })
}

const PACKAGE_NAME = 'dsh-plugin-desktop'
const BAKED_RETIRED_TIERS_JSON = readBakedRetiredTiersJson()

export default defineConfig([
  {
    name: PACKAGE_NAME,
    define: {
      'process.env.OMNIMUX_BAKED_RETIRED_TIERS_JSON': JSON.stringify(BAKED_RETIRED_TIERS_JSON),
    },
    entry: {
      index: 'src/index.ts',
      'module-resolution': 'src/module-resolution.ts',
      'plugin-packages': 'src/plugin-packages.ts',
      webserver: 'src/webserver.ts',
      profile: 'src/profile.ts',
      'profile-manager': 'src/profile-manager.ts',
      'profile-service': 'src/profile-service.ts',
      'profile-context': 'src/profile-context.ts',
      'desktop-plugins': 'src/desktop-plugins.ts',
      pnpm: 'src/pnpm.ts',
      profiles: 'src/profiles.ts',
      diagnostics: 'src/diagnostics.ts',
      notifications: 'src/notifications.ts',
      'diagnostic-export-worker': 'src/diagnostic-export-worker.ts',
      'packaged-runtime-smoke': 'src/packaged-runtime-smoke.ts',
      runtime: 'src/runtime.ts',
      'electron-runtime': 'src/electron-runtime.ts',
      'desktop-runtime-environment': 'src/desktop-runtime-environment.ts',
      'desktop-terminal': 'src/desktop-terminal.ts',
      'desktop-cli': 'src/desktop-cli.ts',
      terminal: 'src/terminal.ts',
      'update-checker': 'src/update-checker.ts',
      'update-download': 'src/update-download.ts',
      updates: 'src/updates.ts',
      'windows-pwsh-sandbox': 'src/windows-pwsh-sandbox.ts',
      'windows-acl-sandbox-provider': 'src/windows-acl-sandbox-provider.ts',
      'windows-acl-runner': 'src/windows-acl-runner.ts',
      main: 'src/main.ts',
      'preset-profile': 'src/preset-profile.ts',
      'host-process-entry': 'src/host-process-entry.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
  },
  {
    name: `${PACKAGE_NAME}/bin`,
    entry: { bin: 'src/bin.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    outputOptions: {
      banner: '#!/usr/bin/env node',
    },
  },
  {
    name: `${PACKAGE_NAME}/preload`,
    entry: { preload: 'src/preload.ts', 'compatibility-preload': 'src/compatibility-preload.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    external: ['electron'],
    outputOptions: {
      entryFileNames: '[name].cjs',
    },
  },
])
