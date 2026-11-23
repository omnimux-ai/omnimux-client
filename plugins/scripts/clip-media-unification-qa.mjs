#!/usr/bin/env node
/**
 * Real-browser (Headless Chromium via CDP) E2E verification for Clip Media Unification (Phases 0-3).
 *
 * Mounts:
 *   - Built `plugins/omnimux-clip/lib/client.js` (zero client code mocks)
 *   - Real 4-plugin backend stack:
 *       1) `omnimux` createMediaResolver
 *       2) `omnimux-assets` createLibraryStore + createLibraryMediaProvider
 *       3) `omnimux-workflow` ProjectStore + WorkspaceStore + ProjectAssetsStore + createWorkflowMediaSupport + createWorkflowClipService
 *       4) `omnimux-clip` createProjectStore + createClipVaultMediaProvider + createClipDispatcher + registerClipRoutes
 *   - Real H.264 MP4 fixtures synthesized via ffmpeg so Chromium genuinely decodes video bytes
 *
 * Usage:
 *   node plugins/scripts/clip-media-unification-qa.mjs [--evidence-dir=<dir>]
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAppQaChromePath } from './worktree-app-qa.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pluginsWorkspaceRoot = resolve(here, '..')
const repoRoot = resolve(pluginsWorkspaceRoot, '..')

const argEvidence = process.argv.find((a) => a.startsWith('--evidence-dir='))?.slice('--evidence-dir='.length)
const EVIDENCE_DIR = argEvidence
  ? resolve(argEvidence)
  : join(repoRoot, '.workbuddy', 'evidence', 'clip-media-unification-qa', randomUUID())
mkdirSync(EVIDENCE_DIR, { recursive: true })

const { createMediaResolver } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux/src/host/media-resolver.js'))
const { createLibraryStore } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-assets/src/library.js'))
const { resolveAssetsPaths } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-assets/src/paths.js'))
const { createLibraryMediaProvider } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-assets/src/media-provider.js'))
const { createProjectStore: createWorkflowProjectStore } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-workflow/src/projects/ProjectStore.ts'))
const { createWorkspaceStore } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-workflow/src/workflow/workspace/WorkspaceStore.ts'))
const { createProjectAssetsStore } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-workflow/src/workflow/workspace/ProjectAssetsStore.ts'))
const { createWorkflowMediaSupport } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-workflow/src/workflow/media/workflowMediaProviders.ts'))
const { createWorkflowClipService } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-workflow/src/workflow/clip/workflowClip.ts'))
const { createClipDispatcher, registerClipRoutes } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-clip/src/http/routes.js'))
const { createClipCommandBroker } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-clip/src/live/command-broker.js'))
const { createClipVaultMediaProvider } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-clip/src/media/clipVault.js'))
const { ensureClipDirs, resolveClipPaths } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-clip/src/paths.js'))
const { createProjectStore: createClipProjectStore } = await import(join(pluginsWorkspaceRoot, 'plugins/omnimux-clip/src/store/projectStore.js'))

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeMp4(outPath, { color, durationSec }) {
  const res = spawnSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=30:d=${durationSec}`,
    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${durationSec}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline',
    '-c:a', 'aac', '-b:a', '64k',
    '-movflags', '+faststart',
    '-shortest',
    outPath,
  ], { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr}`)
  return readFileSync(outPath)
}

async function bundleHostRuntime() {
  const req = createRequire(join(pluginsWorkspaceRoot, 'plugins/omnimux-clip/package.json'))
  const esbuild = req('esbuild')
  const entry = `
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JsxRuntime from 'react/jsx-runtime';

const Primitives = new Proxy({
  Tooltip: ({ children }) => children,
  Modal: ({ open, children }) => (open ? children : null),
}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop === 'string' && prop.startsWith('Icon')) {
      return function StubIcon({ size = 16, className, style, ...rest }) {
        return React.createElement('svg', {
          width: size, height: size, viewBox: '0 0 16 16', fill: 'none', className, style, 'aria-hidden': 'true', ...rest
        }, React.createElement('circle', { cx: 8, cy: 8, r: 5, stroke: 'currentColor', strokeWidth: 1.5 }));
      };
    }
    return undefined;
  }
});

const modules = {
  'react': React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': JsxRuntime,
  '@deepseek-ai/dsh-client-ui-primitives': Primitives,
  '@emotion/is-prop-valid': () => true,
};

window.__E2E_REACT__ = React;
window.__E2E_REACT_DOM_CLIENT__ = ReactDOMClient;
window.__E2E_PLUGINS__ = {};
window.__ModuleLoader__ = {
  load({ id, factory }) {
    const mod = factory((name) => {
      if (name in modules) return modules[name];
      throw new Error('Unexpected require from client bundle: ' + name);
    });
    window.__E2E_PLUGINS__[id] = mod;
    return mod;
  },
};
`
  const built = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: join(pluginsWorkspaceRoot, 'plugins/omnimux-clip'),
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'error',
    nodePaths: [
      join(pluginsWorkspaceRoot, 'plugins/omnimux-clip/node_modules'),
      join(repoRoot, 'node_modules'),
    ],
  })
  return built.outputFiles[0].text
}

function buildHtml({ workspaceId, nodeId, projectId, title }) {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <title>Clip Media Unification E2E</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; }
    :root, [data-theme="dark"] {
      color-scheme: dark;
      --dsw-alias-bg-base: #141519;
      --dsw-alias-bg-layer1: #1c1d22;
      --dsw-alias-bg-layer2: #24262c;
      --dsw-alias-bg-layer3: #2e3038;
      --dsw-alias-bg-mask-1: rgba(255, 255, 255, 0.06);
      --dsw-alias-interactive-bg-hover: #2c2e36;
      --dsw-alias-interactive-bg-selected: rgba(56, 189, 248, 0.16);
      --dsw-alias-border-l1: #262830;
      --dsw-alias-border-l2: #353844;
      --dsw-alias-border-l3: #4b5060;
      --dsw-alias-label-primary: #f2f4f8;
      --dsw-alias-label-secondary: #a2a7b4;
      --dsw-alias-label-tertiary: #737988;
      --dsw-alias-label-primary-foreground: #ffffff;
      --dsw-alias-label-danger: #f87171;
      --dsw-alias-brand-primary: #3b82f6;
      --dsw-alias-button-primary-fill: #3b82f6;
      --dsw-alias-button-primary-hover: #2563eb;
      --dsw-alias-feedback-success-fg: #34d399;
      --dsw-alias-feedback-warning-fg: #fbbf24;
      --dsw-alias-feedback-danger-fg: #f87171;
      --dsw-alias-feedback-info-fg: #60a5fa;
      --dsw-alias-state-success-primary: #34d399;
      --dsw-alias-state-warn-primary: #f59e0b;
      --dsw-alias-state-error-primary: #f87171;
      --dsw-alias-backdrop-bg: rgba(0, 0, 0, 0.62);
      --dsw-specific-menu: #1e2026;
    }
    [data-theme="light"] {
      color-scheme: light;
      --dsw-alias-bg-base: #ffffff;
      --dsw-alias-bg-layer1: #f6f7f9;
      --dsw-alias-bg-layer2: #eceef2;
      --dsw-alias-bg-layer3: #e2e5ec;
      --dsw-alias-bg-mask-1: rgba(15, 23, 42, 0.04);
      --dsw-alias-interactive-bg-hover: #e8ebf0;
      --dsw-alias-interactive-bg-selected: rgba(37, 99, 235, 0.10);
      --dsw-alias-border-l1: #e5e7eb;
      --dsw-alias-border-l2: #d1d5db;
      --dsw-alias-border-l3: #9ca3af;
      --dsw-alias-label-primary: #111827;
      --dsw-alias-label-secondary: #4b5563;
      --dsw-alias-label-tertiary: #6b7280;
      --dsw-alias-label-primary-foreground: #ffffff;
      --dsw-alias-label-danger: #dc2626;
      --dsw-alias-brand-primary: #2563eb;
      --dsw-alias-button-primary-fill: #2563eb;
      --dsw-alias-button-primary-hover: #1d4ed8;
      --dsw-alias-feedback-success-fg: #059669;
      --dsw-alias-feedback-warning-fg: #d97706;
      --dsw-alias-feedback-danger-fg: #dc2626;
      --dsw-alias-feedback-info-fg: #2563eb;
      --dsw-alias-state-success-primary: #059669;
      --dsw-alias-state-warn-primary: #d97706;
      --dsw-alias-state-error-primary: #dc2626;
      --dsw-alias-backdrop-bg: rgba(15, 23, 42, 0.35);
      --dsw-specific-menu: #ffffff;
    }
    body { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
    #canvas-tab-host { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
  </style>
</head>
<body>
  <div id="canvas-tab-host" data-omnimux-canvas-tab data-canvas-workspace-id="${workspaceId}" data-visible="true"></div>
  <div id="overlay-root"></div>
  <script src="/host-runtime.js"></script>
  <script src="/omnimux-clip-client.js"></script>
  <script>
    (function boot() {
      const React = window.__E2E_REACT__;
      const ReactDOMClient = window.__E2E_REACT_DOM_CLIENT__;
      const plugin = window.__E2E_PLUGINS__['omnimux-clip'];
      window.__omnimuxWorkbench = {
        getActiveSurface: () => ({
          panelOpen: true,
          tabId: 'omnimux-workflow:canvas',
          instanceId: 'tab-canvas-e2e',
          sessionId: 'sess-e2e',
        }),
        subscribe: () => () => {},
      };
      window.__omnimuxHubEvents = {
        getWindowId: () => 'win-e2e',
        windowFetch: (url, init) => fetch(url, init),
        pushViewport: async () => true,
        subscribe: () => () => {},
        on: () => () => {},
      };
      const dicts = {};
      const locale = {
        get: () => 'zh-CN',
        current: () => 'zh-CN',
        subscribe: () => () => {},
        register: (ns, tables) => { dicts[ns] = tables; },
        bind: (ns) => (key) => (dicts[ns] && dicts[ns].zh && dicts[ns].zh[key]) || key,
      };
      const overlays = [];
      const ctx = {
        locale,
        slots: {
          inject: (_name, fn) => fn(),
          register: (meta, Comp) => { overlays.push({ meta, Comp }); return () => {}; },
        },
        inject: () => {},
        effect: (fn) => fn(),
      };
      plugin.apply(ctx);

      function Shell() {
        return React.createElement(
          React.Fragment,
          null,
          overlays.map(({ meta, Comp }) =>
            React.createElement(Comp, Object.assign({ key: meta.id }, meta.inject ? meta.inject() : {}))
          )
        );
      }
      ReactDOMClient.createRoot(document.getElementById('overlay-root')).render(React.createElement(Shell));

      window.__E2E_SET_THEME__ = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.querySelectorAll('.openreel-studio-root').forEach((el) => {
          el.setAttribute('data-theme', theme);
          el.classList.toggle('dark', theme === 'dark');
        });
      };
      window.__E2E_OPEN_CLIP__ = () => {
        window.dispatchEvent(new CustomEvent('omnimux-clip-open', {
          detail: {
            source: 'canvas',
            workspaceId: ${JSON.stringify(workspaceId)},
            nodeId: ${JSON.stringify(nodeId)},
            projectId: ${JSON.stringify(projectId)},
            title: ${JSON.stringify(title)},
          },
        }));
      };
      setTimeout(() => window.__E2E_OPEN_CLIP__(), 80);
    })();
  </script>
</body>
</html>`
}

async function run() {
  const home = mkdtempSync(join(tmpdir(), 'clip-e2e-home-'))
  const chromeProfile = mkdtempSync(join(tmpdir(), 'clip-e2e-chrome-'))
  let server = null
  let chrome = null
  let socket = null
  const httpLog = []
  const externalRequests = []
  const consoleErrors = []
  const consoleLogs = []
  const pageErrors = []
  const assertions = []

  const check = (name, pass, detail) => {
    assertions.push({ name, pass: Boolean(pass), ...(detail !== undefined ? { detail } : {}) })
    console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
    if (!pass) throw new Error(`Assertion failed: ${name} (${JSON.stringify(detail)})`)
  }

  try {
    // 1. Build real 4-plugin backend & real MP4 video files
    const mediaResolver = createMediaResolver()
    const assetsPaths = resolveAssetsPaths({ homeDir: home })
    const library = createLibraryStore({ paths: assetsPaths })
    mediaResolver.registerProvider(createLibraryMediaProvider({ library }))

    const libraryRoot = join(home, 'projects-library')
    mkdirSync(libraryRoot, { recursive: true })
    const wfProjects = createWorkflowProjectStore({ libraryRoot })
    const wfProject = wfProjects.create('社媒运营', { canvasWorkspaceIds: ['ws_cmu_e2e'] })
    const wsId = wfProject.pages[0].canvasWorkspaceId
    const resolveProjectRoot = (id) => wfProjects.findByCanvasWorkspaceId(id)
    const wfStore = createWorkspaceStore({ workspacesDir: join(home, 'workspaces'), resolveProjectRoot })
    const createdCanvas = wfStore.create('社媒运营', wsId)
    const wfAssets = createProjectAssetsStore({ workspacesDir: wfStore.workspacesDir, resolveProjectRoot })
    const wfMediaDir = join(home, 'wf-media')
    mkdirSync(wfMediaDir, { recursive: true })
    mkdirSync(join(wfProject.path, 'artifacts'), { recursive: true })

    const shot1Rel = 'artifacts/shot_1.mp4'
    const shot2Rel = 'artifacts/shot_2.mp4'
    const shot3Rel = 'artifacts/shot_3.mp4'
    const shot4Rel = 'artifacts/shot_4.mp4'
    const shot1Bytes = makeMp4(join(wfProject.path, shot1Rel), { color: '0x2563eb', durationSec: 3.0 })
    const shot2OldBytes = Buffer.from('legacy-v1-bytes-replaced-on-disk')
    const shot2OldSha = sha256(shot2OldBytes)
    const shot2Bytes = makeMp4(join(wfProject.path, shot2Rel), { color: '0x059669', durationSec: 2.5 })
    const shot3Bytes = makeMp4(join(wfProject.path, shot3Rel), { color: '0xd97706', durationSec: 3.5 })
    const shot4Bytes = makeMp4(join(wfProject.path, shot4Rel), { color: '0x7c3aed', durationSec: 2.0 })
    const shot1Sha = sha256(shot1Bytes)
    const shot2Sha = sha256(shot2Bytes)
    const shot3Sha = sha256(shot3Bytes)
    const shot4Sha = sha256(shot4Bytes)

    for (const [rel, name, bytes, digest] of [
      [shot1Rel, 'shot_1.mp4', shot1Bytes, shot1Sha],
      [shot2Rel, 'shot_2.mp4', shot2Bytes, shot2Sha],
      [shot3Rel, 'shot_3.mp4', shot3Bytes, shot3Sha],
      [shot4Rel, 'shot_4.mp4', shot4Bytes, shot4Sha],
    ]) {
      wfAssets.registerGenerated(wsId, {
        relative_path: rel, name, type: 'video', size: bytes.length, mimeType: 'video/mp4', sha256: digest,
      })
    }

    const nodeCompId = 'node_comp_e2e'
    const clipProjectId = 'clip_cmu_browser_e2e'
    const binding = { workspaceId: wsId, nodeId: nodeCompId, projectId: clipProjectId }

    wfStore.save(wsId, {
      expectedVersion: createdCanvas.version,
      nodes: [
        {
          id: 'node_shot_1', type: 'material', position: { x: 0, y: 0 },
          data: {
            materialType: 'video', label: '视频分镜 1',
            mediaUrl: `/omnimux-workflow/api/workspaces/${wsId}/file?rel=${encodeURIComponent(shot1Rel)}`,
            durationSec: 3.0,
          },
        },
        {
          id: 'node_shot_2', type: 'material', position: { x: 0, y: 180 },
          data: {
            materialType: 'video', label: '视频分镜 2',
            mediaUrl: `/omnimux-workflow/api/workspaces/${wsId}/file?rel=${encodeURIComponent(shot2Rel)}&rev=sha256:${shot2Sha}`,
            durationSec: 2.5,
          },
        },
        {
          id: 'node_shot_3', type: 'material', position: { x: 0, y: 360 },
          data: {
            materialType: 'video', label: '视频分镜 3',
            mediaUrl: `/omnimux-workflow/api/workspaces/${wsId}/file?rel=${encodeURIComponent(shot3Rel)}&rev=sha256:${shot3Sha}`,
            durationSec: 3.5,
          },
        },
        {
          id: 'node_shot_4', type: 'material', position: { x: 0, y: 540 },
          data: {
            materialType: 'video', label: '视频分镜 4',
            mediaUrl: `/omnimux-workflow/api/workspaces/${wsId}/file?rel=${encodeURIComponent(shot4Rel)}&rev=sha256:${shot4Sha}`,
            durationSec: 2.0,
          },
        },
        {
          id: nodeCompId, type: 'video_composition', position: { x: 400, y: 200 },
          data: { title: '视频合成', projectId: clipProjectId },
        },
      ],
      edges: [
        { id: 'e1', source: 'node_shot_1', target: nodeCompId, sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e2', source: 'node_shot_2', target: nodeCompId, sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e3', source: 'node_shot_3', target: nodeCompId, sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e4', source: 'node_shot_4', target: nodeCompId, sourceHandle: 'out', targetHandle: 'in' },
      ],
    })

    const canAccessWorkspace = (id, sessionId) => id === wsId && sessionId === 'sess-e2e'
    const wfMediaSupport = createWorkflowMediaSupport({
      store: wfStore, assetsStore: wfAssets, resolveAssetsRoot: resolveProjectRoot, mediaDir: wfMediaDir, canAccessWorkspace,
    })
    mediaResolver.registerProvider(wfMediaSupport.projectAssetProvider)
    mediaResolver.registerProvider(wfMediaSupport.canvasNodeProvider)
    const workflowClip = createWorkflowClipService({
      store: wfStore, assetsStore: wfAssets, resolveProjectRoot,
      canAccessWorkspace, resolveNodeSources: wfMediaSupport.resolveNodeSources,
    })

    const clipPaths = resolveClipPaths({ homeDir: home })
    ensureClipDirs(clipPaths)
    mediaResolver.registerProvider(createClipVaultMediaProvider({ paths: clipPaths }))
    const clipStore = createClipProjectStore({ paths: clipPaths })
    clipStore.materialize(clipProjectId, { binding, title: '社媒运营 · 视频合成' })
    const initial = clipStore.load(clipProjectId)

    clipStore.save(clipProjectId, {
      ...initial.project,
      mediaLibrary: {
        items: [
          {
            id: 'm_legacy',
            name: '视频分镜 1',
            type: 'video',
            metadata: { duration: 3.0, width: 320, height: 180, frameRate: 30, codec: 'h264', sampleRate: 44100, channels: 2, fileSize: shot1Bytes.length, hasVideo: true, hasAudio: true },
            sourceRef: { kind: 'indexeddb', key: 'm_legacy', fingerprint: 'legacy-shot-1' },
            missing: true,
            isPlaceholder: true,
          },
          {
            id: 'm_drifted',
            name: '视频分镜 2',
            type: 'video',
            metadata: { duration: 3.0, width: 320, height: 180, frameRate: 30, codec: 'h264', sampleRate: 44100, channels: 2, fileSize: shot2OldBytes.length, hasVideo: true, hasAudio: true },
            omnimuxSource: {
              id: `${wsId}:node_shot_2:0`,
              version: `sha256:${shot2OldSha}`,
              digest: shot2OldSha,
              handle: { v: 1, scope: 'project-asset', workspaceId: wsId, rel: shot2Rel, sha256: shot2OldSha },
            },
            sourceRef: { kind: 'indexeddb', key: 'm_drifted', digest: shot2OldSha },
            missing: true,
            isPlaceholder: true,
          },
          {
            id: 'm_ambig',
            name: '视频分镜 3',
            type: 'video',
            metadata: { duration: 9.0, width: 320, height: 180, frameRate: 30, codec: 'h264', sampleRate: 44100, channels: 2, fileSize: 100, hasVideo: true, hasAudio: true },
            sourceRef: { kind: 'indexeddb', key: 'm_ambig' },
            missing: true,
            isPlaceholder: true,
          },
        ],
      },
      timeline: {
        ...initial.project.timeline,
        tracks: [
          {
            id: 'track_v1',
            type: 'video',
            name: 'Video 1',
            clips: [
              { id: 'clip_1', mediaId: 'm_legacy', trackId: 'track_v1', startTime: 0, duration: 3.0, inPoint: 0, outPoint: 3.0, effects: [], audioEffects: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 }, volume: 1, keyframes: [] },
              { id: 'clip_2', mediaId: 'm_drifted', trackId: 'track_v1', startTime: 3.0, duration: 3.0, inPoint: 0, outPoint: 3.0, effects: [], audioEffects: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 }, volume: 1, keyframes: [] },
              { id: 'clip_3', mediaId: 'm_ambig', trackId: 'track_v1', startTime: 6.0, duration: 3.0, inPoint: 0, outPoint: 3.0, effects: [], audioEffects: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 }, volume: 1, keyframes: [] },
            ],
            effects: [],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
      },
    }, { expectedRevision: initial.revision, revision: initial.revision + 1, binding })

    const broker = createClipCommandBroker()
    const dispatcher = createClipDispatcher({
      paths: clipPaths,
      store: clipStore,
      broker,
      getMediaResolver: () => mediaResolver,
      getWorkflowClip: () => workflowClip,
    })

    const hostRuntimeJs = await bundleHostRuntime()
    const clipClientJs = readFileSync(join(pluginsWorkspaceRoot, 'plugins/omnimux-clip/lib/client.js'), 'utf8')
    const indexHtml = buildHtml({ workspaceId: wsId, nodeId: nodeCompId, projectId: clipProjectId, title: '社媒运营 · 视频合成' })

    let clipApiHandler = null
    let clipApiPrefix = '/omnimux-clip/api'
    registerClipRoutes(
      {
        register(route) {
          clipApiPrefix = route.path
          clipApiHandler = route.handler
        },
      },
      dispatcher,
      {
        getConnection: () => ({ requestRejection: () => undefined }),
        getHubEvents: () => ({
          authorizeWindow: () => ({
            id: 'win-e2e',
            windowId: 'win-e2e',
            sessionId: 'sess-e2e',
            isAlive: () => true,
            getViewport: () => ({ sessionId: 'sess-e2e', tabId: 'omnimux-workflow:canvas', instanceId: 'tab-canvas-e2e' }),
            send: () => true,
          }),
        }),
      },
    )

    server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const pathname = url.pathname
      let capturedSha256 = null
      const origWriteHead = res.writeHead.bind(res)
      res.writeHead = (statusCode, ...rest) => {
        const hdrs = rest.find((a) => a && typeof a === 'object' && !Array.isArray(a))
        if (hdrs) {
          for (const [k, v] of Object.entries(hdrs)) {
            if (k.toLowerCase() === 'x-content-sha256') capturedSha256 = String(v)
          }
        }
        return origWriteHead(statusCode, ...rest)
      }
      const origEnd = res.end.bind(res)
      res.end = (...args) => {
        if (pathname.startsWith('/omnimux-clip/api/') || res.statusCode >= 400) {
          httpLog.push({ method: req.method, path: pathname, status: res.statusCode, sha256Header: capturedSha256 || res.getHeader('x-content-sha256') || null })
        }
        return origEnd(...args)
      }
      if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(indexHtml)
        return
      }
      if (pathname === '/host-runtime.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
        res.end(hostRuntimeJs)
        return
      }
      if (pathname === '/omnimux-clip-client.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
        res.end(clipClientJs)
        return
      }
      if (pathname.startsWith(clipApiPrefix) && clipApiHandler) {
        await clipApiHandler(req, res)
        return
      }
      res.writeHead(404)
      res.end('Not found')
    })

    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const port = server.address().port
    const origin = `http://127.0.0.1:${port}`
    check('ephemeral-4plugin-server-ready', port > 0, { origin })

    // 2. Launch real Headless Chrome via CDP
    const chromePath = findAppQaChromePath()
    chrome = spawn(chromePath, [
      '--headless=new', '--remote-debugging-port=0', '--no-first-run',
      `--user-data-dir=${chromeProfile}`, '--no-default-browser-check', '--disable-gpu',
      '--window-size=1280,840', '--force-device-scale-factor=2',
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })

    const cdpPort = await new Promise((resolvePort, rejectPort) => {
      const timer = setTimeout(() => rejectPort(new Error('chrome-start-timeout')), 20000)
      let buf = ''
      chrome.stderr.on('data', (chunk) => {
        buf += chunk.toString()
        const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(buf)
        if (m) { clearTimeout(timer); resolvePort(Number(m[1])) }
      })
      chrome.once('exit', (code) => { clearTimeout(timer); rejectPort(new Error(`chrome-exit-${code}`)) })
    })
    const versionInfo = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
    const pageTarget = targets.find((t) => t.type === 'page')
    assert.ok(pageTarget?.id, 'CDP page target missing')

    socket = new WebSocket(versionInfo.webSocketDebuggerUrl)
    await new Promise((yes, no) => { socket.onopen = yes; socket.onerror = no })
    let seq = 0
    const pending = new Map()
    let sessionId = null

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'Network.requestWillBeSent') {
        const u = msg.params?.request?.url || ''
        if (u && !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) {
          externalRequests.push(u)
        }
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const text = msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'exception'
        pageErrors.push(text)
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
        consoleLogs.push(`[${msg.params.type}] ${args}`)
        if (msg.params.type === 'error') consoleErrors.push(args)
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: yes, reject: no } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) no(new Error(`CDP ${msg.error.message}`))
        else yes(msg.result)
      }
    }
    const send = (method, params = {}, useSession = true) => new Promise((yes, no) => {
      const id = ++seq
      const timer = setTimeout(() => { pending.delete(id); no(new Error(`CDP timeout: ${method}`)) }, 30000)
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); yes(v) },
        reject: (e) => { clearTimeout(timer); no(e) },
      })
      socket.send(JSON.stringify({ id, method, ...(useSession && sessionId ? { sessionId } : {}), params }))
    })

    const attached = await send('Target.attachToTarget', { targetId: pageTarget.id, flatten: true }, false)
    sessionId = attached.sessionId
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Network.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 840, deviceScaleFactor: 2, mobile: false })

    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) {
        throw new Error(`Page eval error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`)
      }
      return r.result?.value
    }

    const waitFor = async (label, fnExpr, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs
      let last = null
      while (Date.now() < deadline) {
        last = await evalJs(fnExpr)
        if (last && last.ok) return last
        await sleep(180)
      }
      throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`)
    }

    const capturePng = async (filename) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      const buf = Buffer.from(shot.data, 'base64')
      assert.ok(buf.length > 4000, `Screenshot ${filename} unexpectedly small: ${buf.length}`)
      const fullPath = join(EVIDENCE_DIR, filename)
      writeFileSync(fullPath, buf)
      return fullPath
    }

    const clickByText = async (scopeSelector, textSubstring) => {
      const target = await evalJs(`(() => {
        const root = ${scopeSelector ? `document.querySelector(${JSON.stringify(scopeSelector)})` : 'document'};
        if (!root) return { found: false, reason: 'no-scope' };
        const btns = [...root.querySelectorAll('button')];
        for (const btn of btns) {
          const label = (btn.textContent || '').replace(/\\s+/g, ' ').trim();
          const title = btn.getAttribute('title') || btn.getAttribute('aria-label') || '';
          if (label.includes(${JSON.stringify(textSubstring)}) || title.includes(${JSON.stringify(textSubstring)})) {
            const box = btn.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) continue;
            btn.scrollIntoView({ block: 'center', inline: 'center' });
            const r = btn.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { found: true, label, disabled: btn.disabled, x, y, hitOk: Boolean(hit && btn.contains(hit)) };
          }
        }
        return { found: false, available: btns.map(b => (b.textContent || '').trim()).filter(Boolean).slice(0, 25) };
      })()`)
      if (!target.found) throw new Error(`Button "${textSubstring}" not found in ${scopeSelector}: ${JSON.stringify(target)}`)
      if (target.disabled) throw new Error(`Button "${textSubstring}" is disabled`)
      if (!target.hitOk) throw new Error(`Button "${textSubstring}" is obscured at (${target.x}, ${target.y})`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
      return target
    }

    // 3. Navigate & wait for real Clip Editor + missing media badge
    await send('Page.navigate', { url: origin })
    const editorReady = await waitFor('clip-editor-open-with-missing-media', `(() => {
      const root = document.querySelector('.openreel-studio-root');
      if (!root) return { ok: false, phase: 'no-root' };
      const text = root.innerText || '';
      const hasMissing = text.includes('缺失') || text.includes('媒体离线') || text.includes('重新关联');
      const relinkBtn = [...root.querySelectorAll('button')].find((b) => {
        const t = (b.textContent || '').trim();
        return t.includes('重新关联') || t.includes('同步画布素材') || t.includes('Relink');
      });
      return { ok: Boolean(hasMissing && relinkBtn), hasMissing, relinkLabel: relinkBtn?.textContent?.trim() || null, sample: text.slice(0, 240) };
    })()`, 25000)
    check('clip-editor-mounts-and-shows-missing-media', editorReady.ok, editorReady)

    // 4. Verify initial open auto-upgraded m_legacy (AC-CMU-02) with .backups/ written & rejected drifted m_drifted with 409 (AC-CMU-04)
    const backupsDir = join(clipPaths.projectsDir, '.backups')
    const initialBackupFiles = existsSync(backupsDir) ? readdirSync(backupsDir) : []
    const drifted409BeforeRelink = httpLog.some((e) => e.path.endsWith('/media/m_drifted/bytes') && e.status === 409)
    const legacy200OnOpen = httpLog.some((e) => e.path.endsWith('/media/m_legacy/bytes') && e.status === 200)
    check('initial-open-auto-upgrades-legacy-with-backup-and-rejects-drifted-409', initialBackupFiles.length >= 1 && drifted409BeforeRelink && legacy200OnOpen, {
      initialBackupFiles,
      drifted409BeforeRelink,
      legacy200OnOpen,
    })

    // 5. Open CanvasRelinkDialog via real button click
    await clickByText('.openreel-studio-root', editorReady.relinkLabel)
    const dialogReady = await waitFor('canvas-relink-dialog-ready', `(() => {
      const dlg = document.querySelector('[data-testid="canvas-relink-dialog"]');
      if (!dlg) return { ok: false, reason: 'no-dialog' };
      const rows = [...dlg.querySelectorAll('.clip-relink-row')];
      const states = rows.map(r => r.getAttribute('data-reconcile-state')).filter(Boolean);
      const radios = dlg.querySelectorAll('input[type="radio"]').length;
      const unimported = dlg.querySelectorAll('[data-upstream-row="true"]').length;
      const dlgText = dlg.innerText || '';
      return {
        ok: states.includes('online_exact') && states.includes('source_drifted') && states.includes('legacy_ambiguous') && radios >= 1 && unimported === 1,
        states,
        radios,
        unimported,
        hasMiddleDot: dlgText.includes('·'),
        dlgText: dlgText.slice(0, 450),
      };
    })()`, 15000)
    check('relink-dialog-inspects-all-states-and-renders-ambiguous-radios', dialogReady.ok && !dialogReady.hasMiddleDot, dialogReady)

    // 5. Visual & geometry assertions across Dark, Light, and Narrow viewports
    const measureDialogGeometry = async (themeLabel) => evalJs(`(() => {
      const dlg = document.querySelector('[data-testid="canvas-relink-dialog"]');
      const rect = dlg.getBoundingClientRect();
      const cs = getComputedStyle(dlg);
      const parseAlpha = (color) => {
        if (!color || color === 'transparent') return 0;
        const rgb = /rgba?\\(\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*,\\s*[\\d.]+(?:\\s*,\\s*([\\d.]+))?\\s*\\)/.exec(color);
        if (rgb) return rgb[1] === undefined ? 1 : Number(rgb[1]);
        const slash = /\\/\\s*([\\d.]+)(%?)\\s*\\)/.exec(color);
        if (slash) return slash[2] === '%' ? Number(slash[1]) / 100 : Number(slash[1]);
        if (/^(?:color|oklch|oklab|lab|lch|srgb|hsl|hwb)\\(/.test(color)) return 1;
        return 0;
      };
      const alpha = parseAlpha(cs.backgroundColor);
      const pills = [...dlg.querySelectorAll('.clip-relink-pill')];
      const wrappedPills = pills.filter(p => p.getBoundingClientRect().height > 28).length;
      const overflowX = dlg.scrollWidth > dlg.clientWidth + 2;
      return {
        theme: ${JSON.stringify(themeLabel)},
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
        backgroundColor: cs.backgroundColor,
        opaque: alpha >= 0.99,
        pillCount: pills.length,
        wrappedPills,
        overflowX,
      };
    })()`)

    // Dark theme (1280x840)
    await evalJs(`window.__E2E_SET_THEME__('dark')`)
    await sleep(250)
    const darkGeom = await measureDialogGeometry('dark')
    const darkShot = await capturePng('01-relink-dialog-dark.png')
    check('relink-dialog-dark-geometry-and-opaque', darkGeom.opaque && darkGeom.inViewport && darkGeom.wrappedPills === 0 && !darkGeom.overflowX, { ...darkGeom, shot: darkShot })

    // Light theme (1280x840)
    await evalJs(`window.__E2E_SET_THEME__('light')`)
    await sleep(250)
    const lightGeom = await measureDialogGeometry('light')
    const lightShot = await capturePng('02-relink-dialog-light.png')
    check('relink-dialog-light-geometry-and-opaque', lightGeom.opaque && lightGeom.inViewport && lightGeom.wrappedPills === 0 && !lightGeom.overflowX, { ...lightGeom, shot: lightShot })

    // Narrow viewport (680x840, dark theme)
    await evalJs(`window.__E2E_SET_THEME__('dark')`)
    await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 840, deviceScaleFactor: 2, mobile: false })
    await sleep(250)
    const narrowGeom = await measureDialogGeometry('narrow-dark')
    const narrowShot = await capturePng('03-relink-dialog-narrow.png')
    check('relink-dialog-narrow-geometry-and-no-overflow', narrowGeom.opaque && narrowGeom.inViewport && narrowGeom.wrappedPills === 0 && !narrowGeom.overflowX, { ...narrowGeom, shot: narrowShot })

    // Restore 1280x840 for interactive recovery tests
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 840, deviceScaleFactor: 2, mobile: false })
    await sleep(200)

    // 6. Action 1: Accept drift (`sync_from_upstream` on source_drifted)
    await clickByText('[data-testid="canvas-relink-dialog"]', '采用画布最新版本')
    const afterDrift = await waitFor('m_drifted-updated-online', `(() => {
      const dlg = document.querySelector('[data-testid="canvas-relink-dialog"]');
      const driftedRow = dlg?.querySelector('[data-reconcile-state="source_drifted"]');
      const onlineRows = dlg?.querySelectorAll('[data-reconcile-state="online_exact"]').length || 0;
      const errText = dlg?.querySelector('.clip-relink-row-error')?.textContent || null;
      const driftedText = driftedRow?.innerText?.trim() || null;
      return { ok: !driftedRow && onlineRows >= 2 && !errText, hasDrifted: Boolean(driftedRow), onlineRows, errText, driftedText };
    })()`, 15000)
    check('action-accept-drift-hydrates-online', afterDrift.ok, afterDrift)

    // 7. Action 2: Bind ambiguous item via candidate radio (`sync_from_upstream` on legacy_ambiguous)
    await evalJs(`(() => {
      const radio = document.querySelector('[data-testid="canvas-relink-dialog"] [data-reconcile-state="legacy_ambiguous"] input[type="radio"]');
      if (radio && !radio.checked) radio.click();
    })()`)
    await sleep(120)
    await clickByText('[data-testid="canvas-relink-dialog"]', '关联所选上游')
    const afterAmbig = await waitFor('m_ambig-bound-online', `(() => {
      const dlg = document.querySelector('[data-testid="canvas-relink-dialog"]');
      const ambigRow = dlg?.querySelector('[data-reconcile-state="legacy_ambiguous"]');
      const onlineRows = dlg?.querySelectorAll('[data-reconcile-state="online_exact"]').length || 0;
      const errText = dlg?.querySelector('.clip-relink-row-error')?.textContent || null;
      return { ok: !ambigRow && onlineRows >= 3 && !errText, hasAmbig: Boolean(ambigRow), onlineRows, errText };
    })()`, 15000)
    check('action-bind-ambiguous-candidate-hydrates-online', afterAmbig.ok, afterAmbig)

    // 8. Action 3: Import unimported upstream (`import_upstream` for 视频分镜 4)
    await clickByText('[data-testid="canvas-relink-dialog"]', '导入到素材池')
    const afterImport = await waitFor('upstream-4-imported-online', `(() => {
      const dlg = document.querySelector('[data-testid="canvas-relink-dialog"]');
      const unimported = dlg?.querySelectorAll('[data-upstream-row="true"]').length || 0;
      const onlineRows = dlg?.querySelectorAll('[data-reconcile-state="online_exact"]').length || 0;
      return { ok: unimported === 0 && onlineRows >= 4, unimported, onlineRows };
    })()`, 15000)
    check('action-import-unimported-upstream-hydrates-online', afterImport.ok, afterImport)

    // Close dialog & verify editor shows 0 missing items and persisted Host project has 4 items with handles + timeline clips preserved
    await clickByText('[data-testid="canvas-relink-dialog"]', '完成')
    await sleep(500)
    const recoveredShot = await capturePng('04-editor-recovered-dark.png')
    const persisted = clipStore.load(clipProjectId)
    const itemsWithHandles = persisted.project.mediaLibrary.items.filter((i) => i.omnimuxSource?.handle?.scope === 'project-asset' && i.omnimuxSource?.digest)
    const trackClips = persisted.project.timeline?.tracks?.flatMap((tr) => tr.clips || []) ?? []
    const clipMediaIds = trackClips.map((c) => c.mediaId)
    const preservedTimeline = clipMediaIds.includes('m_legacy') && clipMediaIds.includes('m_drifted') && clipMediaIds.includes('m_ambig')
    check('host-persisted-4-items-with-verified-handles-and-preserved-timeline', itemsWithHandles.length === 4 && preservedTimeline, {
      count: itemsWithHandles.length,
      ids: itemsWithHandles.map((i) => ({ id: i.id, name: i.name, scope: i.omnimuxSource.handle.scope })),
      clipMediaIds,
      shot: recoveredShot,
    })

    const missingGone = await evalJs(`(() => {
      const root = document.querySelector('.openreel-studio-root');
      const text = root ? root.innerText : '';
      return { ok: !text.includes('媒体离线') && !/缺失\\s*[1-9]/.test(text), sample: text.slice(0, 300) };
    })()`)
    check('editor-ui-zero-missing-after-recovery', missingGone.ok, missingGone)

    // 10. Wipe ALL IndexedDB databases and reload -> verify automatic recovery from Host bytes!
    await evalJs(`(async () => {
      const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
      await Promise.all(dbs.map((db) => new Promise((res) => {
        if (!db.name) return res();
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = req.onerror = req.onblocked = () => res();
      })));
    })()`)
    const reloadStartIndex = httpLog.length
    const bytesBeforeReload = httpLog.filter((e) => e.path.endsWith('/bytes') && e.status === 200).length
    await send('Page.reload', { ignoreCache: true })

    const afterReload = await waitFor('auto-recover-after-idb-wipe-reload', `(() => {
      const root = document.querySelector('.openreel-studio-root');
      if (!root) return { ok: false, phase: 'no-root' };
      const text = root.innerText || '';
      const hasShot1 = text.includes('视频分镜 1');
      const hasShot4 = text.includes('视频分镜 4');
      const offline = text.includes('媒体离线') || /缺失\\s*[1-9]/.test(text);
      return { ok: hasShot1 && hasShot4 && !offline, hasShot1, hasShot4, offline };
    })()`, 25000)
    const bytesAfterReload = httpLog.filter((e) => e.path.endsWith('/bytes') && e.status === 200 && e.sha256Header)
    await sleep(400)
    const reloadShot = await capturePng('05-editor-after-idb-wipe-reload.png')
    check('idb-wipe-reload-auto-recovers-from-host-bytes', afterReload.ok && bytesAfterReload.length >= bytesBeforeReload + 4, {
      bytesBeforeReload,
      bytesAfterReload: bytesAfterReload.length,
      shot: reloadShot,
    })

    // Only the pre-relink 409 on intentionally drifted m_drifted is allowed; zero unexpected 4xx/5xx anywhere, and zero errors on reload.
    const unexpectedHttp = httpLog.filter((e) => e.status >= 400 && !(e.status === 409 && e.path.endsWith('/media/m_drifted/bytes')))
    const reloadErrors = httpLog.slice(reloadStartIndex).filter((e) => e.status >= 400)
    check('zero-unexpected-http-errors-on-clip-api', unexpectedHttp.length === 0 && reloadErrors.length === 0, {
      totalApiCalls: httpLog.length,
      unexpectedHttp,
      reloadErrors,
    })
    check('zero-external-cdn-requests', externalRequests.length === 0, { externalRequests })
    check('zero-uncaught-page-errors', pageErrors.length === 0 && consoleErrors.length === 0, {
      pageErrors,
      consoleErrorCount: consoleErrors.length,
    })

    const summary = {
      pass: true,
      head: spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
      assertions,
      httpCalls: httpLog.length,
      externalRequests,
      screenshots: [darkShot, lightShot, narrowShot, recoveredShot, reloadShot],
      consoleErrors,
    }
    writeFileSync(join(EVIDENCE_DIR, 'report.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('\n🎉 REAL-BROWSER E2E PASSED:', assertions.length, 'assertions,', httpLog.length, 'API calls')
    console.log('Evidence:', EVIDENCE_DIR)
  } catch (err) {
    if (httpLog.length || pageErrors.length || consoleErrors.length || externalRequests.length) {
      console.error('[E2E diagnostics] httpLog:', JSON.stringify(httpLog.slice(-15)))
      if (pageErrors.length) console.error('[E2E diagnostics] pageErrors:', JSON.stringify(pageErrors.slice(-10)))
      if (consoleErrors.length) console.error('[E2E diagnostics] consoleErrors:', JSON.stringify(consoleErrors.slice(-10)))
      if (consoleLogs.length) console.error('[E2E diagnostics] consoleLogs:', JSON.stringify(consoleLogs.slice(-20)))
      if (externalRequests.length) console.error('[E2E diagnostics] externalRequests:', JSON.stringify(externalRequests))
    }
    throw err
  } finally {
    try { socket?.close() } catch {}
    try { chrome?.kill('SIGKILL') } catch {}
    if (server) await new Promise((r) => server.close(r))
    await sleep(150)
    try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) } catch {}
    try { rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) } catch {}
  }
}

run().catch((err) => {
  console.error('❌ E2E FAILED:', err)
  process.exit(1)
})
