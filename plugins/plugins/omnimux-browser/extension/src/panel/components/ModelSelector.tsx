import { memo } from 'react'

export interface EffortOption {
  id: string
  name: string
  description?: string
}

export interface ModelItem {
  id: string
  name: string
  reasoning?: {
    efforts?: EffortOption[]
    defaultEffort?: string
  }
}

export interface ModelGroup {
  group: string
  provider: string
  models: ModelItem[]
}

/**
 * Model 支持的 effort 归一化：无 reasoning 元数据一律为空，绝不继承旧值。
 */
export function resolveEffortForModel(item: ModelItem | undefined, current: string): string {
  const efforts = item?.reasoning?.efforts ?? []
  if (efforts.length === 0) return ''
  if (current !== '' && efforts.some((effort) => effort.id === current)) return current
  const preferred = item?.reasoning?.defaultEffort
  if (typeof preferred === 'string' && efforts.some((effort) => effort.id === preferred)) return preferred
  return efforts[0]?.id ?? ''
}

/** Keep the desktop catalog's provider ids, labels and reasoning choices together. */
export function catalogToModelGroups(payload: unknown): ModelGroup[] {
  if (typeof payload !== 'object' || payload === null || !('groups' in payload) || !Array.isArray(payload.groups)) return []
  const result: ModelGroup[] = []
  for (const raw of payload.groups) {
    if (typeof raw !== 'object' || raw === null) continue
    const group = raw as { id?: unknown; name?: unknown; models?: unknown }
    if (typeof group.id !== 'string' || group.id.trim() === '' || !Array.isArray(group.models)) continue
    const models: ModelItem[] = []
    for (const rawModel of group.models) {
      if (typeof rawModel !== 'object' || rawModel === null) continue
      const model = rawModel as { id?: unknown; name?: unknown; reasoning?: ModelItem['reasoning'] }
      if (typeof model.id !== 'string' || model.id === '') continue
      models.push({
        id: model.id,
        name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
        ...(Array.isArray(model.reasoning?.efforts) ? { reasoning: model.reasoning } : {}),
      })
    }
    if (models.length > 0) {
      result.push({ group: typeof group.name === 'string' && group.name !== '' ? group.name : group.id, provider: group.id, models })
    }
  }
  return result
}

export type ModelCatalogStatus = 'loading' | 'unavailable' | 'empty'

interface ModelSelectorProps {
  locale?: 'zh' | 'en'
  modelGroups: ModelGroup[]
  selectedModel: string
  selectedProvider?: string
  selectedEffort?: string
  onSelectModel: (modelId: string, effort?: string, provider?: string) => void
  allowEmptyOption?: boolean
  disabled?: boolean
  status?: ModelCatalogStatus
}

const PLACEHOLDER = 'placeholder'

/** Both settings rows render the same desktop catalog. Only a user action changes a selection. */
export const ModelSelector = memo(function ModelSelector({
  locale = 'zh',
  modelGroups,
  selectedModel,
  selectedProvider,
  selectedEffort = '',
  onSelectModel,
  allowEmptyOption = false,
  disabled = false,
  status,
}: ModelSelectorProps) {
  const isEn = locale === 'en'
  const groups = (status === undefined ? modelGroups : []).map(group => ({
    ...group,
    routes: group.models.map(model => ({
      model,
      provider: group.provider,
      key: JSON.stringify([group.provider, model.id]),
    })),
  }))
  const routes = groups.flatMap(group => group.routes)
  // Older settings sometimes contain only a model id. It identifies a route only
  // when exactly one provider lists it.
  const matches = routes.filter(route =>
    route.model.id === selectedModel && (!selectedProvider || route.provider === selectedProvider))
  const selected = matches.length === 1 ? matches[0] : undefined
  const followsChat = allowEmptyOption && selectedModel === ''
  const showPlaceholder = selected === undefined && !followsChat
  const statusText = {
    loading: isEn ? 'Loading models…' : '正在加载模型…',
    unavailable: isEn ? 'Model catalog unavailable' : '模型目录暂不可用',
    empty: isEn ? 'No models available' : '暂无可用模型',
  }
  let placeholder = isEn ? 'Select a model' : '请选择模型'
  if (status !== undefined) placeholder = statusText[status]
  else if (selectedModel) placeholder = isEn ? `${selectedModel} (unavailable)` : `${selectedModel}（不可用）`

  const onChangeModel = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (allowEmptyOption && event.target.value === '') {
      onSelectModel('')
      return
    }
    const route = routes.find(route => route.key === event.target.value)
    if (route) onSelectModel(route.model.id, resolveEffortForModel(route.model, selectedEffort) || undefined, route.provider)
  }

  return (
    <div className="model-selector-container">
      <div className="model-selector-row">
        <div className="model-selector-main">
          <select
            className="model-select-control"
            aria-label={allowEmptyOption ? (isEn ? 'Text Generation Model' : '文本生成模型') : (isEn ? 'Chat Model' : '对话模型')}
            value={selected?.key ?? (followsChat ? '' : PLACEHOLDER)}
            onChange={onChangeModel}
            disabled={disabled || (routes.length === 0 && !(allowEmptyOption && selectedModel !== ''))}
          >
            {(showPlaceholder || (followsChat && status !== undefined)) && (
              <option value={PLACEHOLDER} disabled>{placeholder}</option>
            )}
            {allowEmptyOption && <option value="">{isEn ? 'Follow Chat Model' : '跟随对话模型'}</option>}
            {groups.map(group => (
              <optgroup key={group.provider} label={group.group}>
                {group.routes.map(route => (
                  <option key={route.key} value={route.key}>{route.model.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {selected && (selected.model.reasoning?.efforts?.length ?? 0) > 0 && (
          <div className="reasoning-effort-container">
            <select
              className="effort-select-control"
              disabled={disabled}
              value={resolveEffortForModel(selected.model, selectedEffort)}
              onChange={event => onSelectModel(selected.model.id, event.target.value, selected.provider)}
              aria-label={isEn ? 'Reasoning effort' : '推理等级'}
              title={isEn ? 'Reasoning effort' : '推理等级'}
            >
              {selected.model.reasoning?.efforts?.map(effort => (
                <option key={effort.id} value={effort.id}>{effort.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  )
})
