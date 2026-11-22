import { zhWelcome } from './zh/welcome.js'
import { zhChrome } from './zh/chrome.js'
import { zhTimeline } from './zh/timeline.js'
import { zhPreview } from './zh/preview.js'
import { zhInspector } from './zh/inspector.js'
import { zhEditorChrome } from './zh/editorChrome.js'
import { zhMotion } from './zh/motion.js'
import { zhV1Workspace } from './zh/v1Workspace.js'
import { zhV1Media } from './zh/v1Media.js'
import { zhV1Inspector } from './zh/v1Inspector.js'
import { zhV1Editing } from './zh/v1Editing.js'
import { zhV1Effects } from './zh/v1Effects.js'
import { zhAssetBridge } from './zh/assetBridge.js'

/**
 * zh dictionary, keyed by English source literal.
 * Split by surface so each area can be extended independently.
 */
export const zh = {
  ...zhWelcome,
  ...zhChrome,
  ...zhTimeline,
  ...zhPreview,
  ...zhInspector,
  ...zhEditorChrome,
  ...zhMotion,
  ...zhV1Workspace,
  ...zhV1Media,
  ...zhV1Inspector,
  ...zhV1Editing,
  ...zhV1Effects,
  ...zhAssetBridge,
}
