/**
 * 目录里既没有 `provider` 也没有 `id` 的组，按已知组名映射。
 */
export const MODEL_PROVIDER_BY_GROUP_NAME: Record<string, string> = {
  'ChatGPT (Codex)': 'chatgpt',
  'Grok (Subscription)': 'grok',
  'OmniMux': 'omnimux',
}

/**
 * 解析一个目录分组的 provider。
 *
 * @param group 宿主目录分组。
 * @returns 解析出的 provider，解析不到时为 `undefined`（调用方必须显式报错，不能发空 provider）。
 */
export function providerFromCatalogGroup(group: unknown): string | undefined {
  if (typeof group !== 'object' || group === null) return undefined
  const record = group as { provider?: unknown; id?: unknown; group?: unknown; name?: unknown }
  if (typeof record.provider === 'string' && record.provider.trim() !== '') return record.provider.trim()
  if (typeof record.id === 'string' && record.id.trim() !== '') return record.id.trim()
  const label = typeof record.group === 'string' && record.group !== ''
    ? record.group
    : typeof record.name === 'string' && record.name !== ''
      ? record.name
      : ''
  return Object.hasOwn(MODEL_PROVIDER_BY_GROUP_NAME, label) ? MODEL_PROVIDER_BY_GROUP_NAME[label] : undefined
}

/**
 * 按 model id 在实时目录里回查 provider。
 *
 * @param catalog `session.modelCatalog` 的载荷（`{ groups: [...] }`）。
 * @param modelId 用户选中的文本生成模型 id。
 * @returns 唯一提供方；模型缺失或可由多个提供方运行时返回 `undefined`。
 */
export function providerForModelId(catalog: unknown, modelId: string): string | undefined {
  if (typeof catalog !== 'object' || catalog === null) return undefined
  const groups = (catalog as { groups?: unknown }).groups
  if (!Array.isArray(groups)) return undefined
  let match: string | undefined
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue
    const models = (group as { models?: unknown }).models
    if (!Array.isArray(models)) continue
    const found = models.some((model) => (
      typeof model === 'object' && model !== null && (model as { id?: unknown }).id === modelId
    ))
    if (!found) continue
    const provider = providerFromCatalogGroup(group)
    if (!provider || (match !== undefined && provider !== match)) return undefined
    match = provider
  }
  return match
}
