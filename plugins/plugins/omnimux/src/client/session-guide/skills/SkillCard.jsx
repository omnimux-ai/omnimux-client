import React from 'react'
import { resolveSkillTitle, resolveSkillSummary } from './featured-skills-data.js'
import { resolveSkillAuroraStyle } from './auroraGradients.js'

// 纯矢量 SVG 火苗 (Hot Picks)
export const ICON_FIRE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2c-.6 1.8-1.5 3.3-2.6 4.7C8.1 8.2 6.8 9.9 6.8 12c0 3.3 2.7 6 6 6s6-2.7 6-6c0-1.8-1.1-4-2.8-5.7-1.1-1.1-2.1-2.4-2.7-4.3z" />
  </svg>
)

const ICON_TRY_CHAT = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export const CATEGORY_NAMES = {
  'ugc-testimonial': 'UGC 和用户评价',
  'storytelling-script': '故事讲述和脚本',
  'image-static': '图片和静态广告',
  'video-ads': '视频广告',
  'product-showcase': '产品展示',
  'meme-native': '模因与原生',
  'other': '其它营销分类',
  'scene-video': '视频创作',
  'scene-replicate': '爆款复刻',
  'scene-visual': '商品视觉',
  'scene-research': '市场洞察',
  'scene-growth': '营销增长',
  'scene-seeding': '内容种草',
  'scene-brand': '品牌宣传',
  'scene-product': '商品展示',
  'scene-performance': '效果广告',
  'scene-app': '应用推广',
  'scene-local': '本地生活',
  'scene-repurpose': '内容再制',
  'scene-tools': '效率工具',
}

// 分类矢量图标（保留导出供跨模块复用）
export function CategoryIcon({ category }) {
  const alias = {
    'scene-video': 'video',
    'scene-replicate': 'story',
    'scene-visual': 'image',
    'scene-research': 'product',
    'scene-growth': 'ugc',
    'scene-seeding': 'ugc',
    'scene-brand': 'story',
    'scene-product': 'product',
    'scene-performance': 'video',
    'scene-app': 'image',
    'scene-local': 'product',
    'scene-repurpose': 'story',
    'scene-tools': 'meme',
  }
  const cat = alias[String(category || '').toLowerCase()] || String(category || '').toLowerCase()
  if (cat.includes('ugc')) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    )
  }
  if (cat.includes('story') || cat.includes('script')) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    )
  }
  if (cat.includes('image') || cat.includes('static')) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    )
  }
  if (cat.includes('video')) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    )
  }
  if (cat.includes('product')) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    )
  }
  if (cat.includes('meme')) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

/**
 * Plan A：氛围微光 + 常驻左对齐工作台技能卡片
 */
export function SkillCard({ skill, t, onSelect, active = false, categoryTitle = '' }) {
  if (!skill) return null

  const translate = typeof t === 'function' ? t : (_key, fallback) => fallback || ''
  const title = resolveSkillTitle(skill, translate)
  const summary = resolveSkillSummary(skill, translate)
  const displaySummary = summary.replace(/^用途[：:]\s*|^Purpose[：:]\s*/i, '')

  const aurora = resolveSkillAuroraStyle(skill)
  const isHot = Boolean(skill.isHot || skill.tags?.includes('热门精选'))
  const isNew = Boolean(skill.isNew || skill.tags?.includes('新品上市'))
  const catKey = skill.scenario || skill.category
  const fallbackCat = CATEGORY_NAMES[catKey] || CATEGORY_NAMES[skill.category] || (Array.isArray(skill.tags) ? skill.tags[0] : '') || '营销技能'
  const catLabel = categoryTitle || (catKey ? translate(`skills.category.${catKey}`, fallbackCat) : fallbackCat)
  const useFullText = translate('skills.card.use', '使用 Skill')
  const useShortText = translate('skills.card.useShort', '使用')

  return (
    <article
      className={`omnimux-creatify-card omnimux-skill-card ${active ? 'is-active' : ''}`}
      data-skill-id={skill.id}
      data-skill-active={active ? 'true' : 'false'}
      onClick={() => onSelect?.(skill)}
      style={{ '--skill-aura-accent': aurora.accent }}
    >
      {/* 1. 柔和右上角氛围微光背景层 */}
      <div
        className="omnimux-creatify-card-bg-img omx-skill-card-aura"
        style={{ background: aurora.bg }} /* exempt-ui02: 微光算法背景渐变 */
        aria-hidden="true"
      />

      {/* 2. 局部微孔光栅 */}
      <div className="omnimux-creatify-dot-overlay" aria-hidden="true" />

      {/* 3. 顶行：左对齐标题 + 轻量状态角标 */}
      <div className="omx-skill-card-header">
        <h3 className="omnimux-creatify-center-title omnimux-skill-card-title">
          <span>{title}</span>
        </h3>
        {(isHot || isNew) ? (
          <div className="omnimux-creatify-card-top-left omx-skill-card-badges">
            {isHot ? (
              <span className="omnimux-creatify-badge-hot" title={translate('skills.section.hotPicks', '热门精选')}>
                {ICON_FIRE}
              </span>
            ) : (
              <span className="omnimux-creatify-badge-new">
                {translate('skills.badge.new', '新')}
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* 4. 中部：常驻 2 行简介 */}
      <p className="omnimux-skill-card-summary">
        {displaySummary}
      </p>

      {/* 5. 底栏：左侧低对比场景名称 + 右侧使用 CTA */}
      <div className="omx-skill-card-footer">
        <span className="omx-skill-card-category">{catLabel}</span>
        <button /* exempt-ui01: session-guide 子树保持零 dsh-ui-kit 依赖；直接触发试用 */
          type="button"
          className="omnimux-skill-card-btn"
          title={useFullText}
          aria-label={`${useFullText}：${title}`}
          aria-pressed={active ? 'true' : 'false'}
          onClick={(e) => {
            e.stopPropagation()
            onSelect?.(skill)
          }}
        >
          <span className="omnimux-skill-card-btn-icon">{ICON_TRY_CHAT}</span>
          <span className="omnimux-skill-card-btn-label">{useShortText}</span>
        </button>
      </div>
    </article>
  )
}
