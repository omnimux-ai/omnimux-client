    function ListToolView(props) {
      useEffect(() => ensureCss(), []);
      const payload = pickPayload(props);
      const fromTool = Array.isArray(payload?.items) ? payload.items : null;
      const running = !!(props?.block && !("kind" in props.block));
      const [items, setItems] = useState(fromTool || []);
      const [open, setOpen] = useState(null);
      const [toast, setToast] = useState("");
      useEffect(() => { if (fromTool) setItems(fromTool); }, [fromTool]);
      if (running) return null;
      const tr = typeof props.t === "function" ? props.t : lookup;
      const openItem = (it) => setOpen({
        slug: it.slug,
        name: it.name,
        description: it.description,
        version: it.version,
        installed: true,
        pageUrl: "https://skillhub.cn/skills/" + it.slug,
      });
      return h(I18nProvider, { t: tr },
        h("div", { className: "sh-root sh-tool" },
          h("div", { className: "sh-hint" }, items.length ? tr("installed.hint", { n: items.length }) : tr("installed.none")),
          items.map((it) => h("div", { key: it.slug, className: "sh-row" },
            h("div", null,
              h("div", { className: "sh-title" }, it.name),
              h("div", { className: "sh-slug" }, it.slug + (it.version ? " · v" + it.version : "")),
            ),
            h("div", { className: "sh-row-actions" },
              h(Button, { type: "button", size: "sm", variant: "outline", onClick: () => openItem(it) }, tr("action.detail")),
              h(Button, {
                type: "button",
                size: "sm",
                variant: "outline",
                onClick: async () => {
                  try {
                    await api("uninstall", { slug: it.slug });
                    setItems((cur) => cur.filter((x) => x.slug !== it.slug));
                    setToast(tr("toast.uninstalled", { name: it.name }));
                  } catch (e) {
                    setToast(e.message || String(e));
                  }
                },
              }, tr("action.uninstall")),
            ),
          )),
          open ? h(Drawer, {
            item: open,
            onClose: () => setOpen(null),
            onUninstalled: (it) => setItems((cur) => cur.filter((x) => x.slug !== it.slug)),
          }) : null,
          toast ? h(Toast, { text: toast, onDone: () => setToast("") }) : null,
        ),
      );
    }
