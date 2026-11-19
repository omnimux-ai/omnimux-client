// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import {
  WorkspaceSelector,
} from '../src/panel/components/WorkspaceSelector.tsx'
import {
  KNOWN_INSTANCE_NAMES,
} from '../src/shared/instance-discovery.ts'
import {
  ModelSelector,
  type ModelGroup,
} from '../src/panel/components/ModelSelector.tsx'

/** 指定端口在线（返回合法 wsUrl 的 bridge-config），其余端口一律拒绝。 */
function mockOnlyPortsOnline(ports: number[]) {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as Request).url)
    const port = Number(new URL(url).port)
    if (ports.includes(port)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ wsUrl: `ws://127.0.0.1:${port}/ext/bridge` }),
      } as Response
    }
    throw new Error('Failed to fetch')
  }) as unknown as typeof fetch
}

describe('WorkspaceSelector (Dynamic Instance Discovery) Suite', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('renders trigger with selected instance name and port; green dot when that port is online', async () => {
    mockOnlyPortsOnline([45120])

    await act(async () => {
      root.render(
        createElement(WorkspaceSelector, {
          bridgeConnected: false,
          locale: 'zh',
          targetPort: 45120,
        })
      )
    })
    // 等待首轮探测 settle
    await act(async () => {})

    const trigger = container.querySelector('.workspace-selector-trigger')
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent).toContain('45120')
    expect(trigger?.textContent).toContain('OmniMux Dev')
    // spec §3.1 selector.trigger 白名单：无 chevron、无独立端口胶囊
    expect(container.querySelector('.ws-chevron-arrow')).toBeNull()
    expect(container.querySelector('.ws-port-tag')).toBeNull()
    const dot = container.querySelector('.engine-dot')
    expect(dot?.classList.contains('online')).toBe(true)
  })

  it('opens dropdown listing all known ports, Dev carries 推荐 badge, offline rows are disabled', async () => {
    mockOnlyPortsOnline([45120])
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        createElement(WorkspaceSelector, {
          bridgeConnected: false,
          locale: 'zh',
          targetPort: 45120,
          onSelectWorkspace: onSelect,
        })
      )
    })
    await act(async () => {})

    const trigger = container.querySelector<HTMLButtonElement>('.workspace-selector-trigger')!
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})

    const dropdown = container.querySelector('.workspace-dropdown-menu')
    expect(dropdown).not.toBeNull()

    const items = container.querySelectorAll('.instance-item-row')
    // 仅 45120 在线 + 映射表内离线端口（44120/43120）；映射表外端口离线不渲染
    expect(items.length).toBe(1 + Object.keys(KNOWN_INSTANCE_NAMES).length - 1)
    expect(items[0].textContent).toContain('OmniMux Dev')
    expect(items[0].textContent).toContain('推荐')
    expect(items[0].textContent).toMatch(/在线 · \d+ms/)

    // 离线行禁用且点击不触发选择
    const offlineRow = Array.from(items).find((el) => el.textContent?.includes('44120'))!
    expect(offlineRow.textContent).toContain('OmniMux Prod')
    expect(offlineRow.classList.contains('disabled')).toBe(true)
    await act(async () => {
      offlineRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelect).not.toHaveBeenCalled()

    // 点击在线的 Dev 条目：写 localStorage 并回调 {id, port, name}
    await act(async () => {
      items[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalled()
    expect(onSelect.mock.calls[0][0].port).toBe(45120)
    expect(localStorage.getItem('omnimux_target_port')).toBe('45120')
  })

  it('shows empty state copy when nothing is reachable and no custom port saved', async () => {
    // 所有端口离线：已知端口仍显示为离线条目（spec：映射表内端口离线也显示）
    globalThis.fetch = vi.fn(async () => { throw new Error('Failed to fetch') }) as unknown as typeof fetch

    await act(async () => {
      root.render(
        createElement(WorkspaceSelector, {
          bridgeConnected: false,
          locale: 'zh',
          targetPort: 44120,
        })
      )
    })
    await act(async () => {})

    const trigger = container.querySelector<HTMLButtonElement>('.workspace-selector-trigger')!
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})

    const rows = container.querySelectorAll('.instance-item-row')
    // 全部离线时仅映射表内已知端口渲染离线条目
    expect(rows.length).toBe(Object.keys(KNOWN_INSTANCE_NAMES).length)
    expect(Array.from(rows).every((r) => r.classList.contains('disabled'))).toBe(true)
    expect(container.textContent).toContain('自定义端口')
  })
})

describe('ModelSelector with desktop provider groups', () => {
  const groups: ModelGroup[] = [
    { provider: 'a', group: 'First', models: [{ id: 'same', name: 'First model' }] },
    {
      provider: 'b', group: 'Second',
      models: [{ id: 'same', name: 'Second model', reasoning: {
        efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
        defaultEffort: 'low',
      } }, { id: 'unique', name: 'Unique' }],
    },
  ]
  const onSelect = vi.fn()
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    root = createRoot(container)
    onSelect.mockClear()
    localStorage.clear()
  })

  const render = (props: Partial<React.ComponentProps<typeof ModelSelector>> = {}) =>
    act(async () => { root.render(createElement(ModelSelector, {
      modelGroups: groups, selectedModel: 'same', selectedProvider: 'b', onSelectModel: onSelect, ...props,
    })) })

  it('hydrates without writing, and sends the precise provider for each model and effort edit', async () => {
    await render()
    const model = container.querySelector<HTMLSelectElement>('.model-select-control')!
    const effort = container.querySelector<HTMLSelectElement>('.effort-select-control')!
    expect(model.selectedOptions[0].textContent).toBe('Second model')
    expect(effort.value).toBe('low')
    expect(onSelect).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)

    await act(async () => {
      effort.value = 'high'
      effort.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenLastCalledWith('same', 'high', 'b')
    await act(async () => {
      model.value = model.options[0].value
      model.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenLastCalledWith('same', undefined, 'a')
    await render({ disabled: true })
    expect(model.disabled).toBe(true)
    expect(effort.disabled).toBe(true)
  })

  it('only resolves an old provider-less preference when its model id is unique', async () => {
    await render({ selectedProvider: '', selectedModel: 'unique' })
    const model = container.querySelector<HTMLSelectElement>('.model-select-control')!
    expect(model.selectedOptions[0].textContent).toBe('Unique')
    await render({ selectedProvider: '' })
    expect(model.selectedOptions[0].disabled).toBe(true)
    expect(model.selectedOptions[0].textContent).toContain('不可用')
    await render({ selectedProvider: 'missing' })
    expect(model.selectedOptions[0].disabled).toBe(true)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('clears an old text override even when the connected catalog is unavailable', async () => {
    await render({ allowEmptyOption: true, status: 'unavailable' })
    const model = container.querySelector<HTMLSelectElement>('.model-select-control')!
    expect(model.disabled).toBe(false)
    expect(model.querySelectorAll('optgroup')).toHaveLength(0)
    await act(async () => {
      model.value = ''
      model.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('')
    await render({ status: 'empty', modelGroups: [], selectedModel: '' })
    expect(model.disabled).toBe(true)
    expect(model.selectedOptions[0].textContent).toBe('暂无可用模型')
  })
})
