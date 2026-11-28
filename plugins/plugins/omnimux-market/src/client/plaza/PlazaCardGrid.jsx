import React from 'react';
import { renderFeaturedCard } from './FeaturedCard.jsx';
import {
  EXTERNAL_PLATFORM_ORDER,
  isExternalCatalogSkill,
  resolveExternalPlatform,
  safeTrySkillInSession,
  WorkshopSwitch,
  resolveItemDesc,
  resolveItemTitle,
  suiteCompositionText,
  WORKSHOP_DOMAIN_ORDER,
} from './plazaUtils.js';

function getH(opts) {
  if (opts && typeof opts.h === 'function') return opts.h;
  if (typeof h === 'function') return h;
  return React.createElement;
}

function resolveCardMeta(item, tr) {
  const title = resolveItemTitle(item, tr);
  const desc = resolveItemDesc(item, tr) || '暂无描述';
  return { title, desc };
}

function getFmt(downloads, tr) {
  if (typeof fmt === 'function') return fmt(downloads, tr);
  return String(downloads);
}

function normalizeCardArgs(arg1, arg2, arg3) {
  if (arg1 && typeof arg1 === 'object' && typeof arg1 !== 'function') {
    return {
      tr: arg1.tr,
      onOpen: arg1.onOpen,
      onToggle: arg1.onToggle,
      h: arg1.h,
    };
  }
  return {
    tr: arg1,
    onOpen: arg2,
    onToggle: arg3,
    h: undefined,
  };
}

export function renderRegularCard(item, ...args) {
  const { tr, onOpen } = normalizeCardArgs(...args);
  return renderFeaturedCard(item, { tr, onOpen, onTry: safeTrySkillInSession });
}

export function renderMineCard(item, ...args) {
  const { tr, onOpen, onToggle, h: customH } = normalizeCardArgs(...args);
  const h = customH || getH();
  const { title, desc } = resolveCardMeta(item, tr);
  const isChecked = item.enabled !== false;
  const onCardClick = () => { if (onOpen) onOpen(item); };
  const onSwitchChange = () => { if (onToggle) onToggle(item); };

  return h('div', { key: item.slug || item.id, className: 'regular-card', onClick: onCardClick },
    h('div', { className: 'regular-card-info' },
      h('div', { className: 'regular-card-top' },
        h('div', { className: 'regular-card-title', title }, title),
      ),
      h('div', { className: 'regular-card-desc' }, desc),
    ),
    h(WorkshopSwitch, { checked: isChecked, onChange: onSwitchChange }),
  );
}

export function renderFeaturedSection(opts) {
  // 置顶逻辑已统一收敛至 renderRegularSection 内部的三大专区中，此处返回 null 避免顶部重复渲染
  return null;
}

export function renderRegularStatus(statusOpts, tr) {
  const h = getH();
  const { status, page, err, count } = statusOpts;
  if (status === 'loading' && page === 1) return h('p', { className: 'sh-mkt-status' }, tr('mkt.loading'));
  if (status === 'error') return h('p', { className: 'sh-mkt-status' }, tr('mkt.error', { m: err }));
  if (status === 'ready' && count === 0) return h('p', { className: 'sh-mkt-status' }, tr('search.empty'));
  return null;
}

export function renderRegularSection(opts) {
  const h = getH(opts);
  const {
    category,
    hasQuery,
    regularItems,
    uninstalledOnly,
    setUninstalledOnly,
    status,
    page,
    err,
    tr,
    setOpen,
    onToggle,
    platformFilter = '',
    setPlatformFilter,
    onInstallExternal,
    installingSlugs,
  } = opts;
  const statusNode = renderRegularStatus({ status, page, err, count: regularItems.length }, tr);

  // 搜索态：展示全量搜索结果大网格
  if (hasQuery) {
    const titleKey = 'workshop.searchResults';
    return h('section', { className: 'regular-section' },
      h('div', { className: 'regular-header' },
        h('div', { className: 'regular-title-row' },
          h('span', null, tr(titleKey) || '搜索结果'),
          h('span', { className: 'regular-title-count' }, String(regularItems.length)),
        ),
      ),
      statusNode,
      regularItems.length ? h('div', { className: 'featured-grid cards-grid' }, regularItems.map((item) => renderFeaturedCard(item, { tr, onOpen: setOpen, onTry: safeTrySkillInSession, onInstallExternal, installingSlugs }))) : null,
    );
  }

  const isAllCategory = !category || category === 'all' || category === '全部';
  const isEn = typeof tr === 'function' ? (tr('locale') === 'en') : (typeof document !== 'undefined' && document.documentElement.lang && /^en\b/i.test(document.documentElement.lang));

  const safeTr = (key, fallback) => {
    if (typeof tr === 'function') {
      const res = tr(key);
      if (res && res !== key) return res;
    }
    return fallback;
  };

  const hotPicksTitle = safeTr('workshop.hotPicks', isEn ? 'HOT PICKS' : '热门精选');
  const newArrivalsTitle = safeTr('workshop.newArrivals', isEn ? 'NEW ARRIVALS' : '新品上市');
  const exploreMoreTitle = safeTr('workshop.exploreMore', isEn ? 'EXPLORE MORE' : '探索更多');
  const viewAllText = safeTr('workshop.viewAll', isEn ? 'View All >' : '查看全部 >');

  // 默认「全部」分类状态：按用户要求置顶「热门精选」、「新品上市」（各保持 5 个），其余展示在「探索更多」
  if (isAllCategory) {
    const hotPicks = regularItems.filter((i) => i.isHot || i.tags?.includes('热门精选')).slice(0, 5);
    const hotIds = new Set(hotPicks.map((item) => item.id || item.slug));
    const newArrivals = regularItems
      .filter((i) => (i.isNew || i.tags?.includes('新品上市')) && !hotIds.has(i.id || i.slug))
      .slice(0, 5);
    const newIds = new Set(newArrivals.map((item) => item.id || item.slug));
    const exploreMore = regularItems.filter((i) => {
      const key = i.id || i.slug;
      return !hotIds.has(key) && !newIds.has(key);
    });

    return h('div', { className: 'omnimux-creatify-sections-wrap', style: { display: 'flex', flexDirection: 'column', gap: '28px', width: '100%' } },
      statusNode,
      // 1. 热门精选（置顶首屏 1:1 对齐 HOT PICKS，保持 5 个排满一行）
      hotPicks.length > 0 ? h('section', { className: 'featured-section', 'aria-label': hotPicksTitle },
        h('div', { className: 'featured-title-bar', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' } },
          h('h2', { className: 'featured-title', style: { margin: 0, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--dsw-alias-label-caption, rgba(255,255,255,0.45))' } }, hotPicksTitle),
        ),
        h('div', { className: 'featured-grid cards-grid' },
          hotPicks.map((item, idx) => renderFeaturedCard(item, { tr, onOpen: setOpen, onTry: safeTrySkillInSession, cardIndex: idx })),
        ),
      ) : null,

      // 2. 新品上市（置顶次屏 1:1 对齐 NEW ARRIVALS，只显示前 5 个排满一行）
      newArrivals.length > 0 ? h('section', { className: 'featured-section', 'aria-label': newArrivalsTitle },
        h('div', { className: 'featured-title-bar', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' } },
          h('h2', { className: 'featured-title', style: { margin: 0, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--dsw-alias-label-caption, rgba(255,255,255,0.45))' } }, newArrivalsTitle),
          h('button', {
            type: 'button',
            className: 'see-all-btn',
            style: { background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-caption, rgba(255,255,255,0.45))', cursor: 'pointer', fontSize: '12px' },
            onClick: () => {
              if (typeof document !== 'undefined') {
                const target = document.querySelector('[data-omx-section="explore-more"]');
                if (!target) return;
                const scroller = target.closest('.omx-stage-scroll, .sh-plaza-body');
                if (scroller && typeof scroller.scrollTo === 'function') {
                  const targetTop = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 116;
                  scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
                } else {
                  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }
            },
          }, viewAllText),
        ),
        h('div', { className: 'featured-grid cards-grid' },
          newArrivals.map((item, idx) => renderFeaturedCard(item, { tr, onOpen: setOpen, onTry: safeTrySkillInSession, cardIndex: 5 + idx })),
        ),
      ) : null,

      // 3. 探索更多
      h('section', { className: 'regular-section', 'aria-label': exploreMoreTitle, 'data-omx-section': 'explore-more' },
        h('div', { className: 'regular-header', style: { marginBottom: '14px' } },
          h('div', { className: 'regular-title-row' },
            h('span', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', color: 'var(--dsw-alias-label-caption, rgba(255,255,255,0.45))' } }, exploreMoreTitle),
            h('span', { className: 'regular-title-count' }, String(exploreMore.length || regularItems.length)),
          ),
        ),
        h('div', { className: 'featured-grid cards-grid' },
          (exploreMore.length > 0 ? exploreMore : regularItems).map((item, idx) => renderFeaturedCard(item, { tr, onOpen: setOpen, onTry: safeTrySkillInSession, cardIndex: 10 + idx })),
        ),
      ),
    );
  }

  // 特定单分类状态：平铺展示该分类下的一行三列卡片；含外部技能时先官方后外部并提供平台二级筛选
  const singleCategoryTitle = safeTr('cat.' + category, String(category).toUpperCase());
  const checkExternal = typeof isExternalCatalogSkill === 'function'
    ? isExternalCatalogSkill
    : (it) => Boolean(it && (it.origin === 'third-party' || (it.source && it.source.type === 'git')));
  const getExtPlatform = typeof resolveExternalPlatform === 'function'
    ? resolveExternalPlatform
    : (it) => String(it?.subtitle || '').trim();
  const platformOrder = Array.isArray(EXTERNAL_PLATFORM_ORDER)
    ? EXTERNAL_PLATFORM_ORDER
    : ['Shopify', 'Etsy', 'eBay', 'TikTok Shop', 'Walmart', '美客多', 'OZON', 'Wayfair'];
  const officialItems = regularItems.filter((it) => !checkExternal(it));
  const externalItems = regularItems.filter((it) => checkExternal(it));

  if (externalItems.length > 0) {
    const presentSet = new Set();
    for (const item of externalItems) {
      const p = getExtPlatform(item);
      if (p) presentSet.add(p);
    }
    const orderedPlatforms = [
      ...platformOrder.filter((p) => presentSet.has(p)),
      ...[...presentSet].filter((p) => !platformOrder.includes(p)),
    ];
    const allPlatformLabel = safeTr('workshop.platformAll', isEn ? 'All' : '全部');
    const officialPlatformLabel = safeTr('workshop.platformOfficial', isEn ? 'Official' : '官方');
    const officialSectionTitle = safeTr('workshop.sectionOfficial', isEn ? 'Official Skills' : '官方技能');
    const externalSectionTitle = safeTr('workshop.sectionExternal', isEn ? 'External Skills SeaLeap' : '外部技能 SeaLeap');
    const cardRenderOpts = { tr, onOpen: setOpen, onTry: safeTrySkillInSession, onInstallExternal, installingSlugs };

    const activeFilter = platformFilter || '';
    const showOfficial = activeFilter === '' || activeFilter === 'official';
    const filteredExternal = activeFilter === 'official'
      ? []
      : externalItems.filter((it) => !activeFilter || getExtPlatform(it) === activeFilter);
    const visibleCount = (showOfficial ? officialItems.length : 0) + filteredExternal.length;

    const filterChips = [
      { id: '', label: allPlatformLabel },
      ...(officialItems.length > 0 ? [{ id: 'official', label: officialPlatformLabel }] : []),
      ...orderedPlatforms.map((p) => ({ id: p, label: p })),
    ];

    return h('section', { className: 'regular-section', 'aria-label': singleCategoryTitle },
      h('div', { className: 'regular-header' },
        h('div', { className: 'regular-title-row' },
          h('span', { className: 'omx-scenario-group-title' }, singleCategoryTitle),
          h('span', { className: 'regular-title-count' }, String(visibleCount)),
        ),
      ),
      h('div', { className: 'omx-platform-filter-bar', role: 'group', 'aria-label': singleCategoryTitle },
        filterChips.map((chip) => {
          const active = activeFilter === chip.id;
          // exempt-ui01 platform filter pill
          return h('button', {
            key: chip.id || '__all_platforms__',
            type: 'button',
            className: 'omx-platform-chip' + (active ? ' active' : ''),
            'aria-pressed': active,
            onClick: () => setPlatformFilter && setPlatformFilter(chip.id),
          }, chip.label);
        }),
      ),
      statusNode,
      h('div', { className: 'omx-scenario-groups-wrap' },
        showOfficial && officialItems.length > 0 ? h('div', { className: 'omx-scenario-group' },
          h('div', { className: 'omx-scenario-group-header' },
            h('span', { className: 'omx-scenario-group-title' }, officialSectionTitle),
            h('span', { className: 'regular-title-count' }, String(officialItems.length)),
          ),
          h('div', { className: 'featured-grid cards-grid' },
            officialItems.map((item) => renderFeaturedCard(item, cardRenderOpts)),
          ),
        ) : null,
        filteredExternal.length > 0 ? h('div', { className: 'omx-scenario-group' },
          h('div', { className: 'omx-scenario-group-header' },
            h('span', { className: 'omx-scenario-group-title' }, externalSectionTitle),
            h('span', { className: 'regular-title-count' }, String(filteredExternal.length)),
          ),
          h('div', { className: 'featured-grid cards-grid' },
            filteredExternal.map((item) => renderFeaturedCard(item, cardRenderOpts)),
          ),
        ) : null,
      ),
    );
  }

  return h('section', { className: 'regular-section', 'aria-label': singleCategoryTitle },
    h('div', { className: 'regular-header', style: { marginBottom: '14px' } },
      h('div', { className: 'regular-title-row' },
        h('span', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', color: 'var(--dsw-alias-label-caption, rgba(255,255,255,0.45))' } }, singleCategoryTitle),
        h('span', { className: 'regular-title-count' }, String(regularItems.length)),
      ),
    ),
    statusNode,
    h('div', { className: 'featured-grid cards-grid' },
      regularItems.map((item) => renderFeaturedCard(item, { tr, onOpen: setOpen, onTry: safeTrySkillInSession })),
    ),
  );
}

function resolveStateHook(hooks) {
  if (hooks && typeof hooks.useState === 'function') return hooks.useState;
  if (typeof useState === 'function') return useState;
  return React.useState;
}

function resolveRefHook(hooks) {
  if (hooks && typeof hooks.useRef === 'function') return hooks.useRef;
  if (typeof useRef === 'function') return useRef;
  return React.useRef;
}

function resolveEffectHook(hooks) {
  if (hooks && typeof hooks.useEffect === 'function') return hooks.useEffect;
  if (typeof useEffect === 'function') return useEffect;
  return React.useEffect;
}

function renderCheckIcon(h) {
  return h('svg', {
    width: 12,
    height: 12,
    viewBox: '0 0 16 16',
    fill: 'none',
    className: 'mine-dropdown-check',
    'aria-hidden': 'true',
  },
    h('path', {
      d: 'M3.5 8.5L6.5 11.5L12.5 4.5',
      stroke: 'currentColor',
      strokeWidth: '1.8',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  );
}

export function MineToolbar(props) {
  const h = getH(props);
  const stateFn = resolveStateHook(props?.hooks);
  const refFn = resolveRefHook(props?.hooks);
  const effectFn = resolveEffectHook(props?.hooks);

  const {
    mineCategory = '',
    setMineCategory = () => {},
    mineSource = '',
    setMineSource = () => {},
    availableSources = [],
    autoUpdate = false,
    setAutoUpdate = () => {},
    tr,
  } = props || {};

  const [openMenu, setOpenMenu] = stateFn(null);
  const catRef = refFn(null);
  const srcRef = refFn(null);

  effectFn(() => {
    if (!openMenu) return undefined;
    if (typeof document === 'undefined') return undefined;
    const onDocClick = (e) => {
      const target = e.target;
      if (openMenu === 'category' && catRef.current && !catRef.current.contains(target)) {
        setOpenMenu(null);
      } else if (openMenu === 'source' && srcRef.current && !srcRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const isZh = tr ? tr('locale') === 'zh' : true;
  const isCatOpen = openMenu === 'category';
  const isSrcOpen = openMenu === 'source';

  const defaultCatText = tr ? (tr('workshop.category') || '分类') : '分类';
  const catPrefix = tr ? (tr('workshop.catPrefix') || '分类 ') : '分类 ';
  const catDisplay = mineCategory === '短剧漫剧' && isZh ? '短剧/漫剧' : mineCategory;
  const catBtnText = mineCategory ? (catPrefix + catDisplay) : defaultCatText;

  const defaultSrcText = tr ? (tr('workshop.source') || '来源') : '来源';
  const srcPrefix = tr ? (tr('workshop.sourcePrefix') || '来源 ') : '来源 ';
  const srcBtnText = mineSource ? (srcPrefix + mineSource) : defaultSrcText;

  const allCatLabel = isZh ? '全部分类' : (tr ? (tr('workshop.catAll') || 'All') : 'All');
  const allSrcLabel = isZh ? '全部来源' : (tr ? (tr('workshop.catAll') || 'All') : 'All');

  const isAllCatActive = !mineCategory;
  const isAllSrcActive = !mineSource;

  const toggleCatMenu = () => setOpenMenu(isCatOpen ? null : 'category');
  const toggleSrcMenu = () => setOpenMenu(isSrcOpen ? null : 'source');

  return h('div', { className: 'mine-toolbar' },
    h('div', { className: 'mine-dropdown-wrap', ref: catRef },
      // exempt-ui01 mine category dropdown button
      h('button', {
        type: 'button',
        className: 'pill-dropdown' + (isCatOpen ? ' open' : ''),
        'aria-expanded': isCatOpen,
        onClick: toggleCatMenu,
      },
        h('span', null, catBtnText),
        h('span', { className: 'pill-arrow', style: { fontSize: '10px' } }, '▾'),
      ),
      isCatOpen ? h('div', { className: 'mine-dropdown-menu', role: 'menu' },
        h('button', {
          key: '__all_cat__',
          type: 'button',
          className: 'mine-dropdown-item' + (isAllCatActive ? ' active' : ''),
          onClick: () => { setMineCategory(''); setOpenMenu(null); },
        },
          h('span', null, allCatLabel),
          isAllCatActive ? renderCheckIcon(h) : null,
        ),
        WORKSHOP_DOMAIN_ORDER.map((c) => {
          const isSelected = mineCategory === c;
          const label = (c === '短剧漫剧' && isZh) ? '短剧/漫剧' : c;
          return h('button', {
            key: c,
            type: 'button',
            className: 'mine-dropdown-item' + (isSelected ? ' active' : ''),
            onClick: () => { setMineCategory(c); setOpenMenu(null); },
          },
            h('span', null, label),
            isSelected ? renderCheckIcon(h) : null,
          );
        }),
      ) : null,
    ),
    availableSources && availableSources.length ?
      h('div', { className: 'mine-dropdown-wrap', ref: srcRef },
        // exempt-ui01 mine source dropdown button
        h('button', {
          type: 'button',
          className: 'pill-dropdown' + (isSrcOpen ? ' open' : ''),
          'aria-expanded': isSrcOpen,
          onClick: toggleSrcMenu,
        },
          h('span', null, srcBtnText),
          h('span', { className: 'pill-arrow', style: { fontSize: '10px' } }, '▾'),
        ),
        isSrcOpen ? h('div', { className: 'mine-dropdown-menu', role: 'menu' },
          h('button', {
            key: '__all_src__',
            type: 'button',
            className: 'mine-dropdown-item' + (isAllSrcActive ? ' active' : ''),
            onClick: () => { setMineSource(''); setOpenMenu(null); },
          },
            h('span', null, allSrcLabel),
            isAllSrcActive ? renderCheckIcon(h) : null,
          ),
          availableSources.map((src) => {
            const isSelected = mineSource === src;
            return h('button', {
              key: src,
              type: 'button',
              className: 'mine-dropdown-item' + (isSelected ? ' active' : ''),
              onClick: () => { setMineSource(src); setOpenMenu(null); },
            },
              h('span', null, src),
              isSelected ? renderCheckIcon(h) : null,
            );
          }),
        ) : null,
      ) : null,
    h('div', { className: 'auto-update-wrap' },
      h('span', null, tr ? (tr('workshop.autoUpdate') || '自动更新') : '自动更新'),
      h(WorkshopSwitch, { checked: autoUpdate, onChange: setAutoUpdate }),
    ),
  );
}

export function renderMineToolbar(opts) {
  const h = getH(opts);
  return h(MineToolbar, { ...opts, h });
}

export function renderMineCardsList(filteredMine, opts) {
  const h = getH(opts);
  const { tr, setOpen, handleSwitchToggle } = opts;
  if (!filteredMine.length) {
    const emptyPrompt = tr ? (tr('workshop.emptyMine') || '暂无已安装的 Skill') : '暂无已安装的 Skill';
    return h('p', { className: 'sh-mkt-status' }, emptyPrompt);
  }
  return h('div', { className: 'regular-grid' },
    filteredMine.map((it) => renderMineCard(it, tr, setOpen, handleSwitchToggle)),
  );
}

export function renderMineTab(opts) {
  const h = getH(opts);
  const { mineToolbarOpts, filteredMine, setOpen, handleSwitchToggle, tr } = opts;
  return h('div', null,
    renderMineToolbar(mineToolbarOpts),
    renderMineCardsList(filteredMine, { tr, setOpen, handleSwitchToggle }),
  );
}

export function renderDiscoverTab(opts) {
  const h = getH(opts);
  const { featuredItems, featuredSectionOpts, category, hasQuery, regularSectionOpts, hasMore, onMore, tr } = opts;
  const buttonComp = typeof Button !== 'undefined' ? Button : 'button';
  return h('div', null,
    featuredItems.length > 0 ? renderFeaturedSection(featuredSectionOpts) : null,
    category === 'featured' && !hasQuery ? null : renderRegularSection(regularSectionOpts),
    hasMore ? h(buttonComp, { size: 'sm', variant: 'outline', onClick: onMore }, tr('mkt.more')) : null,
  );
}

export function renderPlazaTabContent(opts, renderExpertsTab) {
  if (opts.isExpertTab) return renderExpertsTab(opts);
  if (opts.mainTab === 'mine') return renderMineTab(opts);
  return renderDiscoverTab(opts);
}

export function PlazaCardGrid(props) {
  const h = getH(props);
  const { items, className = 'regular-grid', renderItem, ...rest } = props;
  if (!items || items.length === 0) return null;
  return h('div', { className },
    items.map((it) => renderItem(it, rest)),
  );
}
