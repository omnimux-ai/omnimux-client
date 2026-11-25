/** Native installer handoff for OmniMux on macOS (hardened atomic swap) and Windows (transactional NSIS). */

import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { DESKTOP_APP_ID } from '../product-identity.ts'
import { OmniMuxUpdateError } from './manifest.ts'

const execute = promisify(execFile)
export const OMNIMUX_BUNDLE_ID = DESKTOP_APP_ID

const MAC_PROGRESS_UI_SCRIPT = `
ObjC.import("Cocoa");
const app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
const env = $.NSProcessInfo.processInfo.environment;
const title = ObjC.unwrap(env.objectForKey("OMNIMUX_UPDATE_TITLE")) || "OmniMux";
const message = ObjC.unwrap(env.objectForKey("OMNIMUX_UPDATE_MESSAGE")) || "Updating OmniMux…";
const win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, 380, 110), $.NSTitledWindowMask, $.NSBackingStoreBuffered, false);
win.setTitle($(title));
win.setLevel($.NSFloatingWindowLevel);
win.setReleasedWhenClosed(false);
const content = win.contentView;
const label = $.NSTextField.alloc.initWithFrame($.NSMakeRect(24, 58, 332, 24));
label.setStringValue($(message));
label.setBezeled(false);
label.setDrawsBackground(false);
label.setEditable(false);
label.setSelectable(false);
label.setFont($.NSFont.systemFontOfSize(13));
content.addSubview(label);
const bar = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect(24, 28, 332, 20));
bar.setStyle($.NSProgressIndicatorBarStyle);
bar.setIndeterminate(true);
bar.startAnimation(null);
content.addSubview(bar);
win.center;
win.makeKeyAndOrderFront(null);
app.activateIgnoringOtherApps(true);
app.run;
`

/**
 * Hardened detached macOS bundle replacement script:
 * - Writes step-by-step timestamps to `~/Library/Logs/OmniMux/updater.log`.
 * - Waits up to 60 seconds (300 * 0.2s) for the exiting app PID.
 * - Atomically backs up and replaces the `.app` bundle, restoring and relaunching
 *   the original app if any step fails so the user is never left stranded.
 */
export const OMNIMUX_MAC_UPDATE_SCRIPT = [
  'LOG_DIR="$HOME/Library/Logs/OmniMux"',
  'mkdir -p "$LOG_DIR" 2>/dev/null || true',
  'chmod 700 "$LOG_DIR" 2>/dev/null || true',
  'LOG_FILE="$LOG_DIR/updater.log"',
  'log() { printf "%s %s\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG_FILE" 2>/dev/null || true; }',
  'log "updater handoff started (pid=$OMNIMUX_UPDATE_PID target=$OMNIMUX_UPDATE_INSTALLED)"',
  '/usr/bin/osascript -l JavaScript -e "$OMNIMUX_UPDATE_UI_SCRIPT" >/dev/null 2>&1 &',
  'UI_PID=$!',
  'cleanup() { kill "$UI_PID" 2>/dev/null || true; }',
  'trap cleanup EXIT',
  'i=0',
  'while kill -0 "$OMNIMUX_UPDATE_PID" 2>/dev/null; do',
  '  i=$((i + 1))',
  '  if [ "$i" -ge 300 ]; then',
  '    log "error: timed out waiting 60s for pid $OMNIMUX_UPDATE_PID to exit"',
  '    cleanup',
  '    /usr/bin/open "$OMNIMUX_UPDATE_INSTALLED" 2>/dev/null || true',
  '    exit 1',
  '  fi',
  '  sleep 0.2',
  'done',
  'BACKUP="${OMNIMUX_UPDATE_INSTALLED}.backup-$$"',
  'rm -rf "$BACKUP"',
  'if ! mv "$OMNIMUX_UPDATE_INSTALLED" "$BACKUP"; then',
  '  log "error: failed to move installed bundle to backup"',
  '  cleanup',
  '  /usr/bin/open "$OMNIMUX_UPDATE_INSTALLED" 2>/dev/null || true',
  '  exit 1',
  'fi',
  'if mv "$OMNIMUX_UPDATE_STAGED" "$OMNIMUX_UPDATE_INSTALLED" 2>/dev/null || /usr/bin/ditto "$OMNIMUX_UPDATE_STAGED" "$OMNIMUX_UPDATE_INSTALLED"; then',
  '  rm -rf "$BACKUP" "$OMNIMUX_UPDATE_DIR"',
  '  log "replaced application bundle successfully"',
  'else',
  '  log "error: replacement failed, restoring backup"',
  '  rm -rf "$OMNIMUX_UPDATE_INSTALLED"',
  '  mv "$BACKUP" "$OMNIMUX_UPDATE_INSTALLED"',
  '  cleanup',
  '  /usr/bin/open "$OMNIMUX_UPDATE_INSTALLED" 2>/dev/null || true',
  '  exit 1',
  'fi',
  '/usr/bin/xattr -dr com.apple.quarantine "$OMNIMUX_UPDATE_INSTALLED" 2>/dev/null || true',
  'sleep 0.8',
  'cleanup',
  'log "relaunching updated application with --updated"',
  '/usr/bin/open "$OMNIMUX_UPDATE_INSTALLED" --args --updated',
].join('\n')

/** Check both bundle identity and embedded SemVer before validating the signature. */
export function assertOmniMuxMacBundle(identifier: string, manifest: unknown, version: string): void {
  if (identifier.trim() !== OMNIMUX_BUNDLE_ID || !manifest || typeof manifest !== 'object'
    || (manifest as { name?: unknown }).name !== 'dsh-desktop-next'
    || (manifest as { version?: unknown }).version !== version) {
    throw new OmniMuxUpdateError('PREPARE_FAILED', 'The downloaded application does not match this OmniMux release')
  }
}

export function assertOmniMuxWindowsInstaller(info: { ProductName?: unknown; ProductVersion?: unknown }, version: string): void {
  if (info.ProductName !== 'OmniMux' || info.ProductVersion !== version) {
    throw new OmniMuxUpdateError('PREPARE_FAILED', 'The installer does not match this OmniMux release')
  }
}

export class OmniMuxUpdateInstaller {
  private prepared?: { path: string; version: string; directory?: string; bundle?: string; installed?: string }
  private nativeReady = false

  constructor(private readonly options: { platform: string; executable: string; language?: () => string; log(error: unknown): void }) {}

  async prepare(path: string, version: string, directory: string, signal: AbortSignal): Promise<void> {
    this.prepared = undefined
    this.nativeReady = false
    if (this.options.platform === 'win32') {
      const script = '$ErrorActionPreference="Stop"; (Get-Item -LiteralPath $env:OMNIMUX_UPDATE_INSTALLER).VersionInfo | Select-Object ProductName,ProductVersion | ConvertTo-Json -Compress'
      const info = await execute(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { signal, timeout: 30_000, windowsHide: true, env: { ...process.env, OMNIMUX_UPDATE_INSTALLER: path }, maxBuffer: 16_384 })
      assertOmniMuxWindowsInstaller(JSON.parse(info.stdout.replace(/^\uFEFF/, '')), version)
      this.prepared = { path, version }
      return
    }
    if (this.options.platform !== 'darwin') {
      throw new OmniMuxUpdateError('PREPARE_FAILED', 'Unsupported update platform')
    }
    const mount = join(directory, 'volume')
    await mkdir(mount, { mode: 0o700 })
    const run = (file: string, args: string[]) => execute(file, args, { signal, timeout: 10 * 60_000, maxBuffer: 1024 * 1024 })
    const installed = dirname(dirname(dirname(this.options.executable)))
    if (!installed.endsWith('.app')) {
      throw new OmniMuxUpdateError('PREPARE_FAILED', 'Invalid installed OmniMux application bundle')
    }
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed])
    let attached = false
    try {
      await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, path])
      attached = true
      const entries = await readdir(mount, { withFileTypes: true })
      const apps = entries.filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
      if (apps.length !== 1) {
        throw new OmniMuxUpdateError('PREPARE_FAILED', 'Expected one application in the OmniMux disk image')
      }
      const bundle = join(mount, apps[0]!.name)
      const info = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(bundle, 'Contents', 'Info.plist')])
      const manifestPath = join(bundle, 'Contents', 'Resources', 'app', 'package.json')
      const meta = await lstat(manifestPath)
      if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 128 * 1024) {
        throw new OmniMuxUpdateError('PREPARE_FAILED', 'Invalid OmniMux application manifest')
      }
      assertOmniMuxMacBundle(info.stdout, JSON.parse(await readFile(manifestPath, 'utf8')), version)
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
      const installedSignature = await run('/usr/bin/codesign', ['-dv', '--verbose=4', installed])
      const candidateSignature = await run('/usr/bin/codesign', ['-dv', '--verbose=4', bundle])
      const team = /^TeamIdentifier=([A-Z0-9]+)$/m.exec(installedSignature.stderr)?.[1]
      if (!team || !candidateSignature.stderr.split('\n').includes(`TeamIdentifier=${team}`)) {
        throw new OmniMuxUpdateError('PREPARE_FAILED', 'Update signing team does not match the installed application')
      }
      const staged = join(directory, apps[0]!.name)
      await run('/usr/bin/ditto', [bundle, staged])
      this.prepared = { path, version, directory, bundle: staged, installed }
    } finally {
      await execute('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 }).catch(async () => {
        try { await execute('/usr/bin/hdiutil', ['detach', '-force', mount], { timeout: 30_000 }) }
        catch (error) { if (attached) throw error }
      })
    }
  }

  /** Validate that the prepared bundle and target directory are ready before shutting down the app. */
  async stage(): Promise<void> {
    const prepared = this.prepared
    if (!prepared) throw new OmniMuxUpdateError('INSTALL_FAILED', 'No prepared OmniMux update')
    if (this.options.platform === 'win32') {
      await access(prepared.path, constants.R_OK)
      return
    }
    if (this.nativeReady) return
    if (!prepared.bundle || !prepared.installed || !prepared.directory) {
      throw new OmniMuxUpdateError('INSTALL_FAILED', 'No prepared OmniMux update')
    }
    const stat = await lstat(prepared.bundle)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new OmniMuxUpdateError('INSTALL_FAILED', 'Prepared OmniMux application bundle is unavailable')
    }
    await access(dirname(prepared.installed), constants.W_OK)
    await access(prepared.installed, constants.W_OK)
    this.nativeReady = true
  }

  /** Called after the Host and windows have finished shutting down. */
  async launch(): Promise<void> {
    if (this.options.platform === 'darwin') {
      const prepared = this.prepared
      if (!this.nativeReady || !prepared?.bundle || !prepared.installed || !prepared.directory) {
        throw new OmniMuxUpdateError('INSTALL_FAILED', 'No prepared update installer')
      }
      const zh = (this.options.language?.() ?? 'en').toLowerCase().startsWith('zh')
      const message = zh ? `正在更新 OmniMux 至 ${prepared.version}，请稍候…` : `Updating OmniMux to ${prepared.version}, please wait…`
      await new Promise<void>((resolveLaunch, rejectLaunch) => {
        const child = spawn('/bin/sh', ['-c', OMNIMUX_MAC_UPDATE_SCRIPT], {
          detached: true,
          stdio: 'ignore',
          shell: false,
          cwd: '/',
          env: {
            ...process.env,
            OMNIMUX_UPDATE_PID: String(process.pid),
            OMNIMUX_UPDATE_STAGED: prepared.bundle!,
            OMNIMUX_UPDATE_INSTALLED: prepared.installed!,
            OMNIMUX_UPDATE_DIR: prepared.directory!,
            OMNIMUX_UPDATE_TITLE: 'OmniMux',
            OMNIMUX_UPDATE_MESSAGE: message,
            OMNIMUX_UPDATE_UI_SCRIPT: MAC_PROGRESS_UI_SCRIPT,
          },
        })
        child.once('error', rejectLaunch)
        child.once('spawn', () => {
          child.off('error', rejectLaunch)
          child.on('error', this.options.log)
          child.unref()
          resolveLaunch()
        })
      })
      return
    }
    if (this.options.platform !== 'win32' || !this.prepared) {
      throw new OmniMuxUpdateError('INSTALL_FAILED', 'No prepared update installer')
    }
    await new Promise<void>((resolveLaunch, rejectLaunch) => {
      const child = spawn(this.prepared!.path, ['--updated', '--force-run'], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false,
        cwd: tmpdir(),
      })
      child.once('error', rejectLaunch)
      child.once('spawn', () => {
        child.off('error', rejectLaunch)
        child.on('error', this.options.log)
        child.unref()
        resolveLaunch()
      })
    })
  }
}
