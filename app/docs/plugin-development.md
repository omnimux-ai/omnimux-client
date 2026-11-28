# DSH Desktop 插件开发

> **当前接口与 Draft 请勿混淆：** 本文介绍现在可用的 DSH/Cordis 与 Desktop service。`dsh-community-fabric` 中的 manifest、capability 和统一事件模型仍处于[社区 RFC Draft](../dsh-community-fabric/README.zh.md)，尚不能作为依赖或发布目标。

## 先理解两层插件

一个普通 DSH 插件可以提供 Host service、命令、路由、bundle 或 Web Client。它应该尽量只依赖官方 DSH contract，因此可以在命令行、普通 Web profile 和 DSH Desktop 中复用。

Desktop 另外提供两个公开的 Host service：

- `desktopProfiles`：读取当前已解析好的 profile（`current: { name, dir }`）。
- `desktopPnpm`：在当前 profile 中通过 `run()` 执行打包 pnpm，或通过 `runPlugin()` 按官方 `dsh plugin` 语义管理插件。

它们属于 Electron main 进程中的 Host Cordis generation，由 `dsh-desktop-next` 在运行时注入。Renderer 不能直接读取它们；有浏览器界面的插件仍应使用普通 DSH Web routes、RPC、client metadata、service 和 slot。

完整边界与生命周期语义见 [`dsh-desktop-next/docs/plugin-services.md`](../dsh-desktop-next/docs/plugin-services.md)。下面只给出选择方式和最小原则。

## Desktop 专用插件

如果插件只应该在 Desktop 中运行，可以把服务声明为 required injection，并在本地使用结构化 TypeScript 类型：

```ts
import type { Context } from '@deepseek-ai/cordis'

interface DesktopProfiles {
  readonly current: { readonly name: string; readonly dir: string }
}

interface DesktopPnpmHandle {
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>
  cancel(): void
}

interface DesktopPnpm {
  run(argv: readonly string[], signal?: AbortSignal): DesktopPnpmHandle
  runPlugin(argv: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle
}

type DesktopContext = Context & {
  desktopProfiles: DesktopProfiles
  desktopPnpm: DesktopPnpm
}

export const name = 'example-desktop-plugin'
export const inject = ['desktopProfiles', 'desktopPnpm']

export function apply(ctx: DesktopContext): void {
  ctx.logger.info(`profile: ${ctx.desktopProfiles.current.name}`)
  let active: DesktopPnpmHandle | undefined

  // 将这个函数连接到插件界面的明确用户操作。
  async function installExample(packageSpec: string): Promise<void> {
    active = ctx.desktopPnpm.run(['add', '--save-exact', packageSpec])
    active.stdout.resume()
    active.stderr.resume()
    await active.done
  }

  ctx.effect(() => {
    return async () => {
      active?.cancel()
      await active?.done.catch(() => {})
    }
  }, 'example plugin operation')
}
```

实际项目应该把 package operation 放在明确的用户动作中，校验目标来源，读取 stdout/stderr，设置自己的 timeout，并同时检查 `exitCode` 和 `signal`。一个 generation 同时只允许一个 `desktopPnpm` package operation；插件卸载时必须取消并等待它结束。

## 兼容 Desktop 和普通 DSH

如果同一个插件也要在普通 `dsh web` 中运行，不要把 Desktop service 放进顶层 required `inject`。先用 `ctx.get('desktopProfiles')` 判断是否处于 Desktop，再把两个 Desktop service 一起放进同一个嵌套 injection，让 adapter 会随着任一 service 的 generation 一起卸载：

```ts
export const inject = ['webServer', 'loader']

export function apply(ctx: Context, config: { profile?: string }): void {
  if (ctx.get('desktopProfiles') === undefined) {
    mountOrdinaryDshManager(ctx, config.profile ?? 'web')
    return
  }

  ctx.inject(['desktopProfiles', 'desktopPnpm'], (desktopCtx) => {
    desktopCtx.effect(() => mountManager(desktopCtx, {
      profile: desktopCtx.desktopProfiles.current.name,
      profileDir: desktopCtx.desktopProfiles.current.dir,
      runPlugin: (args, cwd, signal) =>
        desktopCtx.desktopPnpm.runPlugin(args, cwd, signal),
    }), 'example: Desktop plugin manager')
  })
}
```

普通 DSH 的 fallback 仍然是插件自己的权威实现。不要从 `process.argv`、`ctx.baseUrl`、settings 或 `$DSH_HOME` 推断 Desktop profile；在 Desktop 中以 `desktopProfiles.current` 为准。

## 外部开发沙箱

外部开发沙箱是构建在 Desktop 旁边的普通 `dsh web` 镜像，不是第二个 Electron 应用。当前公开 service 已足够支撑一条生命周期安全的集成路径：

```ts
import type { Context } from '@deepseek-ai/cordis'

interface DesktopProfiles {
  readonly current: { readonly name: string; readonly dir: string }
}

interface DesktopPnpmHandle {
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>
  cancel(): void
}

interface DesktopPnpm {
  run(argv: readonly string[], signal?: AbortSignal): DesktopPnpmHandle
}

type DesktopContext = Context & {
  desktopProfiles?: DesktopProfiles
  desktopPnpm: DesktopPnpm
}

declare function prepareSandboxProfile(options: {
  readonly sourceProfileDir: string
  readonly sandboxRoot: string
  readonly pluginDir: string
}): Promise<void>
declare function launchExternalWebMirror(sandboxRoot: string): Promise<void>
declare function removeSandbox(sandboxRoot: string): Promise<void>

export function apply(ctx: Context): void {
  if (ctx.get('desktopProfiles') === undefined) return

  ctx.inject(['desktopProfiles', 'desktopPnpm'], (desktopCtx) => {
    desktopCtx.effect(() => {
      let build: DesktopPnpmHandle | undefined

      async function buildAndLaunch(pluginDir: string, sandboxRoot: string): Promise<void> {
        const sourceProfileDir = desktopCtx.desktopProfiles.current.dir
        await prepareSandboxProfile({ sourceProfileDir, sandboxRoot, pluginDir })

        const deadline = AbortSignal.timeout(5 * 60_000)
        const operation = desktopCtx.desktopPnpm.run(
          ['--dir', pluginDir, 'run', 'build'],
          deadline,
        )
        build = operation
        operation.stdout.resume()
        operation.stderr.resume()

        try {
          const outcome = await operation.done
          if (outcome.exitCode !== 0 || outcome.signal !== null) {
            await removeSandbox(sandboxRoot)
            throw new Error(
              `sandbox build failed: exit=${String(outcome.exitCode)} signal=${String(outcome.signal)}`,
            )
          }
        } catch (error) {
          await removeSandbox(sandboxRoot)
          throw error
        } finally {
          if (build === operation) build = undefined
        }

        await launchExternalWebMirror(sandboxRoot)
      }

      return async () => {
        const operation = build
        operation?.cancel()
        await operation?.done.catch(() => {})
      }
    }, 'example: external development sandbox')
  })
}
```

这条模式里要注意：

- 把 `desktopProfiles.current.dir` 当作当前 Host generation 的只读 `host-web` 镜像来源；不要修改它、跨重启缓存它，也不要猜测成 `profiles/web`。
- 本地 checkout 的构建应使用 `desktopPnpm.run(['--dir', pluginDir, 'run', 'build'], signal)`，这样 Desktop 的打包 pnpm、Node ABI 与 subprocess ownership 才会继续保持权威，而且不会改动激活 profile。
- 必须持续读取两个输出流，自己设置 deadline，并保留返回 handle，这样 dispose 时才能调用 `cancel()`，随后继续等待 `done`。
- 只要 `done` rejection、`exitCode` 非零，或 `signal` 非空，就应删除临时沙箱并停止，而不是继续启动镜像。
- 镜像启动器本身按设计属于外部组件；公开 Desktop contract 不会提供第二套 Electron bootstrap surface。

## `run()` 与 `runPlugin()` 的区别

`desktopPnpm.run(argv, signal?)` 是低层 pnpm operation，cwd 是当前 profile。当你需要像 `['--dir', pluginDir, 'run', 'build']` 这样的生命周期自管本地工作，并且希望继承 Desktop 打包的 pnpm 与 Node surface、又不修改激活 profile 时，它是合适的选择。它不保证 DSH 的 profile 初始化、调用方相对 `file:`/`link:` source 锚定或 `dsh.profile.bundles` reconcile。

`desktopPnpm.runPlugin(argv, invokingDir, signal?)` 执行打包的 `dsh plugin --profile <active>`，在绝对目录中保留上游 `dsh.profile.bundles` reconcile 语义。

```ts
desktopPnpm.run(['add', '--save-exact', packageSpec], signal)
desktopPnpm.runPlugin(['remove', packageName], invokingDir, signal)
desktopPnpm.runPlugin(['update'], invokingDir, signal)
```

参数始终作为 argv 传递；不要拼接 shell 字符串，也不要依赖 Windows `.cmd` shim。服务会在完整子进程树退出后 settle，并在 generation dispose 时终止仍在运行的 operation。

## 不要依赖的接口

`desktopRuntime`、`desktopPnpmBootstrap`、`desktopPermissions`、`desktopActions`、Electron `BrowserWindow`、托盘注册表、private Node helper、`ELECTRON_RUN_AS_NODE` 和生成的 shim 都是 Desktop 内部实现。即使它们出现在运行时上下文中，也不属于第三方兼容 contract。

## 最小双面 Cordis 插件示例（UI 与 Agent 工具同源）

OmniMux 插件遵循双面交付铁律：面向用户的 **UI 交互面**（`dsh-ui-kit`）与面向智能体的 **Agent 工具面**（`ctx.tools`）必须调用**同一个领域 Store/Service**，且涉及删除或覆写的破坏性操作必须带 `confirm: true` 守卫。开发前请先核对 [`plugins/packages/dsh-ui-kit/README.md`](../../plugins/packages/dsh-ui-kit/README.md)、[`plugins/docs/contracts/plugin-agent-tools-inventory.md`](../../plugins/docs/contracts/plugin-agent-tools-inventory.md)、[`plugins/docs/contracts/plugin-security-boundaries.md`](../../plugins/docs/contracts/plugin-security-boundaries.md) 与 [`CONTRIBUTING.md`](../../CONTRIBUTING.md)。

### 1. 包清单与 Cordis Patch（`package.json` + `cordis.patch.yml`）

```json
{
  "name": "omnimux-notes",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js",
  "exports": {
    ".": "./src/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-primitives"
      ],
      "platform": "web"
    }
  },
  "dependencies": {
    "dsh-ui-kit": "^0.1.0"
  },
  "peerDependencies": {
    "@deepseek-ai/dsh-client-ui-primitives": ">=0.2.2-rc.5 <0.3.0-0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}
```

```yaml
- insert:
    - id: omnimux-notes
      name: omnimux-notes
```

### 2. 带删除确认守卫的共享 Store（`src/store.js`）

```js
export function createNotesStore() {
  const items = new Map()
  return {
    list() {
      return [...items.values()]
    },
    create(args = {}) {
      const { id, title } = args ?? {}
      const entry = { id: String(id ?? ''), title: String(title ?? '').trim() }
      items.set(entry.id, entry)
      return { ok: true, item: entry }
    },
    remove(args = {}) {
      const { id, confirm } = args ?? {}
      if (confirm !== true) {
        return {
          ok: false,
          error: 'confirmation-required',
          message: '请显式传入 confirm: true 后再执行删除。',
        }
      }
      const deleted = items.delete(String(id ?? ''))
      return { ok: true, deleted }
    },
  }
}
```

### 3. 宿主入口挂载 `webServer.register` 与 `ctx.tools`（`src/index.js`）

根级只声明 `inject = ['tools']` 并按需注入 `webServer`，使无 HTTP 的 headless 会话也能正常装载工具；同时每个工具都须声明 `output: { schema, render }` 与 `additionalProperties: false`：

```js
import { createNotesStore } from './store.js'

export const name = 'omnimux-notes'
export const inject = ['tools']

const jsonOut = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

export function apply(ctx) {
  const store = createNotesStore()

  // 人类交互 UI 路由通过 webServer.register 挂载；生产路由还应在 peer 缺席时校验 connection.requestRejection(req)
  ctx.inject(['webServer'], (inner) => {
    inner.effect(() => inner.webServer.register({
      kind: 'prefix',
      path: '/omnimux/notes',
      auth: 'required',
      async handler(req, res) {
        const send = (status, body) => {
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (req.method === 'GET') return send(200, { items: store.list() })
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
        if (req.method === 'DELETE') {
          const out = store.remove(body)
          return send(out.ok ? 200 : 400, out)
        }
        return send(200, store.create(body))
      },
    }), 'omnimux-notes: routes')
  })

  // Agent 工具面复用同一 Store、Schema 契约与 confirm 守卫
  ctx.tools.register({
    name: 'notes_create',
    description: '在共享 Store 中创建条目。',
    parameters: {
      type: 'object',
      required: ['id', 'title'],
      additionalProperties: false,
      properties: { id: { type: 'string' }, title: { type: 'string' } },
    },
    output: jsonOut,
    execute: async (args) => store.create(args),
  })

  ctx.tools.register({
    name: 'notes_delete',
    description: '删除条目（破坏性操作，必须传 confirm: true）。',
    parameters: {
      type: 'object',
      required: ['id', 'confirm'],
      additionalProperties: false,
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
    },
    output: jsonOut,
    execute: async (args) => store.remove(args),
  })
}
```

### 4. 客户端入口与视图消费 `dsh-ui-kit` 和语义 Token（`src/client/`）

```jsx
// src/client/Panel.jsx
import { Button, PageHeader } from 'dsh-ui-kit'

export function NotesPanel({ items, onCreate }) {
  return (
    <section style={{ background: 'var(--dsw-alias-bg-layer-1)' }}>
      <PageHeader
        title="Notes"
        subtitle="与 Agent 工具共享同一本地数据源"
        actions={<Button variant="primary" onClick={onCreate}>新建条目</Button>}
      />
      <p style={{ color: 'var(--dsw-alias-label-secondary)' }}>
        当前条目数：{items.length}
      </p>
    </section>
  )
}
```

```js
// src/client/index.js（构建至 lib/client.js 供 "./client" 导出消费）
import { createElement } from 'react'
import { NotesPanel } from './Panel.jsx'

export const name = 'omnimux-notes'

export function apply(ctx) {
  ctx.inject(['betterSidebar'], (inner) => {
    const sidebar = inner.betterSidebar ?? inner.get?.('betterSidebar')
    if (!sidebar || typeof sidebar.registerTab !== 'function') return
    inner.effect(() => sidebar.registerTab({
      id: 'omnimux-notes:main',
      title: () => 'Notes',
      order: 20,
      single: true,
      component: (props) => createElement(NotesPanel, { ...props, items: [] }),
    }), 'omnimux-notes: tab')
  })
}
```

本仓产品插件在新增或变更工具时，还须同步更新插件的 `dsh.manifest.json`（`capabilities.tools` 与客户端 Slot）以及 [`plugins/docs/contracts/plugin-agent-tools-inventory.md`](../../plugins/docs/contracts/plugin-agent-tools-inventory.md)。

## 测试与发布检查

插件至少应覆盖：

- 在普通 DSH 中没有 Desktop service 时仍能加载，或按产品定义保持 pending。
- Desktop 中读取的 profile name/dir 与用户实际选择一致。
- package operation 的取消、非零退出、spawn failure 和 generation teardown。
- 插件变更后重新启动，bundle 能进入下一次 Loader 组合。

开发者可以先阅读 [架构说明](architecture.md)，再使用包级 [service contract](../dsh-desktop-next/docs/plugin-services.md)。

## 生态愿景：保持插件生态可组合

DSH 的插件生态正在快速增长。插件越多，它们能否协同工作就越重要——如果每个插件都假设或覆盖其他插件的内部实现，装几个插件就会开始冲突，生态会逐渐碎片化。

我们倡导像浏览器插件一样的开发方式：大家在同一个平台上、按同一套约定扩展，而不是各自维护一份改过的运行时。DSH Desktop 是这套方式的第一个实践者——桌面壳本身就是一个普通插件，与官方、第三方插件走同一条组合路径，没有任何特权。

为此我们发起一项开发规范倡议，希望它通过社区的采纳成为事实标准：

- **组合优先**：通过官方 slot、service 和 patch 组合能力，不要假设或覆盖其他插件的内部实现。
- **声明清晰**：明确声明依赖的 service 和 slot，不依赖运行时巧合。
- **兼容优先**：升级保持向后兼容，不破坏已有组合。

倡议是活文档，随生态实践更新，接受社区讨论和修订。插件市场上线后，遵循共同约定的插件将更容易被发现、安装和判断兼容性，让"按规范开发"成为对每个作者都有利的选择。完整愿景见 [DSH 插件生态倡议书](plugin-ecosystem.md)；未来互操作 contract 的讨论见 [DSH Community Fabric](../dsh-community-fabric/README.zh.md)。
