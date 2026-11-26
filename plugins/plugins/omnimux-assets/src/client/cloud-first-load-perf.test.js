/**
 * Issue #324 资产中心「公共 → 全部」首次加载性能行为回归测试：
 * 真实 esbuild 编译 CloudAssetsView / CloudCategoryRow / AssetsStage + JSDOM，
 * 用受控 IntersectionObserver 与 fetch 验证：
 * 1. 不再发出行布局下无用的 `all/page-0000.json`；
 * 2. 首屏仅前 2 行（角色/场景）立即拉取，第 3–6 行离屏挂起且不发请求、不挂载 <video>；
 * 3. 单行初始仅渲染 10 张卡，首屏角色前 7 张带 eager + fetchpriority="high"，点右箭头展开至 24 张；
 * 4. 滚动进入素材行后，24 张无封面 MP4 卡片经全局队列限流最多 3 路并发 load()，释放后依次补位；
 * 5. 有封面视频卡非悬停态不挂载 <video>，悬停后挂载；
 * 6. manifest 加载中展示 2 行骨架屏（无空白闪屏）；`ensureCloudPreconnect` 幂等注入。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRequire = createRequire(join(here, '..', '..', 'package.json'))
const { JSDOM } = pluginRequire('jsdom')

function createMockObserverController() {
  const entries = new Map()
  class MockIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.targets = new Set()
    }
    observe(node) {
      this.targets.add(node)
      entries.set(node, this)
    }
    unobserve(node) {
      this.targets.delete(node)
      entries.delete(node)
    }
    disconnect() {
      for (const node of this.targets) entries.delete(node)
      this.targets.clear()
    }
  }
  function trigger(node) {
    const obs = entries.get(node)
    if (!obs) return false
    obs.callback([{ target: node, isIntersecting: true }])
    return true
  }
  return { MockIntersectionObserver, trigger, entries }
}

function installDom(observerController) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
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
  globalThis.IntersectionObserver = observerController.MockIntersectionObserver
  window.IntersectionObserver = observerController.MockIntersectionObserver
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const loadCalls = []
  const playCalls = []
  const pauseCalls = []
  const proto = window.HTMLMediaElement.prototype
  const currents = new WeakMap()
  Object.defineProperty(proto, 'currentTime', {
    configurable: true,
    get() { return currents.get(this) ?? 0 },
    set(value) { currents.set(this, Number(value) || 0) },
  })
  proto.load = function load() {
    loadCalls.push(this.getAttribute('src') || '')
  }
  proto.play = function play() {
    playCalls.push(this.getAttribute('src') || '')
    return Promise.resolve()
  }
  proto.pause = function pause() {
    pauseCalls.push(this.getAttribute('src') || '')
  }
  window.HTMLElement.prototype.scrollBy = function scrollBy() {}

  return { window, loadCalls, playCalls, pauseCalls }
}

async function bundleModule(relPath) {
  const esbuild = pluginRequire('esbuild')
  const result = await esbuild.build({
    entryPoints: [join(here, relPath)],
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

function buildManifestFixture() {
  return {
    version: 1,
    pageSize: 24,
    totalAssets: 144,
    categories: [
      { id: 'character', zh: '角色', en: 'Characters', total: 48, pages: 18, sub_categories: [] },
      { id: 'scene', zh: '场景', en: 'Scenes', total: 48, pages: 142, sub_categories: [] },
      { id: 'prop', zh: '道具', en: 'Props', total: 48, pages: 40, sub_categories: [] },
      { id: 'material', zh: '素材', en: 'Material', total: 48, pages: 36, sub_categories: [] },
      { id: 'style', zh: '风格', en: 'Styles', total: 48, pages: 7, sub_categories: [] },
      {
        id: 'audio',
        zh: '声音',
        en: 'Audio',
        total: 48,
        pages: 26,
        sub_categories: [
          { id: 'bgm', zh: '背景音', en: 'BGM', total: 40, pages: 5 },
          { id: 'sfx', zh: '音效', en: 'SFX', total: 8, pages: 1 },
        ],
      },
    ],
  }
}

function buildPageItems(scope, page) {
  return Array.from({ length: 24 }, (_, idx) => {
    const id = `${scope.replace('/', '-')}-p${page}-${idx}`
    if (scope === 'material') {
      return {
        id,
        category: 'material',
        sub_category: 'hook',
        name: `Hook Video ${page}-${idx}`,
        description: '无封面钩子视频',
        media_type: 'video',
        cover_url: '',
        media_url: `https://assets.omnimux.ai/elements/hooks/${id}.mp4`,
        tags: [],
      }
    }
    if (scope === 'character') {
      return {
        id,
        category: 'character',
        sub_category: 'digital-human',
        name: `Avatar ${page}-${idx}`,
        description: '数字人',
        media_type: 'video',
        cover_url: `https://assets.omnimux.ai/public-avatars/${id}.jpg`,
        thumb_url: `https://assets.omnimux.ai/thumbs/${id}.webp`,
        media_url: `https://assets.omnimux.ai/public-avatars/${id}.mp4`,
        tags: [],
      }
    }
    if (scope.startsWith('audio/')) {
      return {
        id,
        category: 'audio',
        sub_category: scope.split('/')[1],
        name: `Track ${page}-${idx}`,
        description: '可播音频',
        media_type: 'audio',
        cover_url: '',
        media_url: `https://assets.omnimux.ai/audio/${id}.mp3`,
        tags: [],
      }
    }
    return {
      id,
      category: scope,
      sub_category: 'default',
      name: `${scope} ${page}-${idx}`,
      description: '素材描述',
      media_type: 'image',
      cover_url: `https://assets.omnimux.ai/${scope}/${id}.jpg`,
      media_url: `https://assets.omnimux.ai/${scope}/${id}.jpg`,
      tags: [],
    }
  })
}

test('公共 → 全部首屏性能契约：零无用 all/page-0、离屏行不发请求、横向 10→24 展开、无封面视频限流 3 路与悬停挂载', async () => {
  const observerCtrl = createMockObserverController()
  const { window, loadCalls, playCalls, pauseCalls } = installDom(observerCtrl)
  const React = pluginRequire('react')
  const { createRoot } = pluginRequire('react-dom/client')

  // Bundle CloudAssetsView with fresh module state (includes globalShuffleCache / bareVideoQueue / manifestCache)
  const viewMod = await bundleModule('CloudAssetsView.jsx')
  const { CloudAssetsView, CloudAssetCard } = viewMod
  const manifest = buildManifestFixture()

  const requestedUrls = []
  let resolveManifest = null
  const manifestGate = new Promise((r) => { resolveManifest = r })
  globalThis.fetch = async (url) => {
    const str = String(url)
    requestedUrls.push(str)
    if (str.endsWith('/manifest.json')) {
      await manifestGate
      return { ok: true, status: 200, json: async () => manifest }
    }
    const match = /\/omnimux\/assets\/cloud\/(.+)\/page-(\d+)\.json$/.exec(str)
    if (match) {
      const scope = decodeURIComponent(match[1])
      const page = Number(match[2])
      return {
        ok: true,
        status: 200,
        json: async () => ({
          scope,
          page,
          pageSize: 24,
          total: 240,
          totalPages: 18,
          items: buildPageItems(scope, page),
        }),
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not-found' }) }
  }

  const t = (key) => key
  const container = window.document.getElementById('root')
  const root = createRoot(container)

  // 1. manifest 尚未返回时必须立刻展示 2 行骨架占位，而不是空白 div
  await React.act(async () => {
    root.render(React.createElement(CloudAssetsView, { t, open: true }))
  })
  const skeletonRoot = container.querySelector('.omnimux-assets-cloud-rows-scroll[data-skeleton="true"]')
  assert.ok(skeletonRoot, 'manifest 加载期间必须渲染骨架容器而非空白闪屏')
  assert.equal(skeletonRoot.querySelectorAll('.omnimux-assets-cloud-row-section').length, 2)

  // 2. 放行 manifest，等待首屏前 2 行并行拉取落盘
  await React.act(async () => {
    resolveManifest()
    await new Promise((r) => setTimeout(r, 30))
  })

  // 断言 A：绝不请求行布局下无用的 all/page-0000.json
  assert.equal(
    requestedUrls.some((u) => u.includes('/all/page-')),
    false,
    `行布局不得请求 all/page-*，实际请求：${requestedUrls.join(', ')}`,
  )

  // 断言 B：离屏第 3–6 行（prop/material/style/audio）未进入视口前绝不发任何请求
  for (const deferred of ['prop', 'material', 'style', 'audio']) {
    assert.equal(
      requestedUrls.some((u) => u.includes(`/cloud/${deferred}/`)),
      false,
      `离屏分类 ${deferred} 首屏不应发分片请求`,
    )
    const sec = container.querySelector(`section[data-category="${deferred}"]`)
    assert.equal(sec?.getAttribute('data-activated'), 'false', `${deferred} 行应处于未激活态`)
  }

  // 断言 C：首屏 2 行每行仅初始渲染 10 张卡，且角色行有封面视频非悬停态不挂载 <video>
  const charSection = container.querySelector('section[data-category="character"]')
  const sceneSection = container.querySelector('section[data-category="scene"]')
  assert.equal(charSection.getAttribute('data-activated'), 'true')
  assert.equal(sceneSection.getAttribute('data-activated'), 'true')
  assert.equal(charSection.querySelectorAll('.omnimux-assets-cloud-card').length, 10, '角色行初始仅渲染 10 张卡')
  assert.equal(sceneSection.querySelectorAll('.omnimux-assets-cloud-card').length, 10, '场景行初始仅渲染 10 张卡')
  assert.equal(charSection.querySelectorAll('video').length, 0, '有封面视频卡在非悬停态不得预先挂载空闲 <video>')
  assert.equal(loadCalls.length, 0, '首屏未滚到素材行前，离屏 MP4 load() 必须为 0')

  // 断言 D：角色行前 7 张可见封面设 eager + fetchpriority=high + decoding=async，后 3 张为 lazy
  const charImgs = [...charSection.querySelectorAll('img.omnimux-assets-card-media')]
  assert.equal(charImgs.length, 10)
  for (let i = 0; i < 7; i += 1) {
    assert.equal(charImgs[i].getAttribute('loading'), 'eager', `首屏角色第 ${i + 1} 张应为 eager`)
    assert.equal(charImgs[i].getAttribute('fetchpriority'), 'high', `首屏角色第 ${i + 1} 张应为 fetchpriority=high`)
    assert.equal(charImgs[i].getAttribute('decoding'), 'async')
  }
  for (let i = 7; i < 10; i += 1) {
    assert.equal(charImgs[i].getAttribute('loading'), 'lazy', `缓冲角色第 ${i + 1} 张应保持 lazy`)
    assert.equal(charImgs[i].getAttribute('fetchpriority'), null)
  }

  // 断言 E：点击右箭头后角色行从 10 张无缝展开至 24 张
  const rightArrow = charSection.querySelector('.omnimux-assets-cloud-row-arrow--right')
  assert.ok(rightArrow, '有未展开卡片时必须显示右翻页箭头')
  await React.act(async () => {
    rightArrow.click()
  })
  assert.equal(charSection.querySelectorAll('.omnimux-assets-cloud-card').length, 24, '点击右箭头后应展开全部 24 张卡')

  // 断言 F：滚动激活第 4 行「素材」（无封面视频）后，并发 load() 严格受限 ≤ 3 路
  const materialSection = container.querySelector('section[data-category="material"]')
  await React.act(async () => {
    observerCtrl.trigger(materialSection)
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.equal(materialSection.getAttribute('data-activated'), 'true')
  const materialVideos = [...materialSection.querySelectorAll('video.omnimux-assets-cloud-preview--bare')]
  assert.equal(materialVideos.length, 10, '素材行激活后先挂前 10 张卡')
  // 激活前 6 个视频进入视口，队列应只放行前 3 个加载
  await React.act(async () => {
    for (let i = 0; i < 6; i += 1) observerCtrl.trigger(materialVideos[i])
  })
  const loadedBeforeRelease = materialVideos.filter((v) => v.getAttribute('src'))
  assert.equal(loadedBeforeRelease.length, 3, '并发无封面视频加载不得超过 3 路')
  assert.equal(loadCalls.length, 3, '仅前 3 路调用了 video.load()')

  // 释放第 1 路（触发 loadedmetadata）后，队列自动放行第 4 路
  await React.act(async () => {
    loadedBeforeRelease[0].dispatchEvent(new window.Event('loadedmetadata', { bubbles: false }))
  })
  assert.equal(
    materialVideos.filter((v) => v.getAttribute('src')).length,
    4,
    '前一路元数据就绪后必须自动放行排队中的下一路视频',
  )

  // 断言 G：有封面视频卡在鼠标悬停时按需挂载 <video>，移出后卸载并调用 pause() + 清 src 中止拉流
  const hoverRoot = window.document.createElement('div')
  window.document.body.appendChild(hoverRoot)
  const cardRoot = createRoot(hoverRoot)
  const coveredVideoAsset = {
    id: 'character-hover-test',
    name: 'Hover Avatar',
    description: '',
    mediaType: 'video',
    hasCover: true,
    hasMedia: true,
    thumbUrl: 'https://assets.omnimux.ai/thumbs/character-hover-test.webp',
    coverUrl: 'https://assets.omnimux.ai/public-avatars/hover.jpg',
    playable: true,
  }
  await React.act(async () => {
    cardRoot.render(React.createElement(CloudAssetCard, {
      asset: coveredVideoAsset,
      t,
      playing: false,
      onTogglePlay: () => {},
      onPreview: () => {},
    }))
  })
  assert.equal(hoverRoot.querySelector('video'), null, '非悬停态不挂载 <video>')
  const cardEl = hoverRoot.querySelector('.omnimux-assets-cloud-card')
  const playsBeforeHover = playCalls.length
  const pausesBeforeLeave = pauseCalls.length
  const loadsBeforeLeave = loadCalls.length
  await React.act(async () => {
    cardEl.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
  })
  const mountedVideo = hoverRoot.querySelector('video.omnimux-assets-cloud-preview')
  assert.ok(mountedVideo, '悬停后必须挂载预览 <video>')
  assert.equal(playCalls.length, playsBeforeHover + 1, '悬停后应触发 play()')

  await React.act(async () => {
    cardEl.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }))
  })
  assert.equal(hoverRoot.querySelector('video'), null, '鼠标移出后必须卸载预览 <video>')
  assert.equal(pauseCalls.length, pausesBeforeLeave + 1, '卸载前 cleanup 必须调用 pause()')
  assert.equal(mountedVideo.getAttribute('src'), null, '卸载前 cleanup 必须移除 src 中止下载')
  assert.equal(loadCalls.length, loadsBeforeLeave + 1, '移除 src 后调用 load() 重置媒体管线')

  // 断言 H：排队中的无封面视频悬停时不得对无 src 节点调 play()；放行后立即开始播放
  const queuedVideo = materialVideos[4]
  assert.equal(queuedVideo.getAttribute('src'), null, '第 5 路仍在队列等待中')
  const queuedCard = queuedVideo.closest('.omnimux-assets-cloud-card')
  const playsBeforeQueuedHover = playCalls.length
  await React.act(async () => {
    queuedCard.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
  })
  assert.equal(playCalls.length, playsBeforeQueuedHover, '排队无 src 态悬停不得误调 play()')
  await React.act(async () => {
    loadedBeforeRelease[1].dispatchEvent(new window.Event('loadedmetadata', { bubbles: false }))
  })
  assert.ok(queuedVideo.getAttribute('src'), '前序释放后第 5 路获得槽位并写入 src')
  assert.equal(playCalls.length, playsBeforeQueuedHover + 1, '仍在悬停的排队视频获槽后应自动开播')

  // 断言 I：在「公共 → 全部」键入搜索词防抖窗口内不得误发 all/page-0000.json，且展示骨架而非空态
  const reqCountBeforeSearch = requestedUrls.length
  await React.act(async () => {
    root.render(React.createElement(CloudAssetsView, { t, open: true, query: 'hero' }))
  })
  assert.equal(
    requestedUrls.slice(reqCountBeforeSearch).some((u) => u.includes('/all/page-')),
    false,
    '输入搜索词防抖期间不得发出 all/page-0000.json',
  )
  assert.ok(
    container.querySelector('[data-skeleton="true"]'),
    '搜索防抖期间应展示骨架屏，不得闪现空状态',
  )

  await React.act(async () => {
    cardRoot.unmount()
    root.unmount()
  })
})

test('CloudTileMedia 切换 asset.id 与 broken=true 时不泄漏旧视口状态或占用并发槽位', async () => {
  const observerCtrl = createMockObserverController()
  const { window } = installDom(observerCtrl)
  const React = pluginRequire('react')
  const { createRoot } = pluginRequire('react-dom/client')
  const { CloudTileMedia } = await bundleModule('CloudAssetsView.jsx')

  const container = window.document.getElementById('root')
  const root = createRoot(container)
  const bareA = { id: 'bare-a', mediaType: 'video', hasCover: false, hasMedia: true, coverUrl: '', thumbUrl: '' }
  const bareB = { id: 'bare-b', mediaType: 'video', hasCover: false, hasMedia: true, coverUrl: '', thumbUrl: '' }

  await React.act(async () => {
    root.render(React.createElement(CloudTileMedia, { asset: bareA, broken: false, onBroken: () => {}, hovering: false }))
  })
  const videoA = container.querySelector('video')
  await React.act(async () => { observerCtrl.trigger(videoA) })
  assert.ok(videoA.getAttribute('src')?.includes('bare-a'), 'bareA 进入视口后获槽')

  // 原位切换为 offscreen 的 bareB：首帧即重置视口态，未触发新 observer 前不得获得 src
  await React.act(async () => {
    root.render(React.createElement(CloudTileMedia, { asset: bareB, broken: false, onBroken: () => {}, hovering: false }))
  })
  const videoB = container.querySelector('video')
  assert.equal(videoB.getAttribute('src'), null, '切换 asset.id 后未进入视口的 bareB 不得继承旧 bareVisible 获得 src')

  // broken=true 时不挂载 video 且不得触发 observer 兜底放行
  await React.act(async () => {
    root.render(React.createElement(CloudTileMedia, { asset: bareB, broken: true, onBroken: () => {}, hovering: false }))
  })
  assert.equal(container.querySelector('video'), null)
  await React.act(async () => {
    root.render(React.createElement(CloudTileMedia, { asset: bareB, broken: false, onBroken: () => {}, hovering: false }))
  })
  assert.equal(container.querySelector('video').getAttribute('src'), null, 'broken 期间不得通过 !node 兜底偷设 bareVisible=true')

  await React.act(async () => { root.unmount() })
})

test('useCloudManifest 冷启动首帧 loading=true、force 走 cache:no-cache 且旧预热不覆盖新刷新', async () => {
  const observerCtrl = createMockObserverController()
  const { window } = installDom(observerCtrl)
  const React = pluginRequire('react')
  const { createRoot } = pluginRequire('react-dom/client')
  const manifestMod = await bundleModule('use-cloud-manifest.js')
  const {
    clearCloudManifestCache,
    fetchCloudManifestCached,
    prefetchCloudManifest,
    useCloudManifest,
  } = manifestMod

  clearCloudManifestCache()
  const fetchCalls = []
  let resolveSlow = null
  let resolveFast = null
  let callIndex = 0
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init })
    callIndex += 1
    if (callIndex === 1) {
      await new Promise((r) => { resolveSlow = r })
      return { ok: true, status: 200, json: async () => ({ version: 1, tag: 'stale-prefetch', categories: [] }) }
    }
    await new Promise((r) => { resolveFast = r })
    return { ok: true, status: 200, json: async () => ({ version: 2, tag: 'fresh-force', categories: [] }) }
  }

  // 1. 慢预热 + 快 force 刷新乱序返回：慢预热不得回写覆盖 fresh-force 缓存
  const slowPromise = prefetchCloudManifest()
  const fastPromise = fetchCloudManifestCached({ force: true })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(fetchCalls.length, 2)
  assert.equal(fetchCalls[1].init?.cache, 'no-cache', 'force 刷新必须传 cache: no-cache 绕过 1h 私有缓存')
  resolveFast()
  const fastRes = await fastPromise
  assert.equal(fastRes.body.tag, 'fresh-force')
  resolveSlow()
  await slowPromise
  const cached = await fetchCloudManifestCached({ force: false })
  assert.equal(cached.body.tag, 'fresh-force', '旧预热晚返回不得覆盖新 force 刷新的缓存')

  // 2. 冷启动首帧（effect 运行前）useCloudManifest 同步返回 loading=true，避免 1 帧空渲染
  clearCloudManifestCache()
  let resolveCold = null
  globalThis.fetch = async () => {
    await new Promise((r) => { resolveCold = r })
    return { ok: true, status: 200, json: async () => ({ version: 3, categories: [] }) }
  }
  const renderSnapshots = []
  function Probe() {
    const state = useCloudManifest({ enabled: true })
    renderSnapshots.push({ loading: state.loading, hasManifest: state.manifest !== null })
    return null
  }
  const container = window.document.getElementById('root')
  const root = createRoot(container)
  await React.act(async () => {
    root.render(React.createElement(Probe))
  })
  assert.equal(renderSnapshots[0].loading, true, '冷启动首帧 loading 必须立即为 true')
  assert.equal(renderSnapshots[0].hasManifest, false)
  await React.act(async () => {
    resolveCold()
    await new Promise((r) => setTimeout(r, 10))
  })
  assert.equal(renderSnapshots.at(-1).loading, false)
  assert.equal(renderSnapshots.at(-1).hasManifest, true)

  await React.act(async () => { root.unmount() })
})

test('useCloudManifest 预热在首帧与 effect 之间命中缓存时仍正确退出 loading，且 cloudSearch 抛错不卡无限骨架', async () => {
  const observerCtrl = createMockObserverController()
  const { window } = installDom(observerCtrl)
  const React = pluginRequire('react')
  const { createRoot } = pluginRequire('react-dom/client')
  const manifestMod = await bundleModule('use-cloud-manifest.js')
  const { clearCloudManifestCache, fetchCloudManifestCached, useCloudManifest } = manifestMod

  // 1. 冷启动首帧（loading=true）期间后台预热恰好填满缓存，随后 effect 命中缓存早返回时必须将 loading 置回 false。
  clearCloudManifestCache()
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 4, categories: [{ id: 'character', zh: '角色', en: 'Characters', total: 1, pages: 1, sub_categories: [] }] }),
  })
  const snapshots = []
  let filledBetweenRenderAndEffect = false
  function RaceProbe() {
    const state = useCloudManifest({ enabled: true })
    snapshots.push({ loading: state.loading, hasManifest: state.manifest !== null })
    if (!filledBetweenRenderAndEffect) {
      filledBetweenRenderAndEffect = true
      void fetchCloudManifestCached({ force: false })
    }
    return null
  }
  const container = window.document.getElementById('root')
  const root = createRoot(container)
  await React.act(async () => {
    root.render(React.createElement(RaceProbe))
  })
  await React.act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
  assert.equal(snapshots[0].loading, true, '首帧在缓存未落盘时应为 loading=true')
  assert.equal(snapshots.at(-1).hasManifest, true, '命中预热缓存后应拿到 manifest')
  assert.equal(snapshots.at(-1).loading, false, '命中缓存早返回也必须把 loading 置回 false，不能永久卡骨架')
  await React.act(async () => { root.unmount() })

  // 2. cloudSearch 网络抛错时必须展示错误态并退出 loading，绝不留无限骨架。
  const viewMod = await bundleModule('CloudAssetsView.jsx')
  const { CloudAssetsView } = viewMod
  const manifest = buildManifestFixture()
  globalThis.fetch = async (url) => {
    const str = String(url)
    if (str.endsWith('/manifest.json')) {
      return { ok: true, status: 200, json: async () => manifest }
    }
    if (str.includes('/cloud/search')) {
      throw new Error('simulated network failure')
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ scope: 'character', page: 0, pageSize: 24, total: 24, totalPages: 1, items: buildPageItems('character', 0) }),
    }
  }
  const t = (key) => key
  const root2 = createRoot(container)
  await React.act(async () => {
    root2.render(React.createElement(CloudAssetsView, { t, open: true, query: 'boom' }))
  })
  assert.ok(container.querySelector('[data-skeleton="true"]'), '搜索防抖期间应先展示骨架')
  await React.act(async () => {
    await new Promise((r) => setTimeout(r, 340))
  })
  assert.equal(container.querySelector('[data-skeleton="true"]'), null, 'cloudSearch 抛错后不得留在无限骨架 loading 态')
  assert.match(container.querySelector('.omnimux-assets-error')?.textContent ?? '', /simulated network failure/)
  await React.act(async () => { root2.unmount() })
})

test('ensureCloudPreconnect 幂等注入 preconnect 与 dns-prefetch', async () => {
  const observerCtrl = createMockObserverController()
  const { window } = installDom(observerCtrl)
  const { ensureCloudPreconnect, CLOUD_ASSETS_ORIGIN } = await bundleModule('AssetsStage.jsx')
  ensureCloudPreconnect(window.document)
  ensureCloudPreconnect(window.document)
  assert.equal(
    window.document.head.querySelectorAll(`link[rel="preconnect"][href="${CLOUD_ASSETS_ORIGIN}"]`).length,
    1,
  )
  assert.equal(
    window.document.head.querySelectorAll(`link[rel="dns-prefetch"][href="${CLOUD_ASSETS_ORIGIN}"]`).length,
    1,
  )
})
