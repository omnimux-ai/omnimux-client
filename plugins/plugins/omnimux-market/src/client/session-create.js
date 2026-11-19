    var inflightSessionCreation = null;
    var plazaWorkspaces = null;
    var plazaRemote = null;
    const skillCreationInputs = new Map();

    // Only mounted official input slots may write a session's creation guide.
    async function createReadySkillSession(sessions, opts) {
      const origin = marketCurrentSessionId();
      let expected = origin;
      let navigatingTo = "";
      let cancelled = false;
      const check = () => {
        const active = marketCurrentSessionId();
        if (navigatingTo) {
          // 导航窗口：origin → target 之间属于正常过渡，切到第三会话才算用户抢走。
          if (active && active !== origin && active !== navigatingTo) cancelled = true;
        } else if (active !== expected) {
          cancelled = true;
        }
        return !cancelled && !opts.isCancelled?.();
      };
      const unsubscribe = sessions.list?.subscribe?.(check);
      const stopped = () => ({ ok: false, cancelled: true, prefilled: false });
      try {
        if (!check()) return stopped();
        const slug = opts.slug || "skill-creator";
        const catalogId = opts.catalogId || "sk-omx-skill-creator";
        await api("install", { slug, catalogId });
        if (!check()) return stopped();
        const workspaceId = resolveFallbackWorkspaceId(sessions, plazaWorkspaces);
        const sessionId = await sessions.create(workspaceId ? { workspaceId } : {});
        if (!check()) return stopped();
        if (!sessionId || sessionId === origin) throw new Error("create-session-failed");
        const attached = await api("tryAttach", { sessionId, slug, catalogId, title: opts.title || slug });
        if (!check()) return stopped();
        if (attached?.attached !== true || attached?.hasBody !== true || attached.sessionId !== sessionId || attached.slug !== slug) {
          throw new Error("skill-body-unavailable");
        }
        const hasUiWorkspaceOpen = typeof plazaUiWorkspace?.openSession === "function";
        if (!hasUiWorkspaceOpen && typeof sessions.open !== "function") throw new Error("sessions-open-unavailable");
        opts.onTarget?.(sessionId);
        // Next/rc.3 壳里 sessions.open 不切主会话；真正的导航接缝是 uiWorkspace.openSession。
        navigatingTo = sessionId;
        if (hasUiWorkspaceOpen) plazaUiWorkspace.openSession(sessionId);
        else sessions.open(sessionId);
        // 有界等待宿主真的切到目标会话（默认 3s）：等不到就按现有错误路径失败，不静默 10s。
        const navStart = Date.now();
        const navTimeout = Number.isFinite(opts.navTimeoutMs) ? opts.navTimeoutMs : 3000;
        while (marketCurrentSessionId() !== sessionId) {
          if (opts.isCancelled?.()) return stopped();
          const active = marketCurrentSessionId();
          if (active && active !== origin && active !== sessionId) return stopped();
          if (Date.now() - navStart >= navTimeout) {
            return { ok: false, sessionId, prefilled: false, error: "session-navigation-unavailable" };
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expected = sessionId;
        // 注意：navigatingTo 必须保持到 workbench.open + 预填全部结束。异步切 tab 期间
        // marketCurrentSessionId() 会短暂为空/非 sessionId；提前清掉会让 check() 把这段
        // 正常过渡误判成用户抢走，预填循环第一条就 return stopped()，setDraft 一次都不调。
        // ready 路径同样要开 workbench：只 open 会话不会切到 split、也不会展开中间栏，
        // 实机表现是停在旧会话、没有 composer（#69 AC-3 的 ready / 非 ready 两条链路同源）。
        const wb = typeof window !== "undefined" ? window.__omnimuxWorkbench : undefined;
        const plazaTitle = typeof lookup === "function" ? (lookup("plaza.title") || "Skills") : "Skills";
        try {
          // open 是异步的，且默认按市场 tab 的 focus=gui 落位；直接带 focus:'split'
          // 并在 await 后再补 setFocus/展开中栏，否则异步 open 会覆盖后面的状态。
          const opened = window.__omnimuxWorkbench?.open?.({
            tabId: "omnimux-market:plaza",
            sessionId,
            title: plazaTitle,
            focus: "split",
          });
          if (opened && typeof opened.then === "function") await opened;
        } catch {}
        try { wb?.setFocus?.("split"); } catch {}
        try { wb?.setConversationCollapsed?.(false, { sessionId }); } catch {}
        const text = typeof opts.text === "string" ? opts.text : "/skill-creator\n帮我使用它来创建一个新的技能。首先询问我这个技能应该做什么。";
        const start = Date.now();
        const timeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 10000;
        const readBridgeDraft = () => {
          try {
            const actions = typeof window !== "undefined" ? window.__omnimuxComposerActions : null;
            return actions && typeof actions.getDraft === "function" ? String(actions.getDraft() || "") : null;
          } catch {
            return null;
          }
        };
        let bridgeAttempted = false;
        // 真实壳里 AttachmentSubmitBridge 与 SkillPickerButton 同树挂载，但布局 effect 的
        // 落地顺序不保证。先给 composer 桥一个短 grace，避免 slot 先到、桥晚到而走回
        // 已验证不可靠的 slot 内部通路；老壳无桥时再回落 slot。
        const bridgeGraceMs = timeout > 1000 ? 500 : 0;
        while (Date.now() - start < timeout) {
          if (!check()) return stopped();
          const slot = skillCreationInputs.get(sessionId);
          if (slot && (slot.draft || slot.protected)) return { ok: false, sessionId, prefilled: false, error: "draft-protected" };
          const actions = typeof window !== "undefined" ? window.__omnimuxComposerActions : null;
          const hasSetDraft = Boolean(actions && typeof actions.setDraft === "function");
          if (!bridgeAttempted && hasSetDraft) {
            bridgeAttempted = true;
            let receipt = false;
            try { receipt = actions.setDraft(text); } catch { receipt = false; }
            // 回执 false 是真实失败，必须可见地返回，不能把 slot 写入当成功兜底。
            if (receipt === false) return { ok: false, sessionId, prefilled: false, error: "prefill-failed" };
            // 稍后读回：getDraft 可能在 React 提交后才反映新草稿，不能只看 setDraft 的当次回执。
            const readbackDeadline = Math.min(start + timeout, Date.now() + 2000);
            while (Date.now() < readbackDeadline) {
              if (!check()) return stopped();
              const draft = readBridgeDraft();
              if (typeof draft === "string" && draft.includes("/skill-creator")) {
                return { ok: true, sessionId, prefilled: true };
              }
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return { ok: false, sessionId, prefilled: false, error: "prefill-failed" };
          }
          if (!bridgeAttempted && actions && typeof actions.getDraft === "function") {
            // 只有 getDraft 没有 setDraft：走同款事件通道，再用读回确认。
            bridgeAttempted = true;
            try {
              if (typeof CustomEvent === "function") {
                window.dispatchEvent(new CustomEvent("omnimux:composer:set-draft", { detail: { sessionId, draft: text } }));
                const readbackDeadline = Math.min(start + timeout, Date.now() + 2000);
                while (Date.now() < readbackDeadline) {
                  if (!check()) return stopped();
                  const draft = readBridgeDraft();
                  if (typeof draft === "string" && draft.includes("/skill-creator")) {
                    return { ok: true, sessionId, prefilled: true };
                  }
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
              }
            } catch {}
            return { ok: false, sessionId, prefilled: false, error: "prefill-failed" };
          }
          if (slot && !hasSetDraft && !actions && Date.now() - start < bridgeGraceMs) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            continue;
          }
          if (slot) {
            // 兼容没有 composer 桥的老壳：保留原 slot 通路作为最后备选。
            if (!slot.write(text)) return { ok: false, sessionId, prefilled: false, error: "prefill-failed" };
            return { ok: true, sessionId, prefilled: true };
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!check()) return stopped();
        return { ok: false, sessionId, prefilled: false, error: "input-unavailable" };
      } finally {
        navigatingTo = "";
        if (typeof unsubscribe === "function") unsubscribe();
      }
    }

    const SESSION_MENU_RE = /新会话|新建会话|new session|新对话|新建对话/i;
    const PROJECT_MENU_RE = /新建项目|create project|new project/i;

    function resolveDoc(doc) {
      if (doc) return doc;
      return typeof document !== "undefined" ? document : null;
    }

    // rc.3 SessionListState has no `current`; read the host-owned session seams
    // instead. Keep this local to the market client fragment (same contract as
    // inspiration's current-session.js; fragments cannot import across plugins).
    var UNBOUND_SESSION_IDS = new Set(["default", "__none__", "undefined", "null"]);
    function normalizeSessionId(value) {
      var id = typeof value === "string" ? value.trim() : (typeof value === "number" && Number.isFinite(value) ? String(value) : "");
      return UNBOUND_SESSION_IDS.has(id) ? "" : id;
    }
    function readHostSession(fn) {
      try { return typeof fn === "function" ? fn() : undefined; } catch { return undefined; }
    }
    function marketCurrentSessionId() {
      if (typeof window === "undefined") return "";
      var workbench = window.__omnimuxWorkbench;
      var snapshot = readHostSession(workbench && workbench.getSnapshot);
      var fromSnapshot = normalizeSessionId(snapshot && snapshot.sessionId);
      if (fromSnapshot) return fromSnapshot;
      var fromWorkbench = normalizeSessionId(readHostSession(workbench && workbench.getCurrentSessionId));
      if (fromWorkbench) return fromWorkbench;
      return normalizeSessionId(readHostSession(window.__omnimuxAttachments && window.__omnimuxAttachments.getActiveSessionId));
    }

    function isElementVisible(el) {
      if (!el) return false;
      if (typeof el.getClientRects !== "function") return true;
      try {
        return el.getClientRects().length > 0;
      } catch {
        return true;
      }
    }

    function isTopbarNewSession(button) {
      if (!button) return false;
      if (typeof button.getAttribute === "function") {
        const value = button.getAttribute("data-omnimux-topbar-new-session");
        if (value != null && value !== "false" && value !== "0") return true;
      }
      if (typeof button.hasAttribute === "function" && button.hasAttribute("data-omnimux-topbar-new-session")) {
        return true;
      }
      if (typeof button.closest === "function") {
        if (button.closest('[data-omnimux-topbar-new-session="1"]')) return true;
        if (button.closest("[data-omnimux-topbar-new-session]")) return true;
      }
      return false;
    }

    function matchesOfficialNewSession(button) {
      if (!button || typeof button.getAttribute !== "function") return false;
      if (isTopbarNewSession(button)) return false;
      if (typeof button.closest === "function") {
        if (button.closest("#omnimux-sidebar-new-menu")) return false;
        if (button.closest('[role="treeitem"]')) return false;
      }
      if (String(button.className || "").includes("newSession")) return true;
      const aria = String(button.getAttribute("aria-label") || "").trim();
      if (/^(新建会话|新会话|New session|新对话|新建对话)$/i.test(aria)) return true;
      const text = String(button.textContent || "").trim();
      if (/^(新建会话|新会话|New session|新对话|新建对话)$/i.test(text)) return true;
      return false;
    }

    function findNewSessionButton(doc) {
      const d = resolveDoc(doc);
      if (!d) return null;
      const list = typeof d.querySelectorAll === "function"
        ? Array.from(d.querySelectorAll("button"))
        : (typeof d.querySelector === "function" ? [d.querySelector("button")].filter(Boolean) : []);
      const hits = list.filter((el) => matchesOfficialNewSession(el));
      if (hits.length === 0) return null;
      const classHits = hits.filter((el) => String(el.className || "").includes("newSession"));
      const pool = classHits.length > 0 ? classHits : hits;
      const visible = pool.find((el) => isElementVisible(el));
      return visible || pool[0];
    }

    function findSingleWorkspaceNewSessionButton(doc) {
      const d = resolveDoc(doc);
      if (!d || typeof d.querySelectorAll !== "function") return null;
      const matches = Array.from(d.querySelectorAll("button")).filter((button) => {
        if (!isElementVisible(button) || typeof button.getAttribute !== "function") return false;
        const aria = String(button.getAttribute("aria-label") || "").trim();
        const text = String(button.textContent || "").trim();
        const re = /^(在.+中新建会话|New session in .+|在.+中新建对话|New chat in .+)$/i;
        return re.test(aria) || re.test(text);
      });
      return matches.length === 1 ? matches[0] : null;
    }

    function isNewSessionMenuItem(el) {
      if (!el) return false;
      const text = el.textContent != null && String(el.textContent).trim()
        ? String(el.textContent).trim()
        : (typeof el.getAttribute === "function" ? String(el.getAttribute("aria-label") || "").trim() : "");
      if (!text) return false;
      if (PROJECT_MENU_RE.test(text)) return false;
      return SESSION_MENU_RE.test(text);
    }

    function queryMenuItems(doc) {
      const d = resolveDoc(doc);
      if (!d) return [];
      if (typeof d.querySelector === "function") {
        const menu = d.querySelector("#omnimux-sidebar-new-menu");
        if (menu && typeof menu.querySelectorAll === "function") {
          return Array.from(menu.querySelectorAll('[role="menuitem"]'));
        }
      }
      if (typeof d.querySelectorAll === "function") {
        return Array.from(d.querySelectorAll('#omnimux-sidebar-new-menu [role="menuitem"]'));
      }
      return [];
    }

    function findNewSessionMenuItem(doc) {
      return queryMenuItems(doc).find((el) => isNewSessionMenuItem(el)) || null;
    }

    function clickIfPossible(el, beforeClick) {
      if (!el || typeof el.click !== "function") return false;
      if (typeof beforeClick === "function") beforeClick();
      el.click();
      return true;
    }

    function sessionSnapshot(sessions) {
      const list = sessions && sessions.list;
      if (!list || typeof list.getSnapshot !== "function") return null;
      try {
        return list.getSnapshot();
      } catch {
        return null;
      }
    }

    function officialTargetBaseline(sessions) {
      const snapshot = sessionSnapshot(sessions);
      const ids = Array.isArray(snapshot?.ids)
        ? snapshot.ids.slice()
        : Object.keys(snapshot?.byId && typeof snapshot.byId === "object" ? snapshot.byId : {});
      return { ids, currentId: marketCurrentSessionId() };
    }

    function resolvedOfficialTarget(sessions, baseline) {
      const snapshot = sessionSnapshot(sessions);
      if (!snapshot) return null;
      const byId = snapshot.byId && typeof snapshot.byId === "object" ? snapshot.byId : {};
      const ids = Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(byId);
      // A blank id added by this gesture proves a new-session result even when
      // the workbench projection has not caught up yet.
      const addedBlank = ids.filter((id) => !baseline.ids.includes(id) && byId[id]?.blank === true);
      if (addedBlank.length > 0) {
        return { ok: true, sessionId: addedBlank[addedBlank.length - 1] };
      }
      const sessionId = marketCurrentSessionId();
      if (!sessionId || byId[sessionId]?.blank !== true) return null;
      return {
        ok: true,
        sessionId,
        ...(sessionId === baseline.currentId ? { reusedBlank: true } : {}),
      };
    }

    /**
     * 点击官方新会话按钮/菜单项以复用官方创建与工作区绑定流程。
     */
    async function clickOfficialNewSession(opts = {}) {
      const doc = resolveDoc(opts.document);
      const sessions = opts.sessions || plazaSessions || (typeof window !== "undefined" ? window.__omnimuxSessions : undefined);
      if (!doc) return { ok: false, error: "no-document" };
      const list = sessions?.list;
      if (!list || typeof list.getSnapshot !== "function") {
        return { ok: false, error: "no-sessions" };
      }

      const baseline = officialTargetBaseline(sessions);
      const hasOfficialCurrent = Boolean(baseline.currentId);
      let directActionPending = false;
      let menuActionDispatched = false;
      let observedTarget = null;

      const unsubscribe = typeof list.subscribe === "function"
        ? list.subscribe(() => {
            if (!directActionPending && !menuActionDispatched) return;
            const target = resolvedOfficialTarget(sessions, baseline);
            if (target) observedTarget = target;
          })
        : () => {};

      const dispatchMenu = (el) => clickIfPossible(el, () => { menuActionDispatched = true; });
      const dispatchButton = (el) => clickIfPossible(el, () => { directActionPending = true; });

      try {
        let clickedMenu = dispatchMenu(findNewSessionMenuItem(doc));
        if (!clickedMenu) {
          const button = !hasOfficialCurrent
            ? (findSingleWorkspaceNewSessionButton(doc) || findNewSessionButton(doc))
            : findNewSessionButton(doc);
          if (!button || typeof button.click !== "function") {
            return { ok: false, error: "button-not-found" };
          }
          dispatchButton(button);

          const menuItem = findNewSessionMenuItem(doc);
          if (menuItem) {
            directActionPending = false;
            observedTarget = null;
            clickedMenu = dispatchMenu(menuItem);
          }
        }

        const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 1500;
        const pollMs = 50;
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
          if (!clickedMenu) {
            const menuItem = findNewSessionMenuItem(doc);
            if (menuItem) {
              directActionPending = false;
              observedTarget = null;
              clickedMenu = dispatchMenu(menuItem);
            }
          }
          if (observedTarget) return observedTarget;
          const target = resolvedOfficialTarget(sessions, baseline);
          if (target && (directActionPending || menuActionDispatched)) {
            return target;
          }
          await new Promise((r) => setTimeout(r, pollMs));
        }
        return observedTarget || { ok: false, error: "newSessionTimeout" };
      } finally {
        try { unsubscribe(); } catch {}
      }
    }

    /**
     * 辅助将新会话界面切换至目标 Agent Preset（如创造模式 cordis）
     */
    async function switchHeroChipPreset(presetId) {
      if (typeof document === "undefined" || !presetId) return;
      const targetText = presetId === "cordis" ? "创造模式" : presetId;
      const start = Date.now();
      while (Date.now() - start < 3000) {
        const chip = document.querySelector('[data-slot="conversation.hero.agentPreset"] button, button[aria-haspopup="listbox"], button[class*="seat"]');
        if (chip) {
          const currentLabel = (chip.innerText || chip.textContent || "").trim();
          if (currentLabel.includes(targetText) || currentLabel.includes("Creator Mode")) {
            return;
          }
          try { chip.click(); } catch {}
          await new Promise((r) => setTimeout(r, 80));
          const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [class*="item"]'));
          const targetOpt = options.find((opt) => {
            const txt = (opt.innerText || opt.textContent || "").trim();
            return txt.includes(targetText) || txt.includes("Creator Mode");
          });
          if (targetOpt) {
            try { targetOpt.click(); } catch {}
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 60));
      }
    }

    /**
     * 兜底解析合法工作区 ID：从当前会话、workspaces 服务或 sessions 历史中获取。
     */
    function resolveFallbackWorkspaceId(sessions, workspaces, explicitCurrentId) {
      try {
        const sessionSnapshot = sessions?.list?.getSnapshot?.();
        const currentId = explicitCurrentId !== undefined ? explicitCurrentId : marketCurrentSessionId();
        const currentSession = currentId && sessionSnapshot?.byId ? sessionSnapshot.byId[currentId] : null;

        // 1. 当前会话如果有 workspaceId，直接继承
        if (currentSession?.workspaceId) {
          return String(currentSession.workspaceId);
        }

        const wsService = workspaces || plazaWorkspaces || (typeof window !== "undefined" ? window.__omnimuxWorkspaces : undefined);
        const wsSnapshot = wsService?.list?.getSnapshot?.();

        // 2. 从 workspaces 快照看当前会话是否归属某工作区
        if (currentId && Array.isArray(wsSnapshot?.items)) {
          const match = wsSnapshot.items.find((item) => Array.isArray(item?.sessionIds) && item.sessionIds.includes(currentId));
          if (match?.workspaceId) return String(match.workspaceId);
        }

        // 3. 检查最近工作区 ID
        if (wsSnapshot?.recentWorkspaceId) {
          return String(wsSnapshot.recentWorkspaceId);
        }

        // 4. 从 workspaces 快照计算最近活跃工作区（根据 session updatedAt）
        if (Array.isArray(wsSnapshot?.items) && wsSnapshot.items.length > 0) {
          let selectedId = undefined;
          let selectedTime = Number.NEGATIVE_INFINITY;
          const sessionsById = sessionSnapshot?.byId || {};
          for (const workspace of wsSnapshot.items) {
            if (!workspace?.workspaceId) continue;
            let latest = Number.NEGATIVE_INFINITY;
            if (Array.isArray(workspace.sessionIds)) {
              for (const sId of workspace.sessionIds) {
                const s = sessionsById[sId];
                if (s && typeof s.updatedAt === "number") {
                  latest = Math.max(latest, s.updatedAt);
                }
              }
            }
            if (latest === Number.NEGATIVE_INFINITY && workspace.createdAt) {
              latest = Date.parse(workspace.createdAt) || 0;
            }
            if (selectedId === undefined || latest > selectedTime) {
              selectedId = workspace.workspaceId;
              selectedTime = latest;
            }
          }
          if (selectedId) return String(selectedId);
          if (wsSnapshot.items[0]?.workspaceId) return String(wsSnapshot.items[0].workspaceId);
        }

        // 5. 从 sessions 快照寻找最近具有有效 workspaceId 的会话
        if (sessionSnapshot?.byId) {
          const sessionsWithWs = Object.values(sessionSnapshot.byId)
            .filter((s) => s && s.workspaceId)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          if (sessionsWithWs.length > 0 && sessionsWithWs[0].workspaceId) {
            return String(sessionsWithWs[0].workspaceId);
          }
        }

        // 6. 如果有 cwd，匹配 workspaces.items[].path
        const cwd = currentSession?.cwd;
        if (cwd && Array.isArray(wsSnapshot?.items)) {
          const normCwd = String(cwd).replace(/[/\\]+$/u, "");
          const match = wsSnapshot.items.find((item) => {
            if (!item?.path) return false;
            return String(item.path).replace(/[/\\]+$/u, "") === normCwd;
          });
          if (match?.workspaceId) return String(match.workspaceId);
        }
      } catch (err) {
        console.warn("resolveFallbackWorkspaceId failed:", err);
      }
      return undefined;
    }

    /**
     * 寻找当前或目标 DOM 输入框（基于官方 Composer 属性）。
     * 必须是正常激活的输入框，支持官方 contenteditable 富文本及传统 textarea，排除处于禁用状态（如未选工作区）的元素。
     */
    function findComposer() {
      if (typeof document === "undefined") return null;
      const selectors = [
        "[data-composer-card] [contenteditable='true']",
        "[data-composer-seat] [contenteditable='true']",
        "[role='textbox'][contenteditable='true']",
        "[contenteditable='true']",
        "[data-composer-card] textarea",
        "[data-composer-seat] textarea",
        "textarea[data-phase]",
        "textarea[placeholder]",
        "textarea",
      ];
      for (const selector of selectors) {
        if (typeof document.querySelectorAll === "function") {
          const list = Array.from(document.querySelectorAll(selector));
          const hit = list.find((el) => {
            if (!el) return false;
            if (el.disabled) return false;
            if (typeof el.getAttribute === "function" && el.getAttribute("aria-disabled") === "true") return false;
            return true;
          });
          if (hit) return hit;
        } else if (typeof document.querySelector === "function") {
          const el = document.querySelector(selector);
          if (el) {
            if (el.disabled) continue;
            if (typeof el.getAttribute === "function" && el.getAttribute("aria-disabled") === "true") continue;
            return el;
          }
        }
      }
      return null;
    }

    /**
     * 新建独立会话并安全预填内容（无损会话契约，AC-38~AC-44，Issue #773 修复）。
     * 1. 连点/Enter重放防抖，返回同一 Promise。
     * 2. 严禁改写/转移原会话 A 的草稿、附件或 preset。
     * 3. 优先触发官方新对话相同事件（DOM 寻找并点击 newSession 按钮或菜单项）；
     *    若未找到则安全从 workspaces/sessions 获取当前或最近工作区 ID 兜底调用 sessions.create。
     * 4. 激活新会话 B，调用 workbench.open 保持右侧侧边栏不关闭，显露中间对话栏（split 布局）。
     * 5. 等待激活的输入框就绪（排除禁用/无工作区状态）。
     * 6. CAS 检查：若目标输入框已有内容，严禁覆盖！
     * 7. 严禁自动发送（no auto-send）！
     */
    async function createSkillSession(opts = {}) {
      if (inflightSessionCreation) return opts.requireReady ? { ok: false, error: "creation-busy" } : inflightSessionCreation;

      const promise = (async () => {
        try {
          const sessions = plazaSessions || (typeof window !== "undefined" ? window.__omnimuxSessions : undefined);
          if (!sessions || typeof sessions.create !== "function") {
            throw new Error("sessions-unavailable");
          }

          if (opts.requireReady) return await createReadySkillSession(sessions, opts);

          // 1. 捕获当前会话 A 状态（只读，防污染，绝不改写其草稿与附件）
          const sessionAId = marketCurrentSessionId();

          // 2. 准备 skill-creator 目标（试用挂载跳过安装）
          if (!opts.preset && !opts.skipInstall) {
            const targetSlug = opts.slug || "skill-creator";
            const targetCatalogId = opts.catalogId || "sk-omx-skill-creator";
            try {
              await api("install", { slug: targetSlug, catalogId: targetCatalogId });
            } catch {
              // 已安装或静默继续
            }
          }

          // 3. 优先通过 DOM 寻找并点击官方新对话按钮，触发官方完整新对话事件
          let sessionBId = null;
          try {
            const clickResult = await clickOfficialNewSession({
              sessions,
              document: typeof document !== "undefined" ? document : null,
            });
            if (clickResult && clickResult.ok && clickResult.sessionId) {
              sessionBId = clickResult.sessionId;
            }
          } catch (err) {
            console.warn("clickOfficialNewSession error, falling back:", err);
          }

          // 兜底逻辑：若未能通过点击官方按钮获得会话，则继承合法工作区 ID 并调用 sessions.create
          if (!sessionBId) {
            const workspaceId = resolveFallbackWorkspaceId(sessions, plazaWorkspaces);
            const createOpts = workspaceId ? { workspaceId } : {};
            sessionBId = await sessions.create(createOpts);
            if (!sessionBId || sessionBId === sessionAId) {
              throw new Error("create-session-failed");
            }
          }

          // 4. 激活新会话 B
          if (typeof sessions.open === "function") {
            sessions.open(sessionBId);
          }

          // 若指定了 preset（例如专家市场要求切换到「创造模式」cordis）
          if (opts.preset) {
            const targetPreset = opts.preset;
            try {
              const remote = plazaRemote || (typeof window !== "undefined" ? (window.__dshRemote || window.__omnimuxRemote) : null);
              if (remote?.agentPresets?.select) {
                await remote.agentPresets.select(sessionBId, targetPreset);
              }
            } catch (err) {
              console.warn("remote.agentPresets.select error:", err);
            }
            try {
              switchHeroChipPreset(targetPreset);
            } catch {}
          }

          // 保持右侧侧边栏不关闭，显露中间对话栏（split 布局）
          const wb = typeof window !== "undefined" ? window.__omnimuxWorkbench : undefined;
          const plazaTitle = typeof lookup === "function" ? (lookup("plaza.title") || "Skills") : "Skills";
          try {
            window.__omnimuxWorkbench?.open?.({ tabId: "omnimux-market:plaza", sessionId: sessionBId, title: typeof lookup === "function" ? (lookup("plaza.title") || "Skills") : "Skills" });
          } catch {}
          try { wb?.setFocus?.("split"); } catch {}
          try { wb?.setConversationCollapsed?.(false, { sessionId: sessionBId }); } catch {}

          // 5. 预填内容（严格无损，禁止自动发送）
          const prefillText = typeof opts.text === "string"
            ? opts.text
            : "/skill-creator\n帮我使用它来创建一个新的技能。首先询问我这个技能应该做什么。";

          let prefilled = false;
          if (prefillText && prefillText.trim().length > 0) {
            // 有界等待 B 输入框就绪（最长 10 秒）
            const maxWait = 10000;
            const start = Date.now();

            while (Date.now() - start < maxWait) {
              // 检查当前会话是否已被用户切换到 C
              const currentActive = marketCurrentSessionId();
              if (currentActive && currentActive !== sessionBId) {
                break;
              }

              const composer = findComposer();
              if (composer) {
                const isContentEditable = Boolean(composer.isContentEditable || (typeof composer.getAttribute === "function" && composer.getAttribute("contenteditable") === "true"));
                const currentText = (composer.value && composer.value.trim().length > 0)
                  ? composer.value
                  : (isContentEditable ? (composer.innerText || composer.textContent || "") : (composer.value || ""));

                // 安全 CAS：已有用户输入严禁覆盖
                if (currentText && currentText.trim().length > 0) {
                  prefilled = true;
                  break;
                }

                if (isContentEditable) {
                  try {
                    composer.focus?.();
                    if (typeof window !== "undefined" && window.getSelection && document.createRange) {
                      const sel = window.getSelection();
                      const range = document.createRange();
                      range.selectNodeContents(composer);
                      sel.removeAllRanges();
                      sel.addRange(range);
                    }
                    const success = typeof document.execCommand === "function"
                      ? document.execCommand("insertText", false, prefillText)
                      : false;
                    if (!success) {
                      composer.innerText = prefillText;
                    }
                  } catch {
                    composer.innerText = prefillText;
                  }
                } else {
                  const proto = typeof HTMLTextAreaElement === "function" && composer instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : typeof HTMLInputElement === "function" && composer instanceof HTMLInputElement
                      ? HTMLInputElement.prototype
                      : Object.getPrototypeOf(composer);
                  const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
                  if (setter) setter.call(composer, prefillText);
                  else composer.value = prefillText;
                }

                const Input = typeof InputEvent === "function"
                  ? InputEvent
                  : (typeof Event === "function" ? Event : function(type, opts) { this.type = type; Object.assign(this, opts); });
                composer.dispatchEvent(new Input("input", { bubbles: true, inputType: "insertText", data: prefillText }));
                composer.focus?.();

                const updatedText = isContentEditable ? (composer.innerText || composer.textContent || "") : (composer.value || "");
                if (updatedText.includes(prefillText) || updatedText.trim().length > 0) {
                  prefilled = true;
                  break;
                }
              }
              await new Promise((r) => setTimeout(r, 100));
            }
          }

          return { ok: true, sessionId: sessionBId, prefilled };
        } finally {
          inflightSessionCreation = null;
        }
      })();

      inflightSessionCreation = promise;
      return promise;
    }

    /**
     * 点亮输入框底部共享工具的技能药丸（跨插件全局通道）。
     * 不读取市场私有模块：只写 window.__omnimuxActiveSkill 并广播。
     */
    function activateSharedToolSkill(skill) {
      if (!skill || typeof window === "undefined") return;
      const slug = skill.token || skill.slug || skill.skillKey || skill.skill || "";
      const identity = {
        id: skill.catalogId || skill.id || "",
        slug,
        skill: skill.skill || slug,
        name: skill.name || skill.title || slug,
        title: skill.title || skill.name || slug,
        description: skill.description || skill.summary || "",
        summary: skill.summary || skill.description || "",
        category: skill.category || "",
        installFlow: skill.installFlow,
        origin: skill.origin === "slash" || skill.origin === "shortcut" ? skill.origin : "custom",
      };
      window.__omnimuxActiveSkill = identity;
      try {
        window.dispatchEvent(new CustomEvent("omnimux:skill:changed", {
          detail: {
            skill: identity,
            category: identity.category || "",
            origin: identity.origin,
          },
        }));
      } catch {}
    }

    /** 目录/卡片声明的会话引导预填文案；缺省时回落为 /slug。 */
    function sessionGuidePrefillText(skill, slug) {
      const raw = typeof skill.sessionPrefill === "string" ? skill.sessionPrefill.trim() : "";
      if (raw) return raw;
      return `/${slug} `;
    }

    function currentPlazaSessionId() {
      return marketCurrentSessionId();
    }

    /**
     * 在当前会话试用技能：点亮输入框技能标识 + 临时加载指令，并在输入框预填 /slug，禁止安装、禁止自动发送。
     * installFlow=session-guide：仍走引导安装 + 预填官方安装任务（Hypit 等）。
     */
    async function trySkillInSession(skill) {
      if (!skill) return { ok: false };
      const slug = skill.token || skill.slug || skill.skillKey || skill.skill || "";
      if (!slug) return { ok: false };
      // 原生斜杠 token 已由 host 的 dsh-tool-skill 负责加载，不能再走会话试用挂载。
      if (skill.origin === "slash") return { ok: true, attached: false, skipped: "slash" };

      // 技能市场把普通技能也标成「先安装」。已有对话时，
      // 「去对话试试」只更新当前对话的技能名称，不再新开对话。
      const existingSessionId = currentPlazaSessionId();
      const guide = skill.installFlow === "session-guide" && !existingSessionId;
      if (guide) {
        if (!skill.installed) {
          try {
            await api("install", { slug, catalogId: skill.catalogId || skill.id });
          } catch {}
        }
        const text = sessionGuidePrefillText(skill, slug);
        const result = await createSkillSession({
          slug,
          catalogId: skill.catalogId || skill.id,
          text,
        });
        activateSharedToolSkill({ ...skill, slug, installed: true });
        return result;
      }

      activateSharedToolSkill({ ...skill, slug });
      let sessionId = currentPlazaSessionId();
      if (!sessionId) {
        // 没有当前会话时只开一个空会话，不往输入框写斜杠指令。
        const created = await createSkillSession({ skipInstall: true, text: "" });
        sessionId = created && created.sessionId;
      }
      if (!sessionId) return { ok: false, attached: false };
      try {
        await api("tryAttach", {
          sessionId,
          slug,
          catalogId: skill.catalogId || skill.id,
          title: skill.name || skill.title || slug,
        });
      } catch {}

      // 确保中间会话栏完全显露并聚焦输入框，消除用户视觉上的无响应感。
      // 技能名称由技能按钮旁的标签显示，输入框保持原样。
      const wb = typeof window !== "undefined" ? window.__omnimuxWorkbench : undefined;
      try { wb?.ensureConversationVisible?.(); } catch {}
      try { wb?.setFocus?.("split"); } catch {}
      try { wb?.setConversationCollapsed?.(false, { sessionId }); } catch {}
      try { findComposer()?.focus?.(); } catch {}

      return { ok: true, sessionId, attached: true, installed: false };
    }

    /**
     * 其它入口点亮技能后，请求把技能说明挂到当前会话。只接收事件，不改输入框。
     */
    if (typeof window !== "undefined") {
      window.addEventListener("omnimux:skill:attach-request", (event) => {
        const skill = event?.detail?.skill;
        if (skill?.origin === "slash") return;
        const slug = skill && (skill.slug || skill.skill);
        const sessionId = currentPlazaSessionId();
        if (!slug || !sessionId) return;
        api("tryAttach", {
          sessionId,
          slug,
          catalogId: skill.id || skill.catalogId || "",
          title: skill.name || skill.title || slug,
        }).catch(() => {});
      });
      window.addEventListener("omnimux:skill:changed", (event) => {
        if (event?.detail?.skill) return;
        const sessionId = currentPlazaSessionId();
        if (sessionId) api("tryDetach", { sessionId }).catch(() => {});
      });
    }

    if (typeof window !== "undefined") {
      window.trySkillInSession = trySkillInSession;
    }
