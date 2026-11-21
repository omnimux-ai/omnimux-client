/**
 * 无封面视频卡的运行时契约：首帧是卡片门面。
 *
 * 数据（material/hook）只有 MP4，没有 cover_url / thumb_url。卡片必须：
 * 1. 不为不存在的封面发 `<img>` 请求；
 * 2. 让视频本身进入文档流（几何测量见 cloud-bare-video-card.e2e.test.js）；
 * 3. 元数据到达后 seek 到首帧并把真实宽高比写进缓存，供下一次瀑布流估算。
 *
 * 真实 CloudAssetCard + esbuild bundle + JSDOM；媒体元素的网络/解码行为用
 * 受控桩替代，避免把 jsdom 不支持的能力当成产品行为。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRequire = createRequire(join(here, '..', '..', 'package.json'))
const { JSDOM } = pluginRequire('jsdom')

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
  globalThis.HTMLElement = window.HTMLElement
  globalThis.Node = window.Node
  globalThis.Event = window.Event
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return window
}

function stubMediaElement(window) {
  const proto = window.HTMLMediaElement.prototype
  const currents = new WeakMap()
  Object.defineProperty(proto, 'currentTime', {
    configurable: true,
    get() { return currents.get(this) ?? 0 },
    set(value) { currents.set(this, Number(value) || 0) },
  })
  proto.load = function load() {}
  proto.play = function play() { return Promise.resolve() }
  proto.pause = function pause() {}
}

async function loadView() {
  const esbuild = pluginRequire('esbuild')
  const result = await esbuild.build({
    entryPoints: [join(here, 'CloudAssetsView.jsx')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    plugins: [
      {
        name: 'stub-assets',
        setup(build) {
          build.onResolve({ filter: /\.(css|less|scss|woff|woff2|ttf|png|jpg|jpeg|webp|svg|mp3|mp4)$/ }, (args) => ({ path: args.path, namespace: 'stub-assets' }))
          build.onLoad({ filter: /./, namespace: 'stub-assets' }, () => ({ contents: 'module.exports = {}', loader: 'js' }))
        },
      },
    ],
  })
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(pluginRequire, mod, mod.exports)
  return mod.exports
}

test('无封面视频卡：不发封面图请求，元数据到达后 seek 首帧并采用真实比例', async () => {
  const window = installDom()
  stubMediaElement(window)
  const React = pluginRequire('react')
  const { createRoot } = pluginRequire('react-dom/client')
  const { CloudAssetCard } = await loadView()
  const asset = {
    id: 'material-hook-behavior',
    name: 'Woman Activity',
    description: '短视频前 3 秒开场钩子素材',
    mediaType: 'video',
    hasCover: false,
    hasMedia: true,
    thumbUrl: '',
    coverUrl: '',
    playable: true,
  }
  const t = (key) => key
  const container = window.document.getElementById('root')
  const root = createRoot(container)
  function Probe() {
    return React.createElement(CloudAssetCard, {
      asset,
      t,
      playing: false,
      onTogglePlay: () => {},
      onPreview: () => {},
    })
  }

  await React.act(async () => { root.render(React.createElement(Probe)) })
  const card = container.querySelector('.omnimux-assets-cloud-card')
  assert.ok(card, 'card renders')
  assert.equal(container.querySelector('img'), null, 'no cover means no image request')
  const video = container.querySelector('video')
  assert.ok(video, 'bare clip is mounted')
  assert.match(video.className, /omnimux-assets-cloud-preview--bare/)
  assert.equal(video.getAttribute('width'), '9')
  assert.equal(video.getAttribute('height'), '16')

  // Metadata + first frame dimension. jsdom does not decode media; this is the seam
  // the browser fires after `preload=metadata` has read the MP4 header.
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1080 })
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1920 })
  await React.act(async () => {
    video.dispatchEvent(new window.Event('loadedmetadata', { bubbles: false }))
  })
  assert.equal(video.getAttribute('width'), '1080', 'real frame width adopted')
  assert.equal(video.getAttribute('height'), '1920', 'real frame height adopted')
  assert.ok(video.currentTime >= 0.001, `first frame seek applied, got ${video.currentTime}`)

  await React.act(async () => { root.unmount() })
})
