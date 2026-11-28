# DSH Desktop Plugin Development

> **Do not confuse current APIs with a Draft:** this guide describes working DSH/Cordis and Desktop services. The manifest, capability, and unified event model in `dsh-community-fabric` remains a [community RFC Draft](../dsh-community-fabric/README.md) and cannot yet be used as a dependency or release target.

## Understand the two plugin layers

A normal DSH plugin can provide Host services, commands, routes, bundles, or a Web Client. It should depend on upstream DSH contracts whenever possible so the same package can work in the CLI, an ordinary Web profile, and DSH Desktop.

Desktop adds two public Host services:

- `desktopProfiles`: exposes the resolved active profile (`current: { name, dir }`).
- `desktopPnpm`: runs packaged pnpm in the active profile via `run()`, or runs packaged `dsh plugin` via `runPlugin()`.

These services live in the Host Cordis generation in Electron's main process and are provided by `dsh-desktop-next`. The renderer cannot read them directly; a plugin with browser UI should continue to use ordinary DSH Web routes, RPC, client metadata, services, and slots.

The complete boundaries, lifecycle, and failure semantics are in [`dsh-desktop-next/docs/plugin-services.md`](../dsh-desktop-next/docs/plugin-services.md). This page focuses on selection and the minimum safe patterns.

## Desktop-only plugins

If a plugin only makes sense in Desktop, declare the services as required injections and define structural TypeScript interfaces locally:

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

  // Connect this function to an explicit user action in the plugin UI.
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

Production code should invoke package operations from an explicit user action, validate the target, read stdout/stderr, set its own timeout, and check both `exitCode` and `signal`. A generation allows only one `desktopPnpm` package operation at a time; dispose must cancel and await it.

## Plugins that work in Desktop and ordinary DSH

When the same package must also run under ordinary `dsh web`, do not put Desktop services in the top-level required `inject` list. Detect Desktop from `ctx.get('desktopProfiles')`, then keep both Desktop services together in one nested Desktop injection so the adapter unloads with either service generation:

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

The ordinary DSH fallback remains the plugin's authoritative implementation. Do not infer the Desktop profile from `process.argv`, `ctx.baseUrl`, settings, or `$DSH_HOME`; in Desktop, use `desktopProfiles.current`.

## External development sandboxes

An external development sandbox is an ordinary `dsh web` mirror built beside Desktop, not a second Electron application. The current public services are enough for a lifecycle-safe recipe:

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

For this pattern:

- Treat `desktopProfiles.current.dir` as the read-only `host-web` mirror source for one Host generation. Do not mutate it, cache it across restarts, or guess `profiles/web`.
- Use `desktopPnpm.run(['--dir', pluginDir, 'run', 'build'], signal)` for the local checkout build so Desktop's packaged pnpm, Node ABI, and subprocess ownership remain authoritative without mutating the active profile.
- Drain both streams, apply your own deadline, and keep the returned handle so disposal can call `cancel()` and still await `done`.
- If `done` rejects, `exitCode` is nonzero, or `signal` is non-null, remove the temporary sandbox and stop there instead of launching the mirror.
- The mirror launcher is external by design. The public Desktop contract does not expose a second Electron bootstrap surface.

## `run()` and `runPlugin()`

`desktopPnpm.run(argv, signal?)` is a low-level pnpm operation with the active profile as its cwd. It is appropriate for lifecycle-owned local work such as `['--dir', pluginDir, 'run', 'build']` when you need Desktop's packaged pnpm and Node surface without mutating the active profile. It does not promise DSH profile initialization, caller-relative `file:`/`link:` anchoring, or `dsh.profile.bundles` reconciliation.

`desktopPnpm.runPlugin(argv, invokingDir, signal?)` runs packaged `dsh plugin --profile <active>` from an absolute caller directory while preserving upstream `dsh.profile.bundles` reconciliation semantics.

```ts
desktopPnpm.run(['add', '--save-exact', packageSpec], signal)
desktopPnpm.runPlugin(['remove', packageName], invokingDir, signal)
desktopPnpm.runPlugin(['update'], invokingDir, signal)
```

Arguments are passed as argv. Do not concatenate shell strings or depend on Windows `.cmd` shims. The service settles only after the whole subprocess tree exits and terminates active operations during generation disposal.

## APIs not to depend on

`desktopRuntime`, `desktopPnpmBootstrap`, `desktopPermissions`, `desktopActions`, Electron `BrowserWindow`, the tray registry, private Node helpers, `ELECTRON_RUN_AS_NODE`, and generated shims are Desktop internals. Their presence in the runtime context does not make them third-party compatibility contracts.

## Minimal dual-surface Cordis plugin (UI + Agent tool)

Every OmniMux feature should keep a **UI surface** (`dsh-ui-kit`) and an **Agent tool surface** (`ctx.tools`) backed by the **same local store/service**, with a strict `confirm: true` guard on destructive actions. See [`plugins/packages/dsh-ui-kit/README.md`](../../plugins/packages/dsh-ui-kit/README.md), [`plugins/docs/contracts/plugin-agent-tools-inventory.md`](../../plugins/docs/contracts/plugin-agent-tools-inventory.md), [`plugins/docs/contracts/plugin-security-boundaries.md`](../../plugins/docs/contracts/plugin-security-boundaries.md), and [`CONTRIBUTING.md`](../../CONTRIBUTING.md) before authoring a new plugin.

### 1. Package metadata and Cordis patch (`package.json` + `cordis.patch.yml`)

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

### 2. Shared store with destructive confirmation guard (`src/store.js`)

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
          message: 'Pass confirm: true to delete this note.',
        }
      }
      const deleted = items.delete(String(id ?? ''))
      return { ok: true, deleted }
    },
  }
}
```

### 3. Host plugin registering `webServer.register` and `ctx.tools` (`src/index.js`)

Declare `inject = ['tools']` at the root and inject `webServer` lazily so headless sessions without HTTP still register tools cleanly, and declare `output: { schema, render }` plus `additionalProperties: false` on every registered tool:

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

  // Human UI HTTP surface mounts on webServer.register when a Host HTTP server is active.
  // In production, also check connection.requestRejection(req) when peer is absent.
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

  // Agent tool surface uses the exact same store, schema contract, and confirmation guard.
  ctx.tools.register({
    name: 'notes_create',
    description: 'Create a note item in the shared store.',
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
    description: 'Delete a note item (requires confirm: true).',
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

### 4. Client entry and panel using `dsh-ui-kit` and `--dsw-*` tokens (`src/client/`)

```jsx
// src/client/Panel.jsx
import { Button, PageHeader } from 'dsh-ui-kit'

export function NotesPanel({ items, onCreate }) {
  return (
    <section style={{ background: 'var(--dsw-alias-bg-layer-1)' }}>
      <PageHeader
        title="Notes"
        subtitle="Backed by the same local store as Agent tools"
        actions={<Button variant="primary" onClick={onCreate}>Add note</Button>}
      />
      <p style={{ color: 'var(--dsw-alias-label-secondary)' }}>
        Items: {items.length}
      </p>
    </section>
  )
}
```

```js
// src/client/index.js (built to lib/client.js for the "./client" export)
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

For in-repo OmniMux plugins, keep `dsh.manifest.json` (`capabilities.tools` and client slots) and [`plugins/docs/contracts/plugin-agent-tools-inventory.md`](../../plugins/docs/contracts/plugin-agent-tools-inventory.md) in sync whenever adding or changing tools.

## Testing and release checks

At minimum, a plugin should cover:

- Loading under ordinary DSH without Desktop services, or staying pending by design.
- Matching the profile name and directory reported by Desktop to the user's actual selection.
- Cancellation, non-zero exit, spawn failure, and generation teardown for package operations.
- Restarting after a plugin change and seeing the bundle in the next Loader composition.

Read the [architecture](architecture.en.md) next, then use the package-level [service contract](../dsh-desktop-next/docs/plugin-services.md) as the API reference.

## Ecosystem vision: keep the plugin ecosystem composable

The DSH plugin ecosystem is growing quickly. The more plugins there are, the more their ability to work together matters — if every plugin assumes or overrides another plugin's internals, installing a few plugins starts to conflict and the ecosystem fragments.

We advocate a browser-plugin style of development: everyone extends the same platform against the same conventions, instead of each maintaining a modified runtime of their own. DSH Desktop is the first practitioner of this approach — the desktop shell itself is an ordinary plugin on the same composition path as official and third-party plugins, with no special privileges.

To that end we are starting a development-conventions initiative and hope it becomes a de facto standard through community adoption:

- **Composition first**: compose capabilities through official slots, services, and patches; do not assume or override other plugins' internals.
- **Declare clearly**: state the services and slots you depend on; do not rely on runtime coincidences.
- **Compatibility first**: keep upgrades backward compatible and never break existing compositions.

The manifesto is a living document that follows ecosystem practice and accepts community discussion and revisions. Once the plugin marketplace ships, plugins following shared conventions will be easier to discover, install, and evaluate for compatibility, making convention-driven development the beneficial choice for every author. See the [DSH plugin ecosystem manifesto](plugin-ecosystem.en.md) for the vision and [DSH Community Fabric](../dsh-community-fabric/README.md) for the proposed future interoperability contract.
