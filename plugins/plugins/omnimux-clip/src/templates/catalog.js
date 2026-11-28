import {
  GRAPHIC_LIMITS,
  TEXT_ANIMATION_PRESETS,
  getBuiltInEditingTemplate,
  getBuiltInEditingTemplates,
  getBuiltInGraphicTemplate,
  getBuiltInGraphicTemplates,
  protectedDurations,
  validateGraphicTemplate,
} from '../../lib/openreel-templates.js'
import { ClipDomainError } from '../errors.js'
import { isReferenceId, safeText } from '../timeline/nativeProjectFields.js'

const TEMPLATE_KINDS = new Set(['all', 'graphic', 'editing', 'text_animation'])
const MAX_ASSET_TEMPLATE_SCAN = 100

function projectGraphicSummary(template, extra = {}) {
  const { minDuration } = protectedDurations(template)
  return {
    id: template.id,
    source: extra.source ?? 'builtin',
    ...(extra.libraryAssetId ? { libraryAssetId: extra.libraryAssetId } : {}),
    ...(extra.fileId ? { fileId: extra.fileId } : {}),
    name: template.name,
    category: template.category,
    description: template.description,
    tags: [...(template.tags ?? [])],
    durationSec: template.duration,
    minDurationSec: minDuration,
    responsivePin: Array.isArray(template.layers) && template.layers.some((layer) => Boolean(layer.pin)),
    parameters: (template.parameters ?? []).map((param) => ({
      id: param.id,
      label: param.label,
      type: param.type,
      defaultValue: param.defaultValue,
      ...(param.min !== undefined ? { min: param.min } : {}),
      ...(param.max !== undefined ? { max: param.max } : {}),
      ...(param.step !== undefined ? { step: param.step } : {}),
      ...(param.options !== undefined ? { options: [...param.options] } : {}),
    })),
  }
}

function projectEditingSummary(template) {
  return {
    id: template.id,
    source: 'builtin',
    name: template.name,
    category: template.category,
    description: template.description,
    tags: [...(template.tags ?? [])],
    supportedTargets: [...(template.supportedTargets ?? ['video', 'image'])],
    controls: (template.controls ?? []).map((control) => ({
      id: control.id,
      label: control.label,
      type: control.type,
      defaultValue: control.defaultValue,
      ...(control.min !== undefined ? { min: control.min } : {}),
      ...(control.max !== undefined ? { max: control.max } : {}),
      ...(control.step !== undefined ? { step: control.step } : {}),
      ...(control.options !== undefined ? { options: [...control.options] } : {}),
    })),
  }
}

function mapAssetReadError(error, assetId) {
  const code = error?.code
  if (code === 'path-denied') {
    return ClipDomainError.pathDenied('Access to the asset library template file was denied.')
  }
  if (code === 'asset-not-found' || code === 'path-not-found') {
    return new ClipDomainError('template-not-found', `Custom template asset not found: ${assetId}`)
  }
  if (code === 'file-too-large' || code === 'file-not-text' || code === 'path-not-file' || code === 'path-unsupported') {
    return new ClipDomainError('template-invalid', error.message || 'Custom template file is invalid.')
  }
  return error
}

function isJsonFile(file) {
  const name = typeof file?.original_name === 'string'
    ? file.original_name
    : (typeof file?.name === 'string' ? file.name : '')
  return file && !file.isDirectory && file.kind !== 'directory' && /\.json$/iu.test(name)
}

async function scanAssetLibraryTemplates(getAssetLibrary) {
  const assetLibrary = getAssetLibrary?.()
  if (!assetLibrary || typeof assetLibrary.listAssets !== 'function' || typeof assetLibrary.readTextFile !== 'function') {
    return []
  }
  const results = []
  let scanned = 0
  const candidates = []
  for (const type of ['style', 'custom']) {
    const rows = assetLibrary.listAssets({ type })
    if (Array.isArray(rows)) candidates.push(...rows)
  }
  const seenAssets = new Set()
  for (const asset of candidates) {
    if (!asset?.id || seenAssets.has(asset.id)) continue
    seenAssets.add(asset.id)
    for (const file of asset.files ?? []) {
      if (scanned >= MAX_ASSET_TEMPLATE_SCAN) return results
      if (!isJsonFile(file) || !file.id) continue
      if (Number.isFinite(file.size) && file.size > GRAPHIC_LIMITS.maxFileBytes) continue
      scanned += 1
      try {
        const loaded = await assetLibrary.readTextFile(asset.id, file.id)
        if (typeof loaded?.content !== 'string') continue
        const parsed = JSON.parse(loaded.content)
        const checked = validateGraphicTemplate(parsed)
        if (!checked.ok) continue
        results.push(projectGraphicSummary(checked.template, {
          source: 'asset-library',
          libraryAssetId: asset.id,
          fileId: file.id,
        }))
      } catch (error) {
        // Non-template or unreadable JSON in general assets is skipped during discovery.
        console.debug?.('[omnimux-clip/templates] skipping unreadable asset JSON:', asset.id, file.id, error?.code || error?.name || 'unreadable')
      }
    }
  }
  return results
}

export async function listClipTemplates(args = {}, deps = {}) {
  const kind = args.kind ?? 'all'
  if (typeof kind !== 'string' || !TEMPLATE_KINDS.has(kind)) {
    throw ClipDomainError.invalidJson('kind must be one of all, graphic, editing, or text_animation.')
  }
  const category = args.category === undefined ? undefined : safeText(args.category, 64)
  if (args.category !== undefined && !category) {
    throw ClipDomainError.invalidJson('category must be a non-empty string.')
  }
  const templateId = args.templateId === undefined ? undefined : args.templateId
  if (templateId !== undefined && !isReferenceId(templateId)) {
    throw ClipDomainError.invalidJson('templateId must be a valid template identifier.')
  }
  if (args.includeAssetLibrary !== undefined && typeof args.includeAssetLibrary !== 'boolean') {
    throw ClipDomainError.invalidJson('includeAssetLibrary must be a boolean.')
  }
  const includeAssetLibrary = args.includeAssetLibrary === true

  const wantGraphic = kind === 'all' || kind === 'graphic'
  const wantEditing = kind === 'all' || kind === 'editing'
  const wantTextAnim = kind === 'all' || kind === 'text_animation'

  let graphicTemplates = wantGraphic
    ? getBuiltInGraphicTemplates().map((tpl) => projectGraphicSummary(tpl))
    : []
  if (wantGraphic && includeAssetLibrary) {
    graphicTemplates = [...graphicTemplates, ...(await scanAssetLibraryTemplates(deps.getAssetLibrary))]
  }

  let editingTemplates = wantEditing
    ? getBuiltInEditingTemplates().map((tpl) => projectEditingSummary(tpl))
    : []

  if (category) {
    graphicTemplates = graphicTemplates.filter((item) => item.category === category)
    editingTemplates = editingTemplates.filter((item) => item.category === category)
  }

  if (templateId) {
    graphicTemplates = graphicTemplates.filter((item) => item.id === templateId)
    editingTemplates = editingTemplates.filter((item) => item.id === templateId)
    if (graphicTemplates.length === 0 && editingTemplates.length === 0) {
      throw new ClipDomainError('template-not-found', `Template not found: ${templateId}`)
    }
  }

  const textAnimationPresets = wantTextAnim
    ? TEXT_ANIMATION_PRESETS.map((preset) => preset.id)
    : []

  return {
    graphicTemplates,
    editingTemplates,
    textAnimationPresets,
  }
}

export async function resolveCustomGraphicTemplate({ libraryAssetId, fileId }, { getAssetLibrary } = {}) {
  if (!isReferenceId(libraryAssetId)) {
    throw ClipDomainError.invalidJson('libraryAssetId must be a valid asset ID.')
  }
  if (fileId !== undefined && !isReferenceId(fileId)) {
    throw ClipDomainError.invalidJson('fileId must be a valid file ID.')
  }
  const assetLibrary = getAssetLibrary?.()
  if (!assetLibrary || typeof assetLibrary.getAsset !== 'function' || typeof assetLibrary.readTextFile !== 'function') {
    throw new ClipDomainError('media-resolver-unavailable', 'Asset library service is unavailable.')
  }
  const asset = assetLibrary.getAsset(libraryAssetId)
  if (!asset) {
    throw new ClipDomainError('template-not-found', `Library asset not found: ${libraryAssetId}`)
  }
  const files = Array.isArray(asset.files) ? asset.files : []
  let targetFile
  if (fileId !== undefined) {
    targetFile = files.find((file) => file.id === fileId)
    if (!targetFile) {
      throw new ClipDomainError('template-not-found', `Template file ${fileId} not found in asset ${libraryAssetId}.`)
    }
    if (!isJsonFile(targetFile)) {
      throw new ClipDomainError('template-invalid', 'Custom graphic template file must be a .json file.')
    }
  } else {
    targetFile = files.find(isJsonFile)
    if (!targetFile) {
      throw new ClipDomainError('template-invalid', `Library asset ${libraryAssetId} has no .json graphic template file.`)
    }
  }
  if (Number.isFinite(targetFile.size) && targetFile.size > GRAPHIC_LIMITS.maxFileBytes) {
    throw new ClipDomainError('template-invalid', 'Custom graphic template exceeds maximum file size.')
  }

  let loaded
  try {
    loaded = await assetLibrary.readTextFile(asset.id, targetFile.id)
  } catch (error) {
    throw mapAssetReadError(error, libraryAssetId)
  }
  if (typeof loaded?.content !== 'string') {
    throw new ClipDomainError('template-invalid', 'Custom graphic template content is empty.')
  }

  let parsed
  try {
    parsed = JSON.parse(loaded.content)
  } catch {
    throw new ClipDomainError('template-invalid', 'Custom graphic template is not valid JSON.')
  }
  const checked = validateGraphicTemplate(parsed)
  if (!checked.ok) {
    throw new ClipDomainError('template-invalid', checked.errors[0] || 'Custom graphic template failed validation.')
  }
  return {
    template: checked.template,
    libraryAssetId: asset.id,
    fileId: targetFile.id,
  }
}

export { getBuiltInEditingTemplate, getBuiltInGraphicTemplate }
