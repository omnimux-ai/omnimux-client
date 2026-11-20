/**
 * Operation 展示名解析（Issue #4103）。
 *
 * 网关视频契约声明的 modeKind 决定模式文案。旧契约的 operation 文案
 * 来自型号 YAML 的 label 或 operation-registry 的中文名。
 *
 * 都没有 → `undefined`：契约层绝不拿 operation id 冒充 label。展示层
 * （`plugins/omnimux-workflow/src/shared/validation/operationLabels.ts`）再按
 * 「目录 → id」兜底，于是英文 id 不会流到用户界面。
 */

import { loadOperationRegistry } from './schemas/commonSchema.js'

/** @typedef {{ label: string, labelEn?: string }} OperationLabels */

/** @type {Map<string, OperationLabels>|undefined} */
let cachedLabels

function readLabels(operation) {
  const label = typeof operation?.label === 'string' ? operation.label.trim() : ''
  if (!label) return undefined
  const labelEn = typeof operation.labelEn === 'string' ? operation.labelEn.trim() : ''
  return labelEn ? { label, labelEn } : { label }
}

/** @returns {Map<string, OperationLabels>} */
function labelMapFor(loader) {
  if (cachedLabels) return cachedLabels
  // Issue #4113（F3）：读取失败时**不缓存空表**——否则同进程内即使 registry 之后恢复，
  // 也永远解析不出 label。失败即返回空表，下一次调用重试。
  const labels = new Map()
  try {
    const registry = loader()
    for (const op of Array.isArray(registry?.operations) ? registry.operations : []) {
      const names = readLabels(op)
      if (typeof op?.id === 'string' && names) labels.set(op.id, names)
    }
  } catch {
    // No readable registry → every operation stays unnamed rather than faked; retry next call.
    return labels
  }
  cachedLabels = labels
  return cachedLabels
}

/**
 * 已审校的 operation 中文名。
 * @param {string} id operation id
 * @param {object} [registry] 已加载的 registry 文档（调用方已有就传，省一次读盘）
 * @param {() => object} [loader] 读盘函数（测试注入用；默认 loadOperationRegistry）
 * @returns {string|undefined}
 */
export function approvedOperationLabel(id, registry, loader = loadOperationRegistry) {
  if (typeof id !== 'string' || !id) return undefined
  if (registry && Array.isArray(registry.operations)) {
    return readLabels(registry.operations.find((candidate) => candidate?.id === id))?.label
  }
  return labelMapFor(loader).get(id)?.label
}

/** Localize a gateway-declared video mode. Unknown modes keep the operation's fallback label. */
export function approvedVideoModeLabels(operationId, modeKind) {
  if (operationId === 'video_multi_ref' && modeKind === 'image_reference') {
    return { label: '图片参考', labelEn: 'Image reference' }
  }
  if (modeKind === operationId || (operationId === 'video_multi_ref' && modeKind === 'multimodal_reference')) {
    return labelMapFor(loadOperationRegistry).get(operationId)
  }
  return undefined
}
