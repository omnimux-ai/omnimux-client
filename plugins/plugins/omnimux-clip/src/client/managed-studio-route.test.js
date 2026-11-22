import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test, { after, beforeEach, mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)
const hubRequire = createRequire(new URL('../../../omnimux/package.json', import.meta.url))
const { JSDOM } = hubRequire('jsdom')
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/#host-session' })
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  localStorage: dom.window.localStorage,
  self: dom.window,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
})
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.HTMLCanvasElement.prototype.getContext = () => null

const directory = fileURLToPath(new URL('./', import.meta.url))
const vendor = fileURLToPath(new URL('./openreel/', import.meta.url))
// Keep the App, WelcomeScreen, router, stores and creation flow real. The editor
// frame and application services outside the route lifecycle use test doubles.
const stubs = {
  './editor-loader': `const EditorInterface = ({ active, canvasMode }) =>
    <section data-editor-frame={canvasMode ? 'canvas' : 'studio'} hidden={!active} />;
    export const getLoadedEditor = () => EditorInterface;
    export const loadEditorModule = async () => ({ EditorInterface });`,
  './components/AppProviders': 'export const AppProviders = ({ children }) => children;',
  './TemplateGallery': 'export const TemplateGallery = () => null;',
  './RecentProjects': 'export const RecentProjects = () => null;',
}
const result = await build({
  stdin: {
    contents: `export { default as App } from './openreel/web/App';
      export { getOpenReelRoute, navigateOpenReel } from './openreel/web/hooks/use-router';
      export { useProjectStore } from './openreel/web/stores/project-store';
      export { useUIStore } from './openreel/web/stores/ui-store';
      export { autoSaveManager } from './openreel/web/services/auto-save';
      export { trackEditorDraftWrite } from './openreel/web/services/editor-field-drafts';
      export { useHostLocale } from './useHostLocale.js';`,
    resolveDir: directory,
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  alias: {
    '@openreel/core': `${vendor}core`,
    '@openreel/ui': `${vendor}ui`,
    '@openreel/agent': `${vendor}agent`,
    '@openreel/creation-schema': `${vendor}creation-schema`,
  },
  define: { 'import.meta.env': '{}', 'import.meta.hot': 'undefined', 'import.meta.url': JSON.stringify(import.meta.url) },
  loader: { '.css': 'empty', '.wgsl': 'text', '.svg': 'dataurl', '.wasm': 'dataurl', '.webp': 'dataurl', '.jpg': 'dataurl' },
  plugins: [{ name: 'studio-test-services', setup(build) {
    build.onResolve({ filter: /^@\// }, ({ path, kind, resolveDir }) =>
      build.resolve(`${vendor}web/${path.slice(2)}`, { kind, resolveDir }))
    build.onResolve({ filter: /^\.\// }, ({ path }) => stubs[path] && ({ path, namespace: 'studio-test' }))
    build.onLoad({ filter: /.*/, namespace: 'studio-test' }, ({ path }) => ({ contents: stubs[path], loader: 'jsx', resolveDir: directory }))
    build.onResolve({ filter: /\?worker&url$/ }, () => ({ path: 'worker', namespace: 'worker' }))
    build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({ contents: 'export default "about:blank"' }))
  } }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
const { App, getOpenReelRoute, navigateOpenReel, useProjectStore, useUIStore, autoSaveManager,
  trackEditorDraftWrite, useHostLocale } = module.exports
const initialProjectState = useProjectStore.getState()
const english = Object.freeze({ active: 'en', revision: 0 })
const locale = { getSnapshot: () => english }

beforeEach(t => {
  mock.method(autoSaveManager, 'initialize', async () => {})
  mock.method(autoSaveManager, 'checkForRecovery', async () => [])
  t.after(() => mock.restoreAll())
  useProjectStore.setState(initialProjectState, true)
  useUIStore.getState().setSkipWelcomeScreen(false)
  navigateOpenReel('welcome')
})
after(() => dom.window.close())

function Workbench({ studio, canvas }) {
  useHostLocale(locale)
  return React.createElement(React.Fragment, null,
    React.createElement('section', { 'data-test-seat': 'studio', 'data-visible': String(studio.active !== false) },
      React.createElement(App, { managed: true, ...studio })),
    canvas && React.createElement('section', { 'data-test-seat': 'canvas', 'data-visible': String(canvas.active) },
      React.createElement(App, { managed: true, canvasMode: true, ...canvas })),
  )
}

async function mount(t, studio = {}, canvas) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  const render = async (studio, canvas) => act(async () => root.render(React.createElement(Workbench, { studio, canvas })))
  await render(studio, canvas)
  return { studio: container.querySelector('[data-test-seat="studio"]'), container, render }
}

const navigate = (route, params) => act(async () => navigateOpenReel(route, params))
const escape = target => act(async () => target.dispatchEvent(new window.KeyboardEvent('keydown', {
  key: 'Escape', bubbles: true, cancelable: true,
})))
const click = element => act(async () => element.click())
const welcome = container => container.querySelector('[data-testid="welcome-scroller"]')
const button = (container, label) => container.querySelector(`button[aria-label="${label}"]`)
const editor = (container, mode) => container.querySelector(`[data-editor-frame="${mode}"]:not([hidden])`)

function assertWelcome(container) {
  assert.ok(welcome(container), `expected WelcomeScreen, got ${container.textContent.trim()}`)
  assert.ok(button(container, 'Create Horizontal project'))
  assert.doesNotMatch(container.textContent, /Opening project\.\.\./)
  assert.equal(useProjectStore.getState().hasOpenProject, false)
  assert.deepEqual(getOpenReelRoute(), { route: 'welcome', params: {} })
  assert.equal(window.location.hash, '#host-session')
}

function holdCreation() {
  const { project, actionHistory } = useProjectStore.getState()
  const { promise, resolve } = Promise.withResolvers()
  trackEditorDraftWrite(promise, { projectId: project.id, history: actionHistory })
  return () => act(async () => resolve())
}

test('managed Studio activates on welcome when the shared route still points to a closed editor', async t => {
  await navigate('editor', { tab: 'timeline' })
  const { studio, render } = await mount(t, { active: false })
  assert.equal(getOpenReelRoute().route, 'editor')
  assert.equal(welcome(studio), null)
  await render({ active: true })
  assertWelcome(studio)
})

test('projectless editor navigation and its disabled Motion alias settle on the real welcome route', async t => {
  const { studio } = await mount(t)
  for (const route of ['editor', 'motion', 'editor']) {
    await navigate(route, { compositionId: 'closed-project' })
    assertWelcome(studio)
  }
})

test('explicit managed welcome opens with a saved skip-on-startup preference', async t => {
  useUIStore.getState().setSkipWelcomeScreen(true)
  const { studio } = await mount(t)
  assertWelcome(studio)
  assert.equal(useUIStore.getState().skipWelcomeScreen, true)
})

test('Escape on a managed welcome stays there and the editor shortcut is disabled without a project', async t => {
  const { studio } = await mount(t)
  await escape(button(studio, 'Browse templates'))
  assertWelcome(studio)
  const openEditor = button(studio, 'Open editor')
  assert.equal(openEditor.disabled, true)
  await click(openEditor)
  assertWelcome(studio)
})

test('Escape returns from templates and recent projects to the welcome home', async t => {
  const { studio } = await mount(t)
  for (const label of ['Browse templates', 'Recent projects']) {
    await click(button(studio, label))
    assert.equal(welcome(studio), null)
    await escape(button(studio, 'Back'))
    assertWelcome(studio)
  }
})

test('an explicit new route waits for the pending draft write and then opens the requested format', async t => {
  const { studio } = await mount(t)
  const finish = holdCreation()
  t.after(finish)
  await navigate('new', { dimensions: '1080x1920', fps: '60' })
  assert.equal(getOpenReelRoute().route, 'new')
  assert.match(studio.textContent, /Opening project\.\.\./)
  assert.equal(useProjectStore.getState().hasOpenProject, false)
  await finish()
  const { hasOpenProject, project } = useProjectStore.getState()
  assert.equal(getOpenReelRoute().route, 'editor')
  assert.ok(editor(studio, 'studio'))
  assert.equal(hasOpenProject, true)
  assert.equal(project.settings.width, 1080)
  assert.equal(project.settings.height, 1920)
  assert.equal(project.settings.frameRate, 60)
})

test('Escape cancels a pending projectless new route even if its draft write resolves later', async t => {
  const { studio } = await mount(t)
  const finish = holdCreation()
  t.after(finish)
  await navigate('new')
  assert.equal(getOpenReelRoute().route, 'new')
  await escape(studio.firstElementChild)
  await finish()
  assertWelcome(studio)
})

test('an inactive Studio does not resume a pending new project after Canvas takes the seat', async t => {
  const { container, studio, render } = await mount(t, { active: true }, { active: false })
  const finish = holdCreation()
  t.after(finish)
  await navigate('new')
  await render({ active: false }, { active: false })
  await act(async () => {
    useProjectStore.getState().createNewProject('Canvas draft')
    navigateOpenReel('editor')
  })
  await render({ active: false }, { active: true })
  const canvasProject = useProjectStore.getState().project
  await finish()
  assert.equal(useProjectStore.getState().project, canvasProject)
  assert.equal(canvasProject.name, 'Canvas draft')
  assert.equal(getOpenReelRoute().route, 'editor')
  assert.ok(editor(container, 'canvas'))
  assert.equal(welcome(studio), null)
})

test('Escape resumes the existing Studio project without replacing it', async t => {
  useProjectStore.getState().createNewProject('Saved Studio draft')
  const project = useProjectStore.getState().project
  const { studio } = await mount(t)
  assert.ok(welcome(studio))
  await escape(button(studio, 'Open editor'))
  assert.equal(getOpenReelRoute().route, 'editor')
  assert.ok(editor(studio, 'studio'))
  assert.equal(useProjectStore.getState().project, project)
})

test('a bare unmanaged editor route still creates a project', async t => {
  await navigate('editor')
  const { studio } = await mount(t, { managed: false })
  assert.ok(editor(studio, 'studio'))
  assert.equal(useProjectStore.getState().hasOpenProject, true)
  assert.equal(getOpenReelRoute().route, 'editor')
})
