/** Thin compatibility re-export over `omnimux-updater/installer.ts`. */

export {
  assertOmniMuxMacBundle as assertNextMacBundle,
  assertOmniMuxWindowsInstaller as assertNextWindowsInstaller,
  OMNIMUX_BUNDLE_ID as NEXT_APP_ID,
  OMNIMUX_MAC_UPDATE_SCRIPT as MAC_UPDATE_SCRIPT,
  OmniMuxUpdateInstaller as NextUpdateInstaller,
} from './omnimux-updater/installer.ts'
