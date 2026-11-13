    /** 连接器 tab：P0 读 WorkBuddy 本地市场全量展示；安装下一刀再接。 */
    function ConnectorPanel({ query = "" }) {
      const tr = useTr();
      const [category, setCategory] = useState("");
      const [items, setItems] = useState([]);
      const [categories, setCategories] = useState([]);
      const [status, setStatus] = useState("loading");
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState("");
      const [feedback, setFeedback] = useState("");
      useEffect(() => {
        let live = true;
        const key = apiCacheKey("connectors", {});
        const cached = apiCache.get(key);
        const hasFresh = cached && Date.now() - cached.at < API_CACHE_TTL_MS;
        if (hasFresh) {
          const d = cached.body;
          setItems(Array.isArray(d.items) ? d.items : []);
          setCategories(Array.isArray(d.categories) ? d.categories : []);
          setStatus("ready");
          setErr("");
        }
        api("connectors", {})
          .then((d) => {
            if (!live) return;
            setItems(Array.isArray(d.items) ? d.items : []);
            setCategories(Array.isArray(d.categories) ? d.categories : []);
            setStatus("ready");
            setErr("");
          })
          .catch((e) => {
            if (!live) return;
            if (hasFresh) return;
            setItems([]);
            setCategories([]);
            setStatus("error");
            setErr(e.message || String(e));
          });
        return () => { live = false; };
      }, []);
      const q = String(query || "").trim().toLowerCase();
      const filtered = items.filter((it) => {
        if (category && it.category !== category) return false;
        if (!q) return true;
        return `${it.name || ""} ${it.description || ""} ${it.id || ""}`.toLowerCase().includes(q);
      });
      async function toggle(item) {
        // P0：市场全量只展示。installable=false 时不写 MCP 行，提示下一刀再接安装。
        if (item.installable === false || item.sourceKind === "marketplace") {
          setFeedback(tr("connector.installLater"));
          return;
        }
        if (busy) return;
        setBusy(item.id);
        setFeedback("");
        try {
          if (item.installed) await api("catalogUninstall", { id: item.id });
          else await api("catalogInstall", { id: item.id });
          setItems((cur) => cur.map((it) => it.id === item.id ? { ...it, installed: !item.installed } : it));
          setFeedback(tr("connector.restartHint"));
        } catch (e) {
          setFeedback(e.message || String(e));
        } finally {
          setBusy("");
        }
      }
      return h("div", { className: "sh-mkt" },
        h("div", { className: "sh-mkt-filters" },
          h(Button, {
            type: "button",
            size: "xs",
            variant: !category ? "secondary" : "ghost",
            onClick: () => setCategory(""),
          }, tr("mkt.catAll")),
          categories.map((it) => h(Button, {
            key: it.id,
            type: "button",
            size: "xs",
            variant: category === it.id ? "secondary" : "ghost",
            onClick: () => setCategory(it.id),
          }, it.title)),
        ),
        busy ? h("p", { className: "sh-mkt-status left" }, tr("connector.installing")) : null,
        feedback ? h("p", { className: "sh-mkt-status left" }, feedback) : null,
        status === "loading" ? h("p", { className: "sh-mkt-status" }, tr("mkt.loading")) : null,
        status === "error" ? h("p", { className: "sh-mkt-status" }, tr("mkt.error", { m: err })) : null,
        status === "ready" && !filtered.length ? h("p", { className: "sh-mkt-status" }, tr("connector.empty")) : null,
        filtered.length ? h(Cards, { items: filtered, onOpen: toggle }) : null,
      );
    }
