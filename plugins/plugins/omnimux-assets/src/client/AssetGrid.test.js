import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { zh, en } from './locales.js'

const here = dirname(fileURLToPath(import.meta.url))
const gridJsx = readFileSync(join(here, 'AssetGrid.jsx'), 'utf8')
const stageJsx = readFileSync(join(here, 'AssetsStage.jsx'), 'utf8')
const browseJsx = readFileSync(join(here, 'AssetBrowse.jsx'), 'utf8')
const stylesJs = readFileSync(join(here, 'styles.js'), 'utf8')

describe('AssetGrid 16:10 horizontal tray and restrained card actions contract', () => {
  it('implements image, video, upload-progress, and icon plinth fallbacks without legacy 9x16 img attrs', () => {
    assert.match(gridJsx, /import\s+.*previewUrl.*from '\.\/api\.js'/)
    assert.match(gridJsx, /import\s+.*pickCoverFile.*isVideoFile.*from '\.\/add-to-chat\.js'/)
    assert.match(gridJsx, /<img[\s\S]*?className="omnimux-assets-card-media"[\s\S]*?onError=/)
    assert.doesNotMatch(gridJsx, /width=\{9\}[\s\S]*?height=\{16\}/)
    assert.doesNotMatch(browseJsx, /width=\{9\}[\s\S]*?height=\{16\}/)
    assert.match(gridJsx, /<video[\s\S]*?className="omnimux-assets-card-video"/)
    assert.match(gridJsx, /className="omnimux-assets-card-progress"/)
    assert.match(gridJsx, /className="omnimux-assets-card-placeholder"/)
    assert.match(gridJsx, /<FallbackIcon\s+size=\{22\}\s*\/>/)
  })

  it('provides restrained corner quick-add and title-row ellipsis menu without blurred hover overlay', () => {
    // No full-screen blurred hover overlay
    assert.doesNotMatch(gridJsx, /omnimux-assets-card-overlay/)
    assert.doesNotMatch(stylesJs, /\.omnimux-assets-card-overlay\b/)
    // Top-right corner quick-add beside type badge
    assert.match(gridJsx, /className="omnimux-assets-card-corner"/)
    assert.match(gridJsx, /className="omnimux-assets-quick-add"/)
    assert.match(gridJsx, /disabled=\{added\}/)
    // Title row right-side ellipsis Menu with view / add / reveal / remove
    assert.match(gridJsx, /import\s+\{\s*Menu\s*\}\s+from '@deepseek-ai\/dsh-client-ui-primitives'/)
    assert.match(gridJsx, /className="omnimux-assets-card-head"/)
    assert.match(gridJsx, /className="omnimux-assets-card-more-btn"/)
    assert.match(gridJsx, /id:\s*'view',\s*label:\s*t\('card\.view'\)/)
    assert.match(gridJsx, /id:\s*'add'[\s\S]*?t\('card\.addToConversation'\)/)
    assert.match(gridJsx, /id:\s*'reveal',\s*label:\s*t\('browse\.revealLocation'\)/)
    assert.match(gridJsx, /id:\s*'remove',\s*label:\s*t\('mapping\.remove'\)/)
    // Uses official UI kit primitives, never raw <button>
    assert.match(gridJsx, /<MediaCard\b/)
    assert.match(gridJsx, /<Table\b/)
    assert.doesNotMatch(gridJsx, /<button\b/)
  })

  it('implements View and AddToConversation buttons in list row actions', () => {
    assert.match(gridJsx, /className="omnimux-assets-list-actions"/)
    assert.match(stylesJs, /\.omnimux-assets-list-actions\s*\{/)
    assert.match(gridJsx, /\{t\('card\.view'\)\}/)
    assert.match(gridJsx, /\{added \? t\('card\.addedToConversation'\) : t\('card\.addToConversation'\)\}/)
    assert.doesNotMatch(gridJsx, /\{t\('card\.copyCite'\)\}/)
  })

  it('implements dual-track branching for folder vs single media assets', () => {
    assert.match(gridJsx, /import\s+.*isFolderAsset.*resolveAssetMediaPreview.*from '\.\/asset-routing\.js'/)
    assert.match(gridJsx, /if\s*\(isFolderAsset\(asset\)\)\s*\{[\s\S]*?onOpen\(asset\)/)
    assert.match(gridJsx, /onPreview\(resolveAssetMediaPreview\(asset\)\)/)
  })

  it('contains complete i18n locales for card actions in zh and en', () => {
    assert.equal(zh['card.view'], '查看详情')
    assert.equal(zh['card.addToConversation'], '添加到会话')
    assert.equal(zh['card.addedToConversation'], '已添加')
    assert.equal(zh['card.actions'], '操作')

    assert.equal(en['card.view'], 'View Details')
    assert.equal(en['card.addToConversation'], 'Add to Chat')
    assert.equal(en['card.addedToConversation'], 'Added')
    assert.equal(en['card.actions'], 'Actions')
  })

  it('AssetsStage routes list and grid view cleanly through AssetGrid without raw inputs', () => {
    assert.doesNotMatch(stageJsx, /AssetsTableView/)
    assert.doesNotMatch(stageJsx, /<input\b/)
    assert.match(stageJsx, /<AssetGrid\b/)
  })

  it('conforms to 16:10 equal-height horizontal tray grid and unified contain presentation', () => {
    // Standard CSS Grid instead of MasonryGrid + 3:4 aspectRatio
    assert.doesNotMatch(gridJsx, /MasonryGrid/)
    assert.doesNotMatch(gridJsx, /aspectRatio="3:4"/)
    assert.match(gridJsx, /className="omnimux-assets-local-grid"/)
    assert.match(browseJsx, /className="omnimux-assets-local-grid"/)
    // Relative time subtitle preserved
    assert.match(gridJsx, /import\s+.*formatTimeAgo.*from '\.\/format\.js'/)
    assert.match(gridJsx, /const timeText = formatTimeAgo\(asset\.created_at \|\| asset\.createdAt \|\| asset\.updated_at\)/)
    assert.match(gridJsx, /subtitle=\{timeText \|\| '—'\}/)
    // Stylesheet enforces 16:10 tray + padding 8px + unified contain + 8px media radius
    assert.match(stylesJs, /\.omnimux-assets-local-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(220px,\s*1fr\)\);/)
    assert.match(stylesJs, /\.omnimux-assets-card:not\(\.omnimux-assets-cloud-card\)\s+\.omnimux-assets-card-thumb[\s\S]*?\{[\s\S]*?aspect-ratio:\s*16\s*\/\s*10;/)
    assert.match(stylesJs, /\.omnimux-assets-card:not\(\.omnimux-assets-cloud-card\)\s+\.omnimux-assets-card-thumb[\s\S]*?\{[\s\S]*?padding:\s*8px;/)
    assert.match(stylesJs, /\.omnimux-assets-card:not\(\.omnimux-assets-cloud-card\)\s+\.omnimux-assets-card-thumb[\s\S]*?\{[\s\S]*?border-radius:\s*12px;/)
    assert.match(stylesJs, /\.omnimux-assets-card:not\(\.omnimux-assets-cloud-card\)\s+\.omnimux-assets-card-media,[\s\S]*?object-fit:\s*contain;/)
    assert.match(stylesJs, /\.omnimux-assets-card:not\(\.omnimux-assets-cloud-card\)\s+\.omnimux-assets-card-media,[\s\S]*?border-radius:\s*8px;/)
    assert.doesNotMatch(stylesJs, /\.omnimux-assets-card--character:not\(\.omnimux-assets-cloud-card\)\s+\.omnimux-assets-card-media[\s\S]*?object-fit:\s*cover;/)
  })
})
