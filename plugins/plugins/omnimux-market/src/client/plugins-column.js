    /**
     * @file plugins-column.js
     * OmniMux 插件专栏：分类栅格展示、名称与描述检索及真实内置状态呈现。
     * 100% 遵循 design.md 视觉规范与 UI04 零 Unicode/Emoji 门禁。
     */

    import { h } from "./boot.js";

    const OMNIMUX_PLUGIN_CATEGORIES = [
      {
        id: "content-creation",
        titleZh: "内容创作",
        titleEn: "Content",
      },
      {
        id: "video-visuals",
        titleZh: "视频媒体",
        titleEn: "Video & Media",
      },
      {
        id: "social-marketing",
        titleZh: "社媒运营",
        titleEn: "Social Ops",
      },
      {
        id: "agents-automation",
        titleZh: "系统能力",
        titleEn: "System",
      },
    ];

    const OMNIMUX_PLUGINS_CATALOG = [
      // 1. 内容与创作
      {
        id: "omnimux-inspiration",
        categoryId: "content-creation",
        iconKey: "inspiration",
        titleZh: "灵感工作台",
        titleEn: "Inspiration Studio",
        descZh: "本地灵感工作台：订阅信息源、读文章、AI 伴读与爆款选题。",
        descEn: "Local inspiration workbench: RSS feeds, article reading, AI co-reading, and viral topics.",
        isProtected: false,
      },
      {
        id: "omnimux-assets",
        categoryId: "content-creation",
        iconKey: "assets",
        titleZh: "创意资产库",
        titleEn: "Asset Library",
        descZh: "角色、场景、道具、参考图与资产知识库管理。",
        descEn: "Named reusable assets: characters, scenes, styles, props, references, and artifacts.",
        isProtected: false,
      },
      {
        id: "omnimux-products",
        categoryId: "content-creation",
        iconKey: "products",
        titleZh: "带货选品库",
        titleEn: "Product Library",
        descZh: "电商选品库：商品规格、核心卖点提取与素材绑定。",
        descEn: "Sellable objects library: specs, selling points extraction, and media references.",
        isProtected: false,
      },

      // 2. 视频与媒体
      {
        id: "omnimux-clip",
        categoryId: "video-visuals",
        iconKey: "clip",
        titleZh: "视频工作台",
        titleEn: "Clip Studio",
        descZh: "剪辑台：时间线、多轨道、智能字幕对齐与视频导出。",
        descEn: "Official timeline editor: multi-track editing, subtitle alignment, and video export.",
        isProtected: false,
      },
      {
        id: "omnimux-studio",
        categoryId: "video-visuals",
        iconKey: "studio",
        titleZh: "视觉创作台",
        titleEn: "Visual Studio",
        descZh: "对话式多模态视觉生成，图像与视频提示词工程。",
        descEn: "Conversational visual generation studio for multi-modal image and video workflows.",
        isProtected: false,
      },
      {
        id: "omnimux-video",
        categoryId: "video-visuals",
        iconKey: "video",
        titleZh: "视频处理引擎",
        titleEn: "Video Engine",
        descZh: "本地深度图提取 (Depth Anything)、格式转码与超分。",
        descEn: "Local ffmpeg processing, depth maps extraction (Depth Anything V2), and video understanding.",
        isProtected: false,
      },
      {
        id: "omnimux-video-preview",
        categoryId: "video-visuals",
        iconKey: "video-preview",
        titleZh: "视频预览流",
        titleEn: "Video Preview",
        descZh: "侧边栏内联 HTTP 206 流式分片视频高速预览。",
        descEn: "Inline video preview for sidebar backed by HTTP Range streaming.",
        isProtected: false,
      },
      {
        id: "omnimux-viewer",
        categoryId: "video-visuals",
        iconKey: "viewer",
        titleZh: "多媒体查看器",
        titleEn: "Media Viewer",
        descZh: "图像、视频、音频、PDF 与文档内联全格式流式渲染。",
        descEn: "Inline rendering for images, video, audio, PDF and Office documents via display_file.",
        isProtected: false,
      },

      // 3. 社媒与运营
      {
        id: "omnimux-publish",
        categoryId: "social-marketing",
        iconKey: "publish",
        titleZh: "矩阵分发",
        titleEn: "Multi-Publish",
        descZh: "多平台一键排期分发、账号发布账本与发布状态监控。",
        descEn: "Multi-platform scheduled publishing, subtask ledger, and distribution monitoring.",
        isProtected: false,
      },
      {
        id: "omnimux-accounts",
        categoryId: "social-marketing",
        iconKey: "accounts",
        titleZh: "账号矩阵",
        titleEn: "Account Matrix",
        descZh: "矩阵账号管理：多平台账号授权连接、分组与状态巡检。",
        descEn: "Official social accounts manager: connect, group, and inspect platform accounts.",
        isProtected: false,
      },
      {
        id: "omnimux-analytics",
        categoryId: "social-marketing",
        iconKey: "analytics",
        titleZh: "表现分析",
        titleEn: "Analytics",
        descZh: "社媒全域大盘、互动指标监控与投放效果分析看板。",
        descEn: "Social analytics dashboard: performance metrics and traffic insights.",
        isProtected: false,
      },
      {
        id: "omnimux-intercept",
        categoryId: "social-marketing",
        iconKey: "intercept",
        titleZh: "爆速截流",
        titleEn: "Quick Intercept",
        descZh: "推文与评论实时检测、毫秒级截流文案生成与提醒。",
        descEn: "Real-time tweet interception, smart replies generation, and immediate alerts.",
        isProtected: false,
      },

      // 4. 智能体与系统
      {
        id: "omnimux-workflow",
        categoryId: "agents-automation",
        iconKey: "workflow",
        titleZh: "工作流画布",
        titleEn: "Workflow Canvas",
        descZh: "无限画布节点编排，复杂多步骤任务 DAG 可视化。",
        descEn: "Infinite canvas node DAG editing, agent control, and visual task orchestration.",
        isProtected: false,
      },
      {
        id: "omnimux-browser",
        categoryId: "agents-automation",
        iconKey: "browser",
        titleZh: "浏览器伴侣",
        titleEn: "Browser Companion",
        descZh: "基于 DOM 编号与 WebSocket 桥接的网页自主操作感知。",
        descEn: "Browser companion extension: DOM indexing and browser automation bridge.",
        isProtected: false,
      },
      {
        id: "omnimux-device",
        categoryId: "agents-automation",
        iconKey: "device",
        titleZh: "移动真机矩阵",
        titleEn: "Device Matrix",
        descZh: "移动端真机集群池化管理、OCR 视觉定位与屏幕驱动。",
        descEn: "Physical iOS device cluster management, accessibility tree, and OCR automation.",
        isProtected: false,
      },
      {
        id: "omnimux-apps",
        categoryId: "agents-automation",
        iconKey: "apps",
        titleZh: "应用门户",
        titleEn: "AI Applications",
        descZh: "垂直场景 AI 消费级应用目录与一键运行工作台。",
        descEn: "AI applications catalog: consumer portal and domain app runtime.",
        isProtected: false,
      },
      {
        id: "omnimux",
        categoryId: "agents-automation",
        iconKey: "core",
        titleZh: "核心执行中枢",
        titleEn: "Core Hub",
        descZh: "运行时网关、多模型渠道与调度底座。",
        descEn: "OmniMux execution hub: multi-model routing and runtime core.",
        isProtected: true,
      },
      {
        id: "omnimux-market",
        categoryId: "agents-automation",
        iconKey: "market",
        titleZh: "技能专家市场",
        titleEn: "Skills & Experts Market",
        descZh: "技能套件、专家与插件市场管理中枢。",
        descEn: "Marketplace center for skills, expert agents, and plugins.",
        isProtected: true,
      },
    ];

    function renderPluginIconSvg(iconKey) {
      const p = {
        width: 18,
        height: 18,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      };

      switch (iconKey) {
        case "inspiration":
          // Lightbulb
          return h("svg", p,
            h("path", { d: "M9 18h6M10 22h4" }),
            h("path", { d: "M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5" }),
          );
        case "assets":
          // Archive box
          return h("svg", p,
            h("rect", { x: "2", y: "4", width: "20", height: "5", rx: "2" }),
            h("path", { d: "M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4" }),
          );
        case "products":
          // Shopping bag
          return h("svg", p,
            h("path", { d: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" }),
            h("path", { d: "M3 6h18M16 10a4 4 0 0 1-8 0" }),
          );
        case "clip":
          // Clapperboard
          return h("svg", p,
            h("path", { d: "M20.2 6 3 11l-.9-2.4 17.2-5Z" }),
            h("path", { d: "m6.2 5.3 3.1 4M12.4 3.4l3.1 4" }),
            h("rect", { width: "20", height: "12", x: "2", y: "8", rx: "2" }),
          );
        case "studio":
          // Palette
          return h("svg", p,
            h("circle", { cx: "13.5", cy: "6.5", r: ".5", fill: "currentColor" }),
            h("circle", { cx: "17.5", cy: "10.5", r: ".5", fill: "currentColor" }),
            h("circle", { cx: "8.5", cy: "7.5", r: ".5", fill: "currentColor" }),
            h("circle", { cx: "6.5", cy: "12.5", r: ".5", fill: "currentColor" }),
            h("path", { d: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" }),
          );
        case "video":
          // Film
          return h("svg", p,
            h("rect", { width: "20", height: "20", x: "2", y: "2", rx: "2.18" }),
            h("path", { d: "M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" }),
          );
        case "video-preview":
          // Play in window
          return h("svg", p,
            h("rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" }),
            h("path", { d: "m10 9 5 3-5 3V9z" }),
          );
        case "viewer":
          // Eye
          return h("svg", p,
            h("path", { d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" }),
            h("circle", { cx: "12", cy: "12", r: "3" }),
          );
        case "publish":
          // Share2
          return h("svg", p,
            h("circle", { cx: "18", cy: "5", r: "3" }),
            h("circle", { cx: "6", cy: "12", r: "3" }),
            h("circle", { cx: "18", cy: "19", r: "3" }),
            h("line", { x1: "8.59", x2: "15.42", y1: "13.51", y2: "17.49" }),
            h("line", { x1: "15.41", x2: "8.59", y1: "6.51", y2: "10.49" }),
          );
        case "accounts":
          // Users
          return h("svg", p,
            h("path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }),
            h("circle", { cx: "9", cy: "7", r: "4" }),
            h("path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }),
            h("path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }),
          );
        case "analytics":
          // BarChart
          return h("svg", p,
            h("line", { x1: "18", x2: "18", y1: "20", y2: "10" }),
            h("line", { x1: "12", x2: "12", y1: "20", y2: "4" }),
            h("line", { x1: "6", x2: "6", y1: "20", y2: "14" }),
          );
        case "intercept":
          // Zap
          return h("svg", p,
            h("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" }),
          );
        case "workflow":
          // Git branch
          return h("svg", p,
            h("line", { x1: "6", x2: "6", y1: "3", y2: "15" }),
            h("circle", { cx: "18", cy: "6", r: "3" }),
            h("circle", { cx: "6", cy: "18", r: "3" }),
            h("path", { d: "M18 9a9 9 0 0 1-9 9" }),
          );
        case "browser":
          // Globe
          return h("svg", p,
            h("circle", { cx: "12", cy: "12", r: "10" }),
            h("line", { x1: "2", x2: "22", y1: "12", y2: "12" }),
            h("path", { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" }),
          );
        case "device":
          // Smartphone
          return h("svg", p,
            h("rect", { width: "14", height: "20", x: "5", y: "2", rx: "2", ry: "2" }),
            h("path", { d: "M12 18h.01" }),
          );
        case "apps":
          // LayoutGrid
          return h("svg", p,
            h("rect", { width: "7", height: "7", x: "3", y: "3", rx: "1" }),
            h("rect", { width: "7", height: "7", x: "14", y: "3", rx: "1" }),
            h("rect", { width: "7", height: "7", x: "14", y: "14", rx: "1" }),
            h("rect", { width: "7", height: "7", x: "3", y: "14", rx: "1" }),
          );
        case "core":
          // Cpu
          return h("svg", p,
            h("rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }),
            h("rect", { x: "9", y: "9", width: "6", height: "6" }),
            h("path", { d: "M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" }),
          );
        case "market":
        default:
          // Award / Shield
          return h("svg", p,
            h("circle", { cx: "12", cy: "8", r: "6" }),
            h("path", { d: "M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" }),
          );
      }
    }

    function renderPluginRowCard(plugin, opts) {
      const { isEn, tr } = opts;
      const isZh = !isEn;
      const title = isZh ? plugin.titleZh : plugin.titleEn;
      const desc = isZh ? plugin.descZh : plugin.descEn;
      const isLocked = Boolean(plugin.isProtected);
      const tSafe = (key, fallback) => {
        if (typeof tr === "function") {
          const v = tr(key);
          if (v && v !== key) return v;
        }
        return fallback;
      };
      const statusText = isLocked
        ? tSafe("pluginsColumn.coreBadge", isEn ? "Core" : "核心内置")
        : tSafe("pluginsColumn.builtinBadge", isEn ? "Built-in" : "已内置");

      return h("div", {
        key: plugin.id,
        className: "sh-plugin-card" + (isLocked ? " is-locked" : ""),
      },
        h("div", { className: "sh-plugin-icon-wrap" },
          renderPluginIconSvg(plugin.iconKey),
        ),
        h("div", { className: "sh-plugin-info" },
          h("div", { className: "sh-plugin-name" }, title),
          h("div", { className: "sh-plugin-desc" }, desc),
        ),
        h("div", { className: "sh-plugin-switch-cell" },
          h("span", { className: "sh-tag" + (isLocked ? " blue" : " green") }, statusText),
        ),
      );
    }

    function PluginsColumnTab(opts) {
      const { searchQuery = "", tr, isEn } = opts;
      const q = String(searchQuery || "").trim().toLowerCase();

      // 按分类分组过滤
      const filteredGroups = OMNIMUX_PLUGIN_CATEGORIES.map((cat) => {
        const catPlugins = OMNIMUX_PLUGINS_CATALOG.filter((it) => it.categoryId === cat.id);
        const matching = catPlugins.filter((it) => {
          if (!q) return true;
          const matchStr = `${it.titleZh} ${it.titleEn} ${it.descZh} ${it.descEn} ${it.id}`.toLowerCase();
          return matchStr.includes(q);
        });
        return {
          ...cat,
          plugins: matching,
        };
      }).filter((grp) => grp.plugins.length > 0);

      const totalMatches = filteredGroups.reduce((acc, g) => acc + g.plugins.length, 0);

      if (totalMatches === 0) {
        const emptyMsg = tr("pluginsColumn.emptySearch") || (isEn ? "No matching plugins found" : "未找到匹配的插件");
        return h("div", { className: "sh-plugins-empty-container" },
          h("p", { className: "sh-mkt-status" }, emptyMsg),
        );
      }

      return h("div", { className: "sh-plugins-column-wrap" },
        filteredGroups.map((grp) => {
          const catTitle = isEn ? grp.titleEn : grp.titleZh;
          return h("div", { key: grp.id, className: "sh-plugins-category-group" },
            h("div", { className: "sh-plugins-category-title" }, catTitle),
            h("div", { className: "sh-plugins-grid" },
              grp.plugins.map((it) => renderPluginRowCard(it, { isEn, tr })),
            ),
          );
        }),
      );
    }

    function renderPluginsColumnTab(opts) {
      return PluginsColumnTab(opts);
    }

    export { PluginsColumnTab };
