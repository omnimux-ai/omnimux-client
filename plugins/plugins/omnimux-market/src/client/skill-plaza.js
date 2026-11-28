    import { Button, ConfirmModal, SearchField, SkillShelf, Tabs, h, useCallback, useEffect, useRef, useState } from "./boot.js";
    import { Drawer, Overlay } from "./skills-ui.js";
    import { API_CACHE_TTL_MS, api, apiCache, apiCacheKey } from "./api.js";
    import { createSkillSession } from "./session-create.js";
    import { PluginsColumnTab } from "./plugins-column.js";
    import { marketRuntime } from "./runtime-state.js";
    import { useTr } from "./i18n.js";
    import * as plazaUtils from "./plaza/plazaUtils.js";
    import { InstallModal as PlazaInstallModal } from "./plaza/InstallModal.jsx";
    import { ConfirmInstallModal as PlazaConfirmInstallModal } from "./plaza/ConfirmInstallModal.jsx";
    import { SuiteDetailModal as PlazaSuiteDetailModal } from "./plaza/SuiteDetailModal.jsx";
    import { renderExpertCard, ExpertCard } from "./plaza/ExpertCard.jsx";
    import { renderFeaturedCard, FeaturedCard } from "./plaza/FeaturedCard.jsx";
    import {
      renderRegularCard,
      renderMineCard,
      MineToolbar,
      renderMineToolbar as plazaRenderMineToolbar,
      renderFeaturedSection as plazaRenderFeaturedSection,
      renderRegularSection as plazaRenderRegularSection,
      PlazaCardGrid,
    } from "./plaza/PlazaCardGrid.jsx";
    import {
      updateInstalledItemsList,
      filterMineItems,
      filterDisplayedExperts,
      buildWorkshopCategories,
      usePlazaSearchEffect,
      usePlazaState,
    } from "./plaza/usePlazaFilter.js";

    const {
      resolvePlazaIconSize,
      PlazaIcon,
      resolveItemTitle,
      resolveItemDesc,
      WorkshopSwitch,
      safeTrySkillInSession,
      WORKSHOP_DOMAIN_ORDER,
      DEFAULT_MARKET_EXPERTS,
      buildExpertStartersLookup,
      EXPERT_STAGE_OPTIONS,
      EXPERT_STATUS_CONFIG,
      getExpertStageLabel,
      resolveIntroTexts,
      extractItemSourceKey,
      resolveProjectDir,
      executeToggleExpert,
      updatePlazaItemInstalled,
      handleSwitchToggle,
      handleConfirmInstall,
      executeConfirmUninstall,
    } = plazaUtils;

    function renderPlazaIcon(size = 16) {
      const px = resolvePlazaIconSize(size);
      const iconStyle = { width: px, height: px, minWidth: px, minHeight: px, flex: "none", flexShrink: 0, display: "block" };
      return h("svg", { width: px, height: px, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", preserveAspectRatio: "xMidYMid meet", style: iconStyle },
        h("rect", { x: "1.75", y: "1.75", width: "5.5", height: "5.5", rx: "1.2", stroke: "currentColor", strokeWidth: "1.4", fill: "none" }),
        h("rect", { x: "8.75", y: "1.75", width: "5.5", height: "5.5", rx: "1.2", stroke: "currentColor", strokeWidth: "1.4", fill: "none" }),
        h("rect", { x: "1.75", y: "8.75", width: "5.5", height: "5.5", rx: "1.2", stroke: "currentColor", strokeWidth: "1.4", fill: "none" }),
        h("rect", { x: "8.75", y: "8.75", width: "5.5", height: "5.5", rx: "1.2", stroke: "currentColor", strokeWidth: "1.4", fill: "none" }),
      );
    }

    function InstallModal(props) {
      const stateHook = typeof useState === "function" ? useState : null;
      const refHook = typeof useRef === "function" ? useRef : null;
      const overlayComp = typeof Overlay !== "undefined" ? Overlay : undefined;
      const apiFn = typeof api === "function" ? api : undefined;
      return PlazaInstallModal({ ...props, h, api: apiFn, Overlay: overlayComp, hooks: { useState: stateHook, useRef: refHook } });
    }

    function ConfirmInstallModal(props) {
      const overlayComp = typeof Overlay !== "undefined" ? Overlay : undefined;
      const buttonComp = typeof Button !== "undefined" ? Button : undefined;
      return PlazaConfirmInstallModal({ ...props, h, Overlay: overlayComp, Button: buttonComp });
    }

    function SuiteDetailModal(props) {
      const stateHook = typeof useState === "function" ? useState : null;
      const overlayComp = typeof Overlay !== "undefined" ? Overlay : undefined;
      const buttonComp = typeof Button !== "undefined" ? Button : undefined;
      const apiFn = typeof api === "function" ? api : undefined;
      return PlazaSuiteDetailModal({ ...props, h, Overlay: overlayComp, Button: buttonComp, api: apiFn, hooks: { useState: stateHook } });
    }

    function renderWorkshopIntro(opts) {
      const { introHeading, introSubtitle, isExpertTab, isPluginsTab, isEn, tr, onOpenInstall } = opts;
      const defaultCreateText = isEn ? "Create Expert" : "创建专家";
      const createLabel = isExpertTab ? (tr("expertMarket.createExpert") || defaultCreateText) : tr("workshop.create");
      const createOpts = isExpertTab ? { mode: "expert-creator", preset: "cordis", text: "" } : { text: "/skill-creator" };
      const onCreateClick = () => createSkillSession(createOpts);
      return h("section", { className: "workshop-intro", "aria-label": introHeading },
        h("div", { className: "workshop-heading", role: "heading", "aria-level": 1 }, introHeading),
        h("p", { className: "workshop-description" }, introSubtitle),
        isPluginsTab ? null : h("div", { className: "action-row" },
          // exempt-ui01 create action button
          h("button", { type: "button", className: "btn-create", onClick: onCreateClick },
            h(PlazaIcon, { size: 14 }), createLabel,
          ),
          isExpertTab ? null :
            // exempt-ui01 install trigger button
            h("button", { type: "button", className: "btn-install", onClick: onOpenInstall },
              h("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
                h("path", { d: "M8 3v10M3 8h10", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
              ),
              tr("workshop.install"),
            ),
        ),
      );
    }

    function renderPlazaNavBar(opts) {
      const { mainTab, setMainTab, setPage, searchQuery, setSearchQuery, setSubmitted, placeholderText, onSearchSubmit, tr, isEn } = opts;
      const defaultExpertTab = isEn ? "Experts Market" : "专家市场";
      const defaultPluginsTab = isEn ? "Plugins" : "插件专栏";
      const resetTabSearch = () => {
        setSearchQuery("");
        if (typeof setSubmitted === "function") setSubmitted("");
      };
      const onTabDiscover = () => { if (mainTab !== "discover") resetTabSearch(); setMainTab("discover"); setPage(1); };
      const onTabMine = () => { if (mainTab !== "mine") resetTabSearch(); setMainTab("mine"); };
      const onTabExperts = () => { if (mainTab !== "experts-market") resetTabSearch(); setMainTab("experts-market"); };
      const onTabPlugins = () => { if (mainTab !== "plugins") resetTabSearch(); setMainTab("plugins"); };
      const onInputKeyDown = (e) => { if (e.key === "Enter") onSearchSubmit(); };

      const TabsComp = typeof Tabs !== "undefined" ? Tabs : null;
      const SearchFieldComp = typeof SearchField !== "undefined" ? SearchField : null;

      const tabItems = [
        {
          id: "discover",
          label: tr("workshop.tabSkill") || "Skill",
        },
        {
          id: "mine",
          label: tr("workshop.tabMine") || "我的 Skill",
        },
        {
          id: "experts-market",
          label: tr("workshop.tabExpertsMarket") || defaultExpertTab,
        },
        {
          id: "plugins",
          label: tr("workshop.tabPlugins") || defaultPluginsTab,
        },
      ];

      const handleTabChange = (nextTab) => {
        if (nextTab === "discover") onTabDiscover();
        else if (nextTab === "mine") onTabMine();
        else if (nextTab === "experts-market") onTabExperts();
        else if (nextTab === "plugins") onTabPlugins();
      };

      const tabsNode = TabsComp
        ? h(TabsComp, {
            variant: "underline",
            items: tabItems,
            activeId: mainTab,
            onChange: handleTabChange,
            className: "sh-plaza-nav-tabs",
          })
        : h("div", { className: "nav-tabs" },
            h("button", { type: "button", "aria-pressed": mainTab === "discover", className: "nav-tab" + (mainTab === "discover" ? " active" : ""), onClick: onTabDiscover },
              h("span", null, tr("workshop.tabSkill") || "Skill"),
            ),
            h("button", { type: "button", "aria-pressed": mainTab === "mine", className: "nav-tab" + (mainTab === "mine" ? " active" : ""), onClick: onTabMine },
              h("span", null, tr("workshop.tabMine") || "我的 Skill"),
            ),
            h("button", { type: "button", "aria-pressed": mainTab === "experts-market", className: "nav-tab" + (mainTab === "experts-market" ? " active" : ""), onClick: onTabExperts },
              h("span", null, tr("workshop.tabExpertsMarket") || defaultExpertTab),
            ),
            h("button", { type: "button", "aria-pressed": mainTab === "plugins", className: "nav-tab" + (mainTab === "plugins" ? " active" : ""), onClick: onTabPlugins },
              h("span", null, tr("workshop.tabPlugins") || defaultPluginsTab),
            ),
          );

      const searchNode = SearchFieldComp
        ? h("div", { className: "search-box" },
            h(SearchFieldComp, {
              value: searchQuery,
              placeholder: placeholderText,
              "aria-label": placeholderText,
              debounceMs: 0,
              stretch: true,
              onValueChange: (val) => setSearchQuery(val),
              onKeyDown: onInputKeyDown,
              onClear: () => setSearchQuery(""),
            }),
          )
        : h("div", { className: "search-box" },
            h("svg", { className: "search-icon", viewBox: "0 0 24 24" }, h("path", { d: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 11.99 14 9.5 14z" })),
            h("input", { type: "text", value: searchQuery, placeholder: placeholderText, onChange: (e) => setSearchQuery(e.target.value), onKeyDown: onInputKeyDown }),
          );

      return h("div", { className: "nav-bar" },
        tabsNode,
        searchNode,
      );
    }

    function renderCategoryBar(opts) {
      const { category, setCategory, setPlatformFilter, setMineCategory, setPage, workshopCategories, tr } = opts;
      return h("div", { className: "category-bar", "aria-label": tr("workshop.category") },
        h("span", { className: "category-label" }, tr("workshop.scenarioLabel") || "场景分类"),
        workshopCategories.map((c) => {
          const label = c.label;
          const onCatClick = () => {
            setCategory(c.id);
            if (setPlatformFilter) setPlatformFilter("");
            setMineCategory("");
            setPage(1);
          };
          // exempt-ui01 category selector button
          return h("button", { key: c.id, type: "button", className: "cat-btn" + (category === c.id ? " active" : ""), "aria-pressed": category === c.id, onClick: onCatClick },
            label,
          );
        }),
      );
    }

    function renderMineToolbar(opts) {
      const stateHook = typeof useState === "function" ? useState : null;
      const refHook = typeof useRef === "function" ? useRef : null;
      const effectHook = typeof useEffect === "function" ? useEffect : null;
      return plazaRenderMineToolbar({ ...opts, h, hooks: { useState: stateHook, useRef: refHook, useEffect: effectHook } });
    }

    function renderFeaturedSection(opts) {
      return plazaRenderFeaturedSection({ ...opts, h });
    }

    function renderRegularStatus(statusOpts, tr) {
      const { status, page, err, count } = statusOpts;
      if (status === "loading" && page === 1) return h("p", { className: "sh-mkt-status" }, tr("mkt.loading"));
      if (status === "error") return h("p", { className: "sh-mkt-status" }, tr("mkt.error", { m: err }));
      if (status === "ready" && count === 0) return h("p", { className: "sh-mkt-status" }, tr("search.empty"));
      return null;
    }

    function renderRegularSection(opts) {
      return plazaRenderRegularSection({ ...opts, h });
    }

    function renderExpertsTab(opts) {
      const { displayedExperts, expertStage, setExpertStage, expertMarketError, onDismissExpertError, tr, isEn, expertMarketToggling, onToggleExpert } = opts;
      const emptyMsg = isEn ? "No matching experts" : "没有匹配的专家";
      const stageBar = h("div", { className: "expert-stage-bar", role: "group", "aria-label": tr("expertMarket.stageFilter") || (isEn ? "Expert Category" : "专家分类") },
        EXPERT_STAGE_OPTIONS.map((opt) => {
          const active = (expertStage || "all") === opt.id;
          const label = getExpertStageLabel(opt.id, tr, isEn);
          // exempt-ui01 expert stage filter pill
          return h("button", {
            key: opt.id,
            type: "button",
            className: "cat-btn" + (active ? " active" : ""),
            "aria-pressed": active,
            onClick: () => setExpertStage && setExpertStage(opt.id),
          }, label);
        }),
      );
      const errorToast = expertMarketError
        ? h("div", { className: "expert-error-toast", role: "alert" },
            h("span", { className: "expert-error-dot", "aria-hidden": "true" }),
            h("span", { className: "expert-error-msg" }, expertMarketError),
            // exempt-ui01 dismiss error toast button
            h("button", { type: "button", className: "expert-error-close", "aria-label": isEn ? "Dismiss" : "关闭", onClick: onDismissExpertError },
              h("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
                h("path", { d: "M4 4l8 8M12 4l-8 8", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }),
              ),
            ),
          )
        : null;
      const body = displayedExperts.length === 0
        ? h("div", { className: "sh-mkt-empty" }, tr("expert.empty") || emptyMsg)
        : h("div", { className: "expert-market-grid" }, displayedExperts.map((it) => renderExpertCard(it, { tr, isEn, expertMarketToggling, onToggle: onToggleExpert, h })));
      return h("div", { className: "expert-market-container" }, stageBar, body, errorToast);
    }

    function renderMineCardsList(filteredMine, opts) {
      const { tr, setOpen, handleSwitchToggle } = opts;
      if (!filteredMine.length) {
        const emptyPrompt = tr ? (tr("workshop.emptyMine") || "暂无已安装的 Skill") : "暂无已安装的 Skill";
        return h("p", { className: "sh-mkt-status" }, emptyPrompt);
      }
      return h("div", { className: "regular-grid" },
        filteredMine.map((it) => renderMineCard(it, { tr, onOpen: setOpen, onToggle: handleSwitchToggle, h })),
      );
    }

    function renderMineTab(opts) {
      const { mineToolbarOpts, filteredMine, setOpen, handleSwitchToggle, tr } = opts;
      return h("div", null,
        renderMineToolbar(mineToolbarOpts),
        renderMineCardsList(filteredMine, { tr, setOpen, handleSwitchToggle }),
      );
    }

    function renderDiscoverTab(opts) {
      const { featuredItems, featuredSectionOpts, category, hasQuery, regularSectionOpts, hasMore, onMore, tr } = opts;
      const btn = typeof Button !== "undefined" ? Button : "button";
      return h("div", null,
        featuredItems.length > 0 ? renderFeaturedSection(featuredSectionOpts) : null,
        category === "featured" && !hasQuery ? null : renderRegularSection(regularSectionOpts),
        hasMore ? h(btn, { size: "sm", variant: "outline", onClick: onMore }, tr("mkt.more")) : null,
      );
    }

    function renderPlazaTabContent(opts) {
      if (opts.mainTab === "plugins") return h(PluginsColumnTab, opts);
      if (opts.isExpertTab) return renderExpertsTab(opts);
      if (opts.mainTab === "mine") return renderMineTab(opts);
      return renderDiscoverTab(opts);
    }

    function resolvePlazaSectionsData(opts) {
      const { state, tr, onToggleSwitch, onToggleExp, onInstallExternal } = opts;
      const sessions = marketRuntime.plazaSessions ?? null;
      const activePreset = SkillShelf.resolveActivePreset({ sessions });
      const presetBinding = SkillShelf.getPresetSkillBinding(activePreset, undefined, {
        installedSlugs: state.installedItems,
        providerSlugs: state.providerSlugs,
      });
      const hasQuery = Boolean(state.submitted.trim());
      const { featured: featuredItems, regular: regularItems } = SkillShelf.plazaDiscoverySections(state.items, {
        category: state.category, query: state.submitted, uninstalledOnly: state.uninstalledOnly, installedItems: state.installedItems, providerSlugs: state.providerSlugs, presetBinding, customOrder: state.customOrder,
      });
      // 013fcb898 后 renderFeaturedSection 恒返回 null，唯一卡片区是 renderRegularSection：
      // 浏览「全部」与各单场景（非「精选」与非「套件」）时都将 featuredItems 合并回展示集，
      // 保证 36 款公式严格守恒（全部 36 === 热门 5 + 新品 5 + 探索更多 26），featuredKeys 契约不变。
      const mergeFeaturedToRegular = state.category !== 'featured' && state.category !== '套件' && !hasQuery;
      const displayedRegular = mergeFeaturedToRegular
        ? [...new Map([...featuredItems, ...regularItems].map((it) => [(it.slug || it.skill || it.catalogId || it.id), it])).values()]
        : regularItems;
      const isEn = tr("locale") === "en";
      const isExpertTab = state.mainTab === "experts-market";
      const isPluginsTab = state.mainTab === "plugins";
      const isDiscoverTab = state.mainTab === "discover";
      const { introHeading, introSubtitle, placeholderText } = resolveIntroTexts(state, tr, isEn, isExpertTab, isPluginsTab);
      const displayedExperts = filterDisplayedExperts(state.expertMarketItems, isExpertTab, state.searchQuery, state.expertStage);
      const mineFilterCategory = state.category === "featured" ? "featured" : "";
      const filteredMine = filterMineItems(state.installedItems, { category: mineFilterCategory, presetBinding, mineCategory: state.mineCategory, mineSource: state.mineSource, searchQuery: state.searchQuery });
      const availableSources = Array.from(new Set(state.installedItems.map(extractItemSourceKey).filter(Boolean)));
      const workshopCategories = buildWorkshopCategories(presetBinding, tr);
      const onOpenInstall = () => state.setOpenInstallModal(true);
      const onSearchSubmit = () => { state.setSubmitted(state.searchQuery); state.setPage(1); };
      const onDismissExpertError = () => { if (typeof state.setExpertMarketError === "function") state.setExpertMarketError(""); };
      const isScenario = SkillShelf.isScenarioTag(state.category);
      const effectiveHasMore = hasQuery
        ? state.hasMore
        : Boolean(state.category && !isScenario && state.category !== "featured" && state.category !== "套件" && state.hasMore);
      const tabContentOpts = {
        isExpertTab, isPluginsTab, searchQuery: state.searchQuery, displayedExperts,
        expertStage: state.expertStage, setExpertStage: state.setExpertStage,
        expertMarketError: state.expertMarketError, onDismissExpertError,
        tr, isEn, expertMarketToggling: state.expertMarketToggling, onToggleExpert: onToggleExp,
        mainTab: state.mainTab, filteredMine, setOpen: state.setOpen, handleSwitchToggle: onToggleSwitch, category: state.category, hasQuery, hasMore: effectiveHasMore,
        onMore: () => state.setPage(state.page + 1),
        featuredItems,
        mineToolbarOpts: { mineCategory: state.mineCategory, setMineCategory: state.setMineCategory, mineSource: state.mineSource, setMineSource: state.setMineSource, availableSources, autoUpdate: state.autoUpdate, setAutoUpdate: state.setAutoUpdate, tr },
        featuredSectionOpts: { featuredItems, tr, setOpen: state.setOpen },
        regularSectionOpts: {
          category: state.category,
          hasQuery,
          regularItems: displayedRegular,
          uninstalledOnly: state.uninstalledOnly,
          setUninstalledOnly: state.setUninstalledOnly,
          status: state.status,
          page: state.page,
          err: state.err,
          tr,
          setOpen: state.setOpen,
          onToggle: onToggleSwitch,
          platformFilter: state.platformFilter,
          setPlatformFilter: state.setPlatformFilter,
          onInstallExternal,
          installingSlugs: state.installingSlugs,
        },
      };
      return {
        isExpertTab,
        isDiscoverTab,
        introOpts: { introHeading, introSubtitle, isExpertTab, isPluginsTab, isEn, tr, onOpenInstall },
        navBarOpts: { mainTab: state.mainTab, setMainTab: state.setMainTab, setPage: state.setPage, searchQuery: state.searchQuery, setSearchQuery: state.setSearchQuery, setSubmitted: state.setSubmitted, placeholderText, onSearchSubmit, tr, isEn },
        categoryBarOpts: { category: state.category, setCategory: state.setCategory, setPlatformFilter: state.setPlatformFilter, setMineCategory: state.setMineCategory, setPage: state.setPage, workshopCategories, tr },
        tabContentOpts,
      };
    }

    function usePlazaExpertEffect(state) {
      useEffect(() => {
        if (state.mainTab !== "experts-market") return;
        const onListSuccess = (d) => {
          if (d && Array.isArray(d.items)) {
            state.setExpertMarketItems(d.items);
            if (typeof window !== "undefined") {
              if (window.__omnimuxExpertStarters && typeof window.__omnimuxExpertStarters.update === "function") {
                window.__omnimuxExpertStarters.update(d.items);
              } else if (typeof buildExpertStartersLookup === "function") {
                window.__omnimuxExpertStarters = buildExpertStartersLookup(d.items);
              }
            }
            if (typeof state.setExpertMarketError === "function") state.setExpertMarketError("");
          }
        };
        const onListError = (err) => {
          const message = err instanceof Error ? err.message : String(err || "加载专家列表失败");
          console.warn(`[omnimux-market] expertMarketList failed: ${message}`);
          if (typeof state.setExpertMarketError === "function") state.setExpertMarketError(message);
        };
        api("expertMarketList").then(onListSuccess).catch(onListError);
      }, [state.mainTab, state.setExpertMarketItems, state.setExpertMarketError]);
    }

    function mapInstalledRow(it) {
      return { ...it, installed: true, enabled: it.enabled !== false };
    }

    function usePlazaInstalledLoader(state) {
      const loadInstalled = useCallback(() => {
        const onListSuccess = (d) => {
          if (!d) return;
          if (Array.isArray(d.items)) {
            state.setInstalledItems(d.items.map(mapInstalledRow));
          }
          if (typeof state.setProviderSlugs === "function" && Array.isArray(d.providerSlugs)) {
            state.setProviderSlugs(d.providerSlugs);
          }
        };
        api("list").then(onListSuccess).catch((err) => {
          console.warn(`[omnimux-market] plaza skill list failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, [state.setInstalledItems, state.setProviderSlugs]);

      useEffect(() => { loadInstalled(); }, [loadInstalled]);
      return loadInstalled;
    }

    function resolvePlazaHooks() {
      const stateHook = typeof useState === "function" ? useState : null;
      const effectHook = typeof useEffect === "function" ? useEffect : null;
      const cbHook = typeof useCallback === "function" ? useCallback : null;
      return { useState: stateHook, useEffect: effectHook, useCallback: cbHook };
    }

    function resolvePlazaSearchDeps(effectHook) {
      return {
        api: typeof api === "function" ? api : null,
        apiCacheKey: typeof apiCacheKey === "function" ? apiCacheKey : null,
        apiCache: typeof apiCache !== "undefined" ? apiCache : null,
        API_CACHE_TTL_MS: typeof API_CACHE_TTL_MS !== "undefined" ? API_CACHE_TTL_MS : undefined,
        useEffect: effectHook,
      };
    }

    function ConfirmUninstallDialog({ item, onConfirm, onClose, error, uninstalling, tr }) {
      if (!item) return null;
      const isEn = typeof tr === "function" && tr("locale") === "en";
      const tSafe = (key, fallback, params) => {
        if (typeof tr === "function") {
          const val = tr(key, params);
          if (val && val !== key) return val;
        }
        return fallback;
      };
      const name = resolveItemTitle(item, tr) || item.slug || "";
      const title = tSafe("workshop.uninstall", isEn ? "Uninstall" : "卸载");
      const msg = tSafe(
        "workshop.confirmUninstallNamed",
        isEn ? `Uninstall "${name}"? It will no longer appear in your chat slash menu.` : `确定卸载「${name}」吗？卸载后对话中将无法直接调用该技能。`,
        { name },
      );
      const cancelLabel = tSafe("suite.install.cancel", isEn ? "Cancel" : "取消");
      const body = error ? `${msg}\n${error}` : msg;
      const safeClose = () => { if (!uninstalling && onClose) onClose(); };
      if (typeof ConfirmModal === "function") {
        return h(ConfirmModal, {
          open: true,
          onClose: safeClose,
          title,
          message: body,
          cancelLabel,
          confirmLabel: title,
          confirmVariant: "danger",
          confirmLoading: Boolean(uninstalling),
          onConfirm,
        });
      }
      const btn = typeof Button !== "undefined" ? Button : "button";
      const ov = typeof Overlay !== "undefined" ? Overlay : "div";
      return h(ov, { onClose: safeClose },
        h("div", { className: "modal-dialog", role: "dialog", "aria-modal": "true" },
          h("div", { className: "modal-header" }, h("h3", { className: "modal-title" }, title)),
          h("p", null, msg),
          error ? h("p", { className: "sh-err", role: "alert" }, error) : null,
          h("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end" } },
            h(btn, { size: "sm", variant: "outline", disabled: Boolean(uninstalling), onClick: safeClose }, cancelLabel),
            h(btn, { size: "sm", variant: "danger", disabled: Boolean(uninstalling), onClick: onConfirm }, title),
          ),
        ),
      );
    }

    function renderPlazaModals(opts) {
      const { state, mark, loadInstalled, onCloseModal, onConfirm, onCloseUninstallModal, onConfirmUninstall, tr, projectDir } = opts;
      const openItem = state.open;
      const onDrawerClose = () => state.setOpen(null);
      const onDrawerInstalled = (it) => { mark(it, true); if (typeof loadInstalled === "function") loadInstalled(); };
      const onDrawerUninstalled = (it) => { mark(it, false); if (typeof loadInstalled === "function") loadInstalled(); };
      // 套件走独立详情模态；技能 / 专家沿用既有 Drawer。
      const drawerNode = openItem
        ? (openItem.kind === "suite"
          ? h(SuiteDetailModal, { item: openItem, tr, projectDir, onClose: onDrawerClose, onInstalled: onDrawerInstalled, onUninstalled: onDrawerUninstalled })
          : h(Drawer, { item: openItem, onClose: onDrawerClose, onInstalled: onDrawerInstalled, onUninstalled: onDrawerUninstalled }))
        : null;
      const installNode = h(InstallModal, { open: state.openInstallModal, onClose: () => state.setOpenInstallModal(false), onInstalled: (it) => { mark(it, true); loadInstalled(); } });
      const confirmNode = h(ConfirmInstallModal, { item: state.confirmInstallItem, onConfirm, error: state.confirmInstallError, installing: state.confirmInstalling, onClose: onCloseModal });
      const confirmUninstallNode = h(ConfirmUninstallDialog, {
        item: state.confirmUninstallItem,
        onConfirm: onConfirmUninstall,
        onClose: onCloseUninstallModal,
        error: state.confirmUninstallError,
        uninstalling: state.confirmUninstalling,
        tr,
      });
      return [drawerNode, installNode, confirmNode, confirmUninstallNode];
    }

    function SkillPlaza(props) {
      const tr = useTr();
      const hooks = resolvePlazaHooks();
      const state = usePlazaState((props && props.submittedQuery) ?? "", hooks);

      usePlazaExpertEffect(state);
      const loadInstalled = usePlazaInstalledLoader(state);
      usePlazaSearchEffect(state, resolvePlazaSearchDeps(hooks.useEffect));

      const apiFn = typeof api === "function" ? api : null;
      const mark = (item, installed) => updatePlazaItemInstalled(item, installed, state, updateInstalledItemsList);
      const onToggleSwitch = (item) => handleSwitchToggle(item, state, updateInstalledItemsList, apiFn);
      const onToggleExp = (item) => executeToggleExpert(item, state, apiFn);
      const onInstallExternal = async (item) => {
        if (!item || !apiFn) return;
        const slugKey = item.slug || item.id || "";
        const slug = item.slug || item.skill || item.token || "";
        if (!slugKey || !slug || state.installingSlugs?.[slugKey]) return;
        state.setInstallError("");
        state.setInstallingSlugs((cur) => ({ ...cur, [slugKey]: true }));
        try {
          await apiFn("install", { slug, catalogId: item.catalogId || item.id });
          mark(item, true);
          loadInstalled();
        } catch (err) {
          state.setInstallError(err ? (err.message || String(err)) : "安装失败");
        } finally {
          state.setInstallingSlugs((cur) => {
            const next = { ...cur };
            delete next[slugKey];
            return next;
          });
        }
      };
      const onConfirm = () => handleConfirmInstall(state.confirmInstallItem, state, mark, apiFn);
      const onConfirmUninstall = () => executeConfirmUninstall(state.confirmUninstallItem, state, updateInstalledItemsList, apiFn);
      const sections = resolvePlazaSectionsData({ state, tr, onToggleSwitch, onToggleExp, onInstallExternal, apiFn });
      const onCloseModal = () => { if (!state.confirmInstalling) { state.setConfirmInstallItem(null); state.setConfirmInstallError(""); } };
      const onCloseUninstallModal = () => { if (!state.confirmUninstalling) { state.setConfirmUninstallItem(null); state.setConfirmUninstallError(""); } };
      const workspaces = marketRuntime.plazaWorkspaces ?? null;
      const projectDir = resolveProjectDir(marketRuntime.plazaSessions ?? null, workspaces);
      const [drawerNode, installNode, confirmNode, confirmUninstallNode] = renderPlazaModals({
        state, mark, loadInstalled, onCloseModal, onConfirm, onCloseUninstallModal, onConfirmUninstall, tr, projectDir,
      });

      hooks.useEffect(() => {
        state.setPlatformFilter("");
      }, [state.category]);

      // 滚动归属（骨架契约 §二·补）：整页滚动，标题/动作行随页面滚走，一级/二级 Tab 到顶吸附。
      const [stickyNode, setStickyNode] = hooks.useState(null);
      hooks.useEffect(() => {
        if (!stickyNode) return;
        let el = stickyNode.parentElement;
        while (el) {
          const overflowY = typeof getComputedStyle === "function" ? getComputedStyle(el).overflowY : "";
          if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) break;
          el = el.parentElement;
        }
        if (el) el.scrollTop = 0;
      }, [stickyNode, state.mainTab, state.category, state.mineCategory]);

      const isEnUi = tr("locale") === "en";
      const installErrorToast = state.installError
        ? h("div", { className: "expert-error-toast", role: "alert" },
            h("span", { className: "expert-error-dot", "aria-hidden": "true" }),
            h("span", { className: "expert-error-msg" }, state.installError),
            // exempt-ui01 dismiss skill install error toast
            h("button", { type: "button", className: "expert-error-close", "aria-label": isEnUi ? "Dismiss" : "关闭", onClick: () => state.setInstallError("") },
              h("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
                h("path", { d: "M4 4l8 8M12 4l-8 8", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }),
              ),
            ),
          )
        : null;

      return h("div", { className: "sh-mkt" },
        renderWorkshopIntro(sections.introOpts),
        h("div", { className: "omx-stage-sticky", ref: setStickyNode },
          renderPlazaNavBar(sections.navBarOpts),
          sections.isDiscoverTab ? renderCategoryBar(sections.categoryBarOpts) : null,
        ),
        renderPlazaTabContent(sections.tabContentOpts),
        drawerNode,
        installNode,
        confirmNode,
        confirmUninstallNode,
        installErrorToast,
      );
    }

    export {
      ConfirmInstallModal,
      DEFAULT_MARKET_EXPERTS,
      InstallModal,
      SkillPlaza,
      SuiteDetailModal,
      buildExpertStartersLookup,
      renderPlazaIcon,
      renderPlazaModals,
    };
