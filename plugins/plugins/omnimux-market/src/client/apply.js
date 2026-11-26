    import { SkillShelf, createWorkbenchSidebarEntry, h } from "./boot.js";
    import { ensureCss } from "./css.js";
    import { EN, ZH, lookup } from "./i18n.js";
    import { marketRuntime } from "./runtime-state.js";
    import { PlazaSearchToolView, SearchToolView } from "./tool-views.js";
    import { ListToolView } from "./list-view.js";
    import { ConfigCard } from "./settings.js";
    import { DEFAULT_MARKET_EXPERTS, buildExpertStartersLookup, renderPlazaIcon } from "./skill-plaza.js";
    import { SkillPickerButton } from "./skill-picker.js";
    import { PLAZA_TAB_ID, PlazaView } from "./plaza-shell.js";

    const inject = ["slots", "sessions"];
    // rc.6 list slots require `id`; rc.7+ keyed slots require `key`. Pass both.
    function registerSlot(slots, options, component) {
      const next = { ...options };
      if (next.id == null && next.key != null) next.id = String(next.key);
      if (next.key == null && next.id != null) next.key = next.id;
      return slots.register(next, component);
    }
    function apply(ctx) {
      const slots = ctx.slots;
      const sessions = ctx.sessions;
      marketRuntime.plazaSessions = sessions;
      try {
        // 不直接读 ctx.uiWorkspace：Cordis 客户端 Proxy 对未 inject 的服务会 throw。
        // uiWorkspace 是可选能力，懒取不到就保留 null，由 createReadySkillSession 回落 sessions.open。
        marketRuntime.plazaUiWorkspace = (typeof ctx.get === "function" ? ctx.get("uiWorkspace") : null) ?? marketRuntime.plazaUiWorkspace;
      } catch {
        // 老壳没有 uiWorkspace：保留 null，由 createReadySkillSession 回落 sessions.open。
      }
      if (typeof ctx.inject === "function") {
        // 可选服务只能 ctx.inject 懒挂：写进顶层 inject 会让老壳整个插件停在 waiting for activation。
        ctx.inject(["uiWorkspace"], (c) => {
          try {
            marketRuntime.plazaUiWorkspace = c.uiWorkspace ?? c.get?.("uiWorkspace") ?? marketRuntime.plazaUiWorkspace;
          } catch {}
        });
        ctx.inject(["remote"], (c) => {
          try {
            marketRuntime.plazaRemote = c.remote ?? c.get?.("remote") ?? marketRuntime.plazaRemote;
          } catch {}
        });
        ctx.inject(["workspaces"], (c) => {
          try {
            marketRuntime.plazaWorkspaces = c.workspaces ?? c.get?.("workspaces");
          } catch {}
        });
      }
      if (!slots) return;
      ctx.inject(["locale"], (c) => {
        if (c.locale) {
          try {
            if (typeof window !== "undefined") window.__omnimuxLocale = c.locale;
            if (typeof c.locale.subscribe === "function") {
              c.locale.subscribe(() => {
                if (typeof window !== "undefined") {
                  const entryLabel = document.querySelector(".omnimux-market-entry .omnimux-sidebar-nav-entry-label");
                  const entryBtn = document.querySelector(".omnimux-market-entry");
                  const titleText = lookup("plaza.title") || "Skills & Experts";
                  if (entryLabel) entryLabel.textContent = titleText;
                  if (entryBtn) {
                    entryBtn.title = titleText;
                    entryBtn.setAttribute("aria-label", titleText);
                  }
                }
              });
            }
          } catch {}
        }
        if (!c.locale || typeof c.locale.register !== "function") return;
        c.effect(() => {
          try {
            return c.locale.register("omnimux-market", { zh: ZH, en: EN });
          } catch {
            return () => {};
          }
        }, "omnimux-market-locale");
      });
      ctx.effect(() => ensureCss(), "omnimux-market-style");

      // 出厂预设技能库的**跨插件只读通道**。
      //
      // 技能数据（`catalog/preset-skills.json`）由本插件拥有；中枢（omnimux）不得
      // 导入本插件的私有模块，因此把「按 slug 解析一款已内置技能」这一件事
      // 收敛成一个窄接口挂到 window 上，与 `__omnimuxStage` / `__omnimuxWorkbench`
      // / `__omnimuxAttachments` 等既有跨插件 seam 同一形态。
      // 输入框下方的快捷方式据此判断「技能缺失即不渲染」。
      //
      // 通道**只收 slug、不收 sessionId，属有意设计**：`preset-skills.json` 是出厂
      // 预设的全局只读目录，解析结果与会话无关；加上会话 id 反而会让人以为存在
      // 会话级技能解析，诱导出第二份真源。会话级状态一律留在消费方自己的 store 里。
      if (typeof window !== "undefined") {
        ctx.effect(() => {
          const api = {
            resolvePresetSkill: (slug) => {
              try {
                return SkillShelf.findPresetSkill(slug);
              } catch {
                return null;
              }
            },
          };
          window.__omnimuxSkillLibrary = api;
          const startersSeam = typeof buildExpertStartersLookup === "function"
            ? buildExpertStartersLookup(typeof DEFAULT_MARKET_EXPERTS !== "undefined" ? DEFAULT_MARKET_EXPERTS : [])
            : null;
          if (startersSeam) window.__omnimuxExpertStarters = startersSeam;
          return () => {
            if (window.__omnimuxSkillLibrary === api) delete window.__omnimuxSkillLibrary;
            if (startersSeam && window.__omnimuxExpertStarters === startersSeam) delete window.__omnimuxExpertStarters;
          };
        }, "omnimux-market: preset skill library seam");
      }
      slots.inject("tool.call.toolview", () => registerSlot(
        slots,
        { name: "tool.call.toolview", key: "skillhub_search", locale: "omnimux-market" },
        SearchToolView,
      ));
      slots.inject("tool.call.toolview", () => registerSlot(
        slots,
        { name: "tool.call.toolview", key: "plaza_search", locale: "omnimux-market" },
        PlazaSearchToolView,
      ));
      slots.inject("tool.call.toolview", () => registerSlot(
        slots,
        { name: "tool.call.toolview", key: "skillhub_list", locale: "omnimux-market" },
        ListToolView,
      ));
      slots.inject("settings.plugin.item", () => registerSlot(
        slots,
        { name: "settings.plugin.item", key: "omnimux-market", locale: "omnimux-market" },
        ConfigCard,
      ));
      // DSH 0.2.x moved a bundle's own configuration from `settings.plugin.item`
      // (keyed by settings namespace) to `plugins.bundle.config` (keyed by the
      // bundle package name) on the bundle's Plugins page. Keep both seats: the
      // retired one is inert on 0.2.x, the new one is inert on 0.1.5.
      slots.inject("plugins.bundle.config", () => registerSlot(
        slots,
        { name: "plugins.bundle.config", key: "omnimux-market", locale: "omnimux-market" },
        ConfigCard,
      ));
      slots.inject("conversation.input.left", () => registerSlot(
        slots,
        {
          name: "conversation.input.left",
          id: "omnimux-market-skill-picker",
          order: 10,
          label: () => lookup("picker.title") || "Skill",
          locale: "omnimux-market",
        },
        SkillPickerButton,
      ));

      const MARKET_ENTRY_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><rect x="1.75" y="1.75" width="5.5" height="5.5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="8.75" y="1.75" width="5.5" height="5.5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="1.75" y="8.75" width="5.5" height="5.5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="8.75" y="8.75" width="5.5" height="5.5" rx="1.2" stroke="currentColor" stroke-width="1.4"/></svg>';

      function mountSidebarEntry() {
        return createWorkbenchSidebarEntry({
          id: "omnimux-market",
          rank: 4.1,
          tabId: PLAZA_TAB_ID,
          label: () => lookup("plaza.title") || "Skills & Experts",
          iconSvg: MARKET_ENTRY_ICON,
          access: "offline",
          customClassName: "omnimux-market-entry",
          datasetKey: "data-omnimux-market-entry",
          extraDatasetKeys: ["data-omnimux-esc-entry"],
          titleAttr: true,
        });
      }

      if (typeof ctx.effect === "function") {
        ctx.effect(() => mountSidebarEntry(), "omnimux-market-sidebar-entry");
      } else {
        mountSidebarEntry();
      }

      if (typeof ctx.inject === "function") {
        ctx.inject(["betterSidebar"], (inner) => {
          const sidebar = inner.betterSidebar ?? inner.get?.("betterSidebar");
          if (!sidebar || typeof sidebar.registerTab !== "function") return;
          try {
            window.__omnimuxWorkbench?.bind?.({ betterSidebar: sidebar });
          } catch {}
          const registerPlazaTab = () => sidebar.registerTab({
            id: PLAZA_TAB_ID,
            title: () => lookup("plaza.title") || "Skills & Experts",
            icon: renderPlazaIcon,
            order: 25,
            hidden: false,
            single: true,
            component: (props) => h(PlazaView, { ...props }),
          });
          if (typeof ctx.effect === "function") {
            ctx.effect(() => registerPlazaTab(), "omnimux-market: plaza tab");
          } else {
            registerPlazaTab();
          }
        });
      }
    }

    export { inject, apply };
