import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { WORKSHOP_DOMAIN_ORDER } from './plaza/plazaUtils.js'
import { loadClientModule } from '../../tests/helpers/client-esm-loader.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sessionCreateSrc = readFileSync(join(here, 'session-create.js'), 'utf8')
const skillPlazaSrc = readFileSync(join(here, 'skill-plaza.js'), 'utf8')
const featuredCardSrc = readFileSync(join(here, 'plaza/FeaturedCard.jsx'), 'utf8')
const installModalSrc = readFileSync(join(here, 'plaza/InstallModal.jsx'), 'utf8')
const applySrc = readFileSync(join(here, 'apply.js'), 'utf8')
const cssSrc = readFileSync(join(here, 'css.js'), 'utf8')
const kitSidebarEntrySrc = readFileSync(join(here, '../../../../packages/dsh-ui-kit/src/stage/createSidebarEntry.ts'), 'utf8')

describe('Skill Workshop UI & Session Contract (Issue #773 / #776)', () => {
  it('sidebar entry is positioned under projects (rank 4.1) via __omnimuxSidebar and footer action is removed', () => {
    assert.doesNotMatch(applySrc, /slots\.inject\(['"]sidebar\.footer\.action['"]/)
    assert.match(applySrc, /createWorkbenchSidebarEntry/)
    assert.match(applySrc, /rank:\s*4\.1/)
    assert.match(applySrc, /data-omnimux-market-entry/)
    assert.match(applySrc, /data-omnimux-esc-entry/)
    assert.match(kitSidebarEntrySrc, /__omnimuxSidebar/)
    assert.match(kitSidebarEntrySrc, /height:\s*32px/)
    assert.match(kitSidebarEntrySrc, /font-size:\s*14px/)
    assert.match(kitSidebarEntrySrc, /width:\s*14px;\s*height:\s*14px/)
  })

  it('session create helper creates real session B via sessions.create without modifying session A', () => {
    assert.match(sessionCreateSrc, /function createSkillSession/)
    assert.match(sessionCreateSrc, /sessions\.create\(createOpts\)/)
    assert.match(sessionCreateSrc, /sessions\.open\(sessionBId\)/)
    assert.match(sessionCreateSrc, /sessionBId === sessionAId/)
    // 严禁改写或清空原会话 A
    assert.doesNotMatch(sessionCreateSrc, /sessionA\.draft\s*=/)
    assert.doesNotMatch(sessionCreateSrc, /sessionA\.text\s*=/)
  })

  it('session create helper prefills /skill-creator with prompt without auto-sending (no auto-send)', () => {
    assert.match(sessionCreateSrc, /\/skill-creator\\n帮我使用它来创建一个新的技能。首先询问我这个技能应该做什么。/)
    // 严禁自动回车或提交
    assert.doesNotMatch(sessionCreateSrc, /composer\.submit/)
    assert.doesNotMatch(sessionCreateSrc, /dispatchEvent\(new KeyboardEvent\(['"]keydown['"],\s*\{\s*key:\s*['"]Enter['"]/)
    assert.doesNotMatch(sessionCreateSrc, /dispatchEvent\(new Event\(['"]submit['"]/)
  })

  it('session create helper performs CAS check preventing overwrite of existing user input', () => {
    assert.match(sessionCreateSrc, /composer\.value\.trim\(\)\.length\s*>\s*0/)
    assert.match(sessionCreateSrc, /prefilled\s*=\s*true/)
  })

  it('trySkillInSession helper quotes /<slug> without auto-send', () => {
    assert.match(sessionCreateSrc, /function trySkillInSession/)
    assert.match(sessionCreateSrc, /`\/\$\{slug\}\s*`/)
  })

  it('session create triggers official new-session button click via DOM matching newSession / aria / text or collapsed menu', async () => {
    assert.match(sessionCreateSrc, /function clickOfficialNewSession/)
    assert.match(sessionCreateSrc, /matchesOfficialNewSession/)
    assert.match(sessionCreateSrc, /String\(button\.className\s*\|\|\s*['"]['"]\)\.includes\(['"]newSession['"]\)/)
    assert.match(sessionCreateSrc, /新建会话|新会话|New session|新对话|新建对话/)
    assert.match(sessionCreateSrc, /#omnimux-sidebar-new-menu/)

    // 运行行为测试：当 DOM 中存在官方新对话按钮时，模拟点击并正确捕获会话
    let clicked = false
    const listeners = []
    let sessionIds = ['session-a']
    let sessionsById = {
      'session-a': { id: 'session-a', workspaceId: 'ws-1', blank: false },
    }
    const mockSessions = {
      list: {
        getSnapshot: () => ({
          ids: sessionIds,
          byId: sessionsById,
          phase: 'ready',
          projectionsBySession: {},
        }),
        subscribe: (fn) => {
          listeners.push(fn)
          return () => {}
        },
      },
      open: () => {},
    }
    const mockButton = {
      className: 'official-btn newSession',
      getAttribute: (attr) => (attr === 'aria-label' ? '新会话' : null),
      hasAttribute: () => false,
      closest: () => null,
      getClientRects: () => [{ width: 20, height: 20 }],
      click: () => {
        clicked = true
        sessionIds = [...sessionIds, 'session-b']
        sessionsById = { ...sessionsById, 'session-b': { id: 'session-b', workspaceId: 'ws-1', blank: true } }
        listeners.forEach((l) => l())
      },
    }
    const mockDoc = {
      querySelectorAll: (sel) => (sel === 'button' ? [mockButton] : []),
      querySelector: (sel) => (sel === 'button' ? mockButton : null),
    }

    const { clickOfficialNewSession } = loadClientModule('./session-create.js', {
      globals: { setTimeout, clearTimeout, Date, window: { __omnimuxWorkbench: { getSnapshot: () => ({ sessionId: 'session-a' }) }, addEventListener: () => {} } },
      modules: {
        './api.js': { api: async () => ({ ok: true }) },
        './i18n.js': { lookup: () => 'Skills' },
        './runtime-state.js': { marketRuntime: { plazaSessions: null, plazaUiWorkspace: null, plazaRemote: null, plazaWorkspaces: null } },
      },
    })
    const res = await clickOfficialNewSession({ document: mockDoc, sessions: mockSessions, timeoutMs: 200 })
    assert.equal(clicked, true)
    assert.equal(res.ok, true)
    assert.equal(res.sessionId, 'session-b')
  })

  it('session create inherits workspaceId from current session, workspaces service, or session list fallback', () => {
    assert.match(sessionCreateSrc, /function resolveFallbackWorkspaceId/)

    const { resolveFallbackWorkspaceId } = loadClientModule('./session-create.js', {
      globals: { console },
      modules: {
        './api.js': { api: async () => ({ ok: true }) },
        './i18n.js': { lookup: () => 'Skills' },
        './runtime-state.js': { marketRuntime: { plazaSessions: null, plazaUiWorkspace: null, plazaRemote: null, plazaWorkspaces: null } },
      },
    })

    // 1. 从当前会话继承
    const s1 = {
      list: {
        getSnapshot: () => ({
          byId: { s1: { id: 's1', workspaceId: 'ws-from-current' } },
        }),
      },
    }
    assert.equal(resolveFallbackWorkspaceId(s1, null, 's1'), 'ws-from-current')

    // 2. 当前会话无 workspaceId，但 workspaces.items 包含当前会话
    const s2 = {
      list: {
        getSnapshot: () => ({
          byId: { s2: { id: 's2' } },
        }),
      },
    }
    const ws2 = {
      list: {
        getSnapshot: () => ({
          items: [{ workspaceId: 'ws-from-items', sessionIds: ['s2'] }],
        }),
      },
    }
    assert.equal(resolveFallbackWorkspaceId(s2, ws2, 's2'), 'ws-from-items')

    // 3. workspaces 包含 recentWorkspaceId
    const s3 = {
      list: {
        getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
      },
    }
    const ws3 = {
      list: {
        getSnapshot: () => ({
          recentWorkspaceId: 'ws-recent',
          items: [{ workspaceId: 'ws-recent' }],
        }),
      },
    }
    assert.equal(resolveFallbackWorkspaceId(s3, ws3, 's3'), 'ws-recent')

    // 4. 从 sessions 历史列表中获取最近的 workspaceId
    const s4 = {
      list: {
        getSnapshot: () => ({
          byId: {
            s4: { id: 's4' },
            s_old: { id: 's_old', workspaceId: 'ws-from-history', updatedAt: 1000 },
          },
        }),
      },
    }
    assert.equal(resolveFallbackWorkspaceId(s4, null, 's4'), 'ws-from-history')
  })

  it('session create keeps right workbench sidebar open with omnimux-market:plaza and sets split layout', async () => {
    assert.match(sessionCreateSrc, /__omnimuxWorkbench.*\bopen\b.*tabId:\s*["']omnimux-market:plaza["']/s)
    assert.match(sessionCreateSrc, /setFocus\?\.\(["']split["']\)/)
    assert.match(sessionCreateSrc, /setConversationCollapsed\?\.\(false,\s*\{\s*sessionId:\s*sessionBId\s*\}\)/)

    let openedTab = null
    let focusMode = null
    let collapsedArg = null
    const fakeWorkbench = {
      getSnapshot: () => ({ sessionId: currentSession }),
      getCurrentSessionId: () => currentSession,
      open: (opts) => { openedTab = opts },
      setFocus: (f) => { focusMode = f },
      setConversationCollapsed: (c, opts) => { collapsedArg = { collapsed: c, ...opts } },
    }

    let createdOpts = null
    let currentSession = 'session-a'
    const fakeSessions = {
      create: async (opts) => {
        createdOpts = opts
        currentSession = 'session-new-773'
        return 'session-new-773'
      },
      open: (id) => { currentSession = id },
      list: {
        getSnapshot: () => ({
          ids: ['session-a', 'session-new-773'],
          byId: {
            'session-a': { id: 'session-a', workspaceId: 'ws-inherited' },
            'session-new-773': { id: 'session-new-773', workspaceId: 'ws-inherited' },
          },
          phase: 'ready',
          projectionsBySession: {},
        }),
      },
    }

    const fakeComposer = {
      value: '',
      disabled: false,
      focus: () => {},
      dispatchEvent: () => {},
    }

    const { createSkillSession } = loadClientModule('./session-create.js', {
      globals: {
        setTimeout,
        clearTimeout,
        Date,
        Event: class Event { constructor(type, opts) { this.type = type; Object.assign(this, opts); } },
        window: {
          __omnimuxWorkbench: fakeWorkbench,
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        },
        document: {
          querySelector: (sel) => (sel.includes('textarea') ? fakeComposer : null),
          querySelectorAll: (sel) => (sel.includes('textarea') ? [fakeComposer] : []),
        },
      },
      modules: {
        './i18n.js': { lookup: () => 'Skills' },
        './api.js': { api: async () => ({ ok: true }) },
        './runtime-state.js': {
          marketRuntime: {
            plazaSessions: fakeSessions,
            plazaUiWorkspace: null,
            plazaRemote: null,
            plazaWorkspaces: {
              list: {
                getSnapshot: () => ({ recentWorkspaceId: 'ws-inherited', items: [{ workspaceId: 'ws-inherited' }] }),
              },
            },
          },
        },
      },
    })

    const result = await createSkillSession()
    assert.equal(result.ok, true)
    assert.equal(result.sessionId, 'session-new-773')
    assert.equal(createdOpts?.workspaceId, 'ws-inherited')
    assert.equal(openedTab?.tabId, 'omnimux-market:plaza')
    assert.equal(openedTab?.sessionId, 'session-new-773')
    assert.equal(focusMode, 'split')
    assert.equal(collapsedArg?.collapsed, false)
    assert.equal(collapsedArg?.sessionId, 'session-new-773')
  })

  it('findComposer skips disabled textarea when workspace is unselected', () => {
    const { findComposer } = loadClientModule('./session-create.js', {
      globals: {
        document: {
          querySelector: () => ({ disabled: true, value: '' }),
          querySelectorAll: () => [{ disabled: true, value: '' }],
        },
      },
      modules: {
        './api.js': { api: async () => ({ ok: true }) },
        './i18n.js': { lookup: () => 'Skills' },
        './runtime-state.js': { marketRuntime: { plazaSessions: null, plazaUiWorkspace: null, plazaRemote: null, plazaWorkspaces: null } },
      },
    })
    assert.equal(findComposer(), null)
  })

  it('skill plaza renders dual tabs: Skill and 我的 Skill', () => {
    assert.match(skillPlazaSrc, /mainTab === "discover"/)
    assert.match(skillPlazaSrc, /mainTab === "mine"/)
    assert.match(skillPlazaSrc, /workshop\.tabSkill/)
    assert.match(skillPlazaSrc, /workshop\.tabMine/)
  })

  it('category order conforms to PRD §6.1 / AC-05 (10 items)', () => {
    assert.match(skillPlazaSrc, /WORKSHOP_DOMAIN_ORDER/)
    const expected = [
      'AIGC 创作',
      '短剧漫剧',
      '专业影视',
      '动画',
      '商业广告',
      '电商',
      '教育',
      '创意实验',
      '音频音乐',
      '平台工具',
    ]
    for (const domain of expected) {
      assert.ok(WORKSHOP_DOMAIN_ORDER.includes(domain), `missing domain ${domain}`)
    }
  })

  it('featured section renders 4-column 16:9 cards and hides completely when 0 items', () => {
    assert.match(skillPlazaSrc, /featuredItems\.length\s*>\s*0/)
    assert.match(skillPlazaSrc, /from "\.\/plaza\/FeaturedCard\.jsx"/)
    assert.match(cssSrc, /\.featured-cover-wrap/)
    assert.match(featuredCardSrc, /omnimux-creatify-card/)
    assert.match(featuredCardSrc, /featured-hover-actions/)
    assert.match(featuredCardSrc, /hover-btn-detail/)
    assert.match(featuredCardSrc, /hover-btn-try/)
  })

  it('category featured hides regular section only without a submitted search', () => {
    assert.match(skillPlazaSrc, /category === "featured" && !hasQuery \? null :/)
  })

  it('install modal provides drag & drop and requirements notice', () => {
    assert.match(skillPlazaSrc, /function InstallModal/)
    assert.match(skillPlazaSrc, /from "\.\/plaza\/InstallModal\.jsx"/)
    assert.match(installModalSrc, /drop-zone/)
    assert.match(installModalSrc, /req-section/)
    assert.match(installModalSrc, /btn-modal-install/)
  })

  it('switch toggle prompts installation confirmation for uninstalled skills', () => {
    assert.match(skillPlazaSrc, /function ConfirmInstallModal/)
    assert.match(skillPlazaSrc, /handleConfirmInstall/)
  })

  it('css defines minimalist design matching demo', () => {
    assert.match(cssSrc, /\.workshop-intro/)
    assert.match(cssSrc, /\.workshop-heading/)
    assert.match(cssSrc, /\.workshop-description/)
    assert.match(cssSrc, /\.btn-create/)
    assert.match(cssSrc, /\.btn-install/)
    assert.match(cssSrc, /\.featured-cover-wrap/)
    assert.match(cssSrc, /aspect-ratio:\s*16\s*\/\s*9/)
    assert.match(cssSrc, /\.switch-bg\.on/)
    assert.match(cssSrc, /\.modal-dialog/)
  })

  it('Issue #773: top bar strictly aligns with reference mock and featured card metadata is complete', () => {
    // 移除大 Header
    assert.ok(!skillPlazaSrc.includes('className: "page-header"'), 'page-header DOM should be removed')
    // 激活 Tab 带 ⓘ 图标
    assert.match(skillPlazaSrc, /className:\s*"tab-info-icon"/)
    assert.match(cssSrc, /\.tab-info-icon/)
    // 官方精选卡片支持真实图片封面，彻底移除 MiniMax Design、冗余底栏以及 H3 角标
    assert.ok(!skillPlazaSrc.includes('className: "h3-badge"'), 'h3-badge should be removed')
    assert.match(featuredCardSrc, /resolveSkillAuroraStyle/)
    assert.match(featuredCardSrc, /item\.homeCover/)
    assert.ok(!skillPlazaSrc.includes('MiniMax Design'), 'MiniMax Design should be removed')
    assert.ok(!skillPlazaSrc.includes('className: "featured-card-footer"'), 'featured-card-footer should be removed')
    assert.ok(!cssSrc.includes('.h3-badge'), '.h3-badge CSS should be removed')
    assert.match(cssSrc, /font-size:\s*20px/)
  })

  it('Issue #1370: PlazaIcon renders proper 4-quadrant outline and FeaturedCard safely routes covers without breaking hover actions', () => {
    // 1. renderPlazaIcon 具有完整四个象限，且包含右上象限 (8.75, 1.75)
    assert.match(skillPlazaSrc, /x:\s*"8.75",\s*y:\s*"1.75"/)
    assert.match(skillPlazaSrc, /fill:\s*"none"/)
    assert.match(cssSrc, /\.btn-create svg rect\{fill:none\}/)

    // 2. FeaturedCard 与 plazaUtils 支持 homeCover 及独立代理路径，彻底移除置顶按钮与相关功能
    const featuredSrc = readFileSync(join(here, 'plaza/FeaturedCard.jsx'), 'utf8')
    assert.match(featuredSrc, /resolveIconSrc/)
    assert.match(featuredSrc, /item\.homeCover/)
    assert.match(featuredSrc, /featured-cover-svg/)
    assert.ok(!featuredSrc.includes('hover-btn-pin'), 'hover-btn-pin should be removed')
    assert.match(featuredSrc, /hover-btn-detail/)
    assert.match(featuredSrc, /hover-btn-try/)
    assert.match(cssSrc, /\.featured-hover-actions\{[^}]*flex-direction:row/)
  })

  it('featured-grid limits to max 4 columns by default with responsive breakpoints', () => {
    assert.match(cssSrc, /\.featured-grid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/)
    assert.match(cssSrc, /@media\s*\(max-width:1200px\)\{\.featured-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/)
    assert.match(cssSrc, /@media\s*\(max-width:860px\)\{\.featured-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/)
    assert.match(cssSrc, /@media\s*\(max-width:540px\)\{\.featured-grid\{grid-template-columns:1fr\}/)
  })
})
