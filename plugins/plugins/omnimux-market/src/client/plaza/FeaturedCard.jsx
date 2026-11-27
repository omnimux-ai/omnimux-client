import React from 'react';
import { getCardVisual } from './cardCoversData.js';
import {
  resolveIconSrc,
  resolveItemDesc,
  resolveItemTitle,
  safeTrySkillInSession,
} from './plazaUtils.js';
import { resolveSkillAuroraStyle } from './auroraGradients.js';

const h = React.createElement;

const COVER_NUMS = [4, 5, 6, 7, 9, 10, 2, 3];

/** 紧凑宽度下文字标签退出布局后，按钮靠图标保持可辨识；图标同时是无障碍名称之外的视觉锚点。 */
export function renderHoverIcon(kind) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  };
  if (kind === 'detail') {
    return h('svg', common,
      h('path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696A10.75 10.75 0 0 1 21.938 12.348a1 1 0 0 1 0 .696A10.75 10.75 0 0 1 2.062 12.348' }),
      h('circle', { cx: 12, cy: 12, r: 3 }),
    );
  }
  return h('svg', common,
    h('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }),
  );
}

export function renderFeaturedHoverActions(item, opts) {
  const { tr, onOpen, onTry } = opts || {};
  const onOpenClick = (e) => { e && e.stopPropagation(); onOpen && onOpen(item); };
  const onTryClick = (e) => { e && e.stopPropagation(); (onTry || safeTrySkillInSession)(item); };
  const detailTitle = tr ? (tr('workshop.detail') || '查看详情') : '查看详情';
  const tryTitle = tr ? (tr('workshop.try') || '去对话中试试') : '去对话中试试';

  return h('div', { className: 'featured-hover-actions' },
    h('button', {
      type: 'button',
      className: 'hover-btn hover-btn-detail',
      onClick: onOpenClick,
      'aria-label': detailTitle,
      title: detailTitle,
    }, renderHoverIcon('detail'), h('span', { className: 'hover-btn-label' }, detailTitle)),
    h('button', {
      type: 'button',
      className: 'hover-btn hover-btn-try',
      onClick: onTryClick,
      'aria-label': tryTitle,
      title: tryTitle,
    }, renderHoverIcon('try'), h('span', { className: 'hover-btn-label' }, tryTitle)),
  );
}

// 纯矢量火苗 (Hot)
function renderFireSvg() {
  return h('svg', {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    'aria-hidden': 'true',
  },
    h('path', {
      d: 'M12 2c-.6 1.8-1.5 3.3-2.6 4.7C8.1 8.2 6.8 9.9 6.8 12c0 3.3 2.7 6 6 6s6-2.7 6-6c0-1.8-1.1-4-2.8-5.7-1.1-1.1-2.1-2.4-2.7-4.3z',
    }),
  );
}

// 分类图标
function renderCatIcon(category) {
  const alias = {
    'scene-video': 'video',
    'scene-replicate': 'story',
    'scene-visual': 'image',
    'scene-research': 'product',
    'scene-growth': 'ugc',
    'scene-tools': 'meme',
    'scene-seeding': 'ugc',
    'scene-brand': 'story',
    'scene-product': 'product',
    'scene-performance': 'video',
    'scene-app': 'image',
    'scene-local': 'product',
    'scene-repurpose': 'story',
  };
  const cat = alias[String(category || '').toLowerCase()] || String(category || '').toLowerCase();
  if (cat.includes('ugc')) {
    return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24' },
      h('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
      h('circle', { cx: 12, cy: 7, r: 4 }),
    );
  }
  if (cat.includes('story') || cat.includes('script')) {
    return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24' },
      h('path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }),
      h('path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }),
    );
  }
  if (cat.includes('image') || cat.includes('static')) {
    return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24' },
      h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
      h('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
      h('polyline', { points: '21 15 16 10 5 21' }),
    );
  }
  if (cat.includes('video')) {
    return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24' },
      h('polygon', { points: '5 3 19 12 5 21 5 3' }),
    );
  }
  if (cat.includes('product')) {
    return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24' },
      h('path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }),
      h('polyline', { points: '3.27 6.96 12 12.01 20.73 6.96' }),
      h('line', { x1: 12, y1: 22.08, x2: 12, y2: 12 }),
    );
  }
  return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24' },
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
    h('line', { x1: 12, y1: 16, x2: 12.01, y2: 16 }),
  );
}

const CATEGORY_NAMES_ZH = {
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
  'scene-tools': '效率工具',
  'scene-seeding': '内容种草',
  'scene-brand': '品牌宣传',
  'scene-product': '商品展示',
  'scene-performance': '效果广告',
  'scene-app': '应用推广',
  'scene-local': '本地生活',
  'scene-repurpose': '内容再制',
};

const CATEGORY_NAMES_EN = {
  'ugc-testimonial': 'UGC & Testimonial',
  'storytelling-script': 'Storytelling & Script',
  'image-static': 'Image & Static Ads',
  'video-ads': 'Video Ads',
  'product-showcase': 'Product Showcase',
  'meme-native': 'Meme & Native',
  'other': 'Other',
  'scene-video': 'Video Creation',
  'scene-replicate': 'Viral Replication',
  'scene-visual': 'Product Visuals',
  'scene-research': 'Market Insights',
  'scene-growth': 'Growth Marketing',
  'scene-tools': 'Editing & Tools',
  'scene-seeding': 'Content Seeding',
  'scene-brand': 'Brand Story',
  'scene-product': 'Product Showcase',
  'scene-performance': 'Performance Ads',
  'scene-app': 'App Promotion',
  'scene-local': 'Local Services',
  'scene-repurpose': 'Content Repurposing',
};

function resolveCategoryLabel(category, isEn, tr) {
  if (category) {
    if (typeof tr === 'function') {
      const trVal = tr('cat.' + category);
      if (trVal && trVal !== 'cat.' + category) return trVal;
    }
    const dict = isEn ? CATEGORY_NAMES_EN : CATEGORY_NAMES_ZH;
    if (dict[category]) return dict[category];
  }
  return category || (isEn ? 'Marketing' : '营销技能');
}

/**
 * Plan A：氛围微光 + 常驻左对齐工作台技能卡片
 */
export function renderFeaturedCard(item, opts, onOpenArg, onPinArg, onTryArg) {
  let safeOpts = {};
  if (typeof opts === 'function') {
    const onTry = typeof onPinArg === 'function' && typeof onTryArg === 'function' ? onTryArg : onPinArg;
    safeOpts = { tr: opts, onOpen: onOpenArg, onTry };
  } else if (opts && typeof opts === 'object') {
    safeOpts = opts;
  }
  const { tr, onOpen, onTry } = safeOpts;
  const isEn = typeof tr === 'function' ? (tr('locale') === 'en') : (typeof document !== 'undefined' && document.documentElement.lang && /^en\b/i.test(document.documentElement.lang));

  const safeTr = (key, params, fallback) => {
    if (typeof tr === 'function') {
      const res = tr(key, params);
      if (res && res !== key) return res;
    }
    return fallback;
  };

  const title = resolveItemTitle(item, tr);
  const desc = resolveItemDesc(item, tr) || (isEn ? 'No description' : '暂无描述');

  const aurora = resolveSkillAuroraStyle(item);
  // 保留封面与图标路径契约供详情弹窗与既有用例读取
  const customCover = item.homeCover || item.cover;
  const coverSvgFallback = !customCover && item.icon ? 'featured-cover-svg' : '';
  const iconSrc = typeof item?.icon === 'string' ? resolveIconSrc(item.icon) : '';

  const isHot = Boolean(item.isHot || item.tags?.includes('热门精选'));
  const isNew = Boolean(item.isNew || item.tags?.includes('新品上市'));
  const categoryLabel = resolveCategoryLabel(item.scenario || item.category, isEn, tr);
  const newBadgeText = safeTr('workshop.badgeNew', undefined, isEn ? 'NEW' : '新');
  const hotBadgeTitle = safeTr('workshop.hotPicks', undefined, isEn ? 'HOT PICKS' : '热门精选');
  const tryButtonText = safeTr('workshop.try', undefined, isEn ? 'Try in Chat' : '去对话中试试');
  const tryShortText = safeTr('workshop.tryShort', undefined, isEn ? 'Try' : '去试试');
  const tryTooltip = safeTr('workshop.tryTooltip', undefined, isEn ? 'Try in Chat' : '去对话试试');

  const onCardClick = () => { if (onOpen) onOpen(item); };
  const onCardKeyDown = (e) => {
    if (e && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      onCardClick();
    }
  };
  const onTryClick = (e) => {
    e && e.stopPropagation();
    (onTry || safeTrySkillInSession)(item);
  };

  return h('div', {
    key: item.slug || item.id,
    className: 'featured-card omnimux-creatify-card omx-skill-card',
    role: 'button',
    tabIndex: 0,
    'aria-label': title,
    'data-cover-fallback': coverSvgFallback || undefined,
    'data-icon-src': iconSrc || undefined,
    onClick: onCardClick,
    onKeyDown: onCardKeyDown,
    style: { '--skill-aura-accent': aurora.accent },
  },
    // 1. 柔和右上角氛围微光背景层
    h('div', {
      className: 'omnimux-creatify-card-bg-img omx-skill-card-aura',
      style: { background: aurora.bg },
      'aria-hidden': 'true',
    }),
    // 2. 局部微孔光栅（仅映衬微光区）
    h('div', { className: 'omnimux-creatify-dot-overlay', 'aria-hidden': 'true' }),
    // 3. 顶行：左对齐标题 + 轻量状态角标
    h('div', { className: 'omx-skill-card-header' },
      h('h3', { className: 'omnimux-creatify-center-title omx-skill-card-title' },
        h('span', null, title),
      ),
      (isHot || isNew) ? h('div', { className: 'omnimux-creatify-card-top-left omx-skill-card-badges' },
        isHot ? h('span', { className: 'omnimux-creatify-badge-hot', title: hotBadgeTitle }, renderFireSvg()) : null,
        isNew ? h('span', { className: 'omnimux-creatify-badge-new' }, newBadgeText) : null,
      ) : null,
    ),
    // 4. 中部：常驻 2 行简介
    h('p', { className: 'omx-skill-card-desc' }, desc),
    // 5. 底栏：左侧低对比场景名称 + 右侧试用 CTA
    h('div', { className: 'omx-skill-card-footer' },
      h('span', { className: 'omx-skill-card-category' }, categoryLabel),
      h('button', {
        type: 'button',
        className: 'omnimux-creatify-quick-try-btn',
        title: tryTooltip,
        'aria-label': tryTooltip || tryButtonText,
        onClick: onTryClick,
      },
        renderHoverIcon('try'),
        h('span', { className: 'omnimux-creatify-quick-try-label' }, tryShortText),
      ),
    ),
  );
}

export function FeaturedCard(props) {
  const { item, ...rest } = props;
  return renderFeaturedCard(item, rest);
}
