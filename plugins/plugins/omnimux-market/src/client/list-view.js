    import { Button, ConfirmModal, h, useEffect, useState } from "./boot.js";
    import { ensureCss } from "./css.js";
    import { pickPayload } from "./tool-views.js";
    import { I18nProvider, lookup } from "./i18n.js";
    import { api } from "./api.js";
    import { Drawer, Overlay, Toast } from "./skills-ui.js";

    function tSafe(tr, key, fallback, params) {
      if (typeof tr === "function") {
        const val = tr(key, params);
        if (val && val !== key) return val;
      }
      return fallback;
    }

    function ListToolView(props) {
      useEffect(() => ensureCss(), []);
      const payload = pickPayload(props);
      const fromTool = Array.isArray(payload?.items) ? payload.items : null;
      const running = !!(props?.block && !("kind" in props.block));
      const [items, setItems] = useState(fromTool || []);
      const [open, setOpen] = useState(null);
      const [confirmTarget, setConfirmTarget] = useState(null);
      const [uninstalling, setUninstalling] = useState(false);
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
      const confirmUninstall = async () => {
        if (!confirmTarget || uninstalling) return;
        setUninstalling(true);
        try {
          await api("uninstall", { slug: confirmTarget.slug });
          setItems((cur) => cur.filter((x) => x.slug !== confirmTarget.slug));
          setConfirmTarget(null);
        } catch (e) {
          setToast(e.message || String(e));
        } finally {
          setUninstalling(false);
        }
      };
      const confirmTitle = tSafe(tr, "action.uninstall", "卸载");
      const confirmMessage = confirmTarget
        ? tSafe(tr, "workshop.confirmUninstallNamed", `确定卸载「${confirmTarget.name || confirmTarget.slug}」吗？`, { name: confirmTarget.name || confirmTarget.slug })
        : "";
      const cancelText = tSafe(tr, "suite.install.cancel", "取消");
      const confirmModalNode = confirmTarget
        ? (typeof ConfirmModal === "function"
          ? h(ConfirmModal, {
              open: true,
              onClose: () => { if (!uninstalling) setConfirmTarget(null); },
              title: confirmTitle,
              message: confirmMessage,
              cancelLabel: cancelText,
              confirmLabel: confirmTitle,
              confirmVariant: "danger",
              confirmLoading: uninstalling,
              onConfirm: confirmUninstall,
            })
          : h(Overlay, { onClose: () => { if (!uninstalling) setConfirmTarget(null); } },
              h("div", { className: "modal-dialog", role: "dialog", "aria-modal": "true" },
                h("div", { className: "modal-header" }, h("h3", { className: "modal-title" }, confirmTitle)),
                h("p", null, confirmMessage),
                h("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end" } },
                  h(Button, { type: "button", size: "sm", variant: "outline", disabled: uninstalling, onClick: () => setConfirmTarget(null) }, cancelText),
                  h(Button, { type: "button", size: "sm", variant: "danger", loading: uninstalling, onClick: confirmUninstall }, confirmTitle),
                ),
              ),
            ))
        : null;
      return h(I18nProvider, { t: tr },
        h("div", { className: "sh-root sh-tool" },
          h("div", { className: "sh-hint" }, items.length ? tr("installed.hint", { n: items.length }) : tr("installed.none")),
          items.map((it) => h("div", { key: it.slug, className: "sh-row" },
            h("div", null,
              h("div", { className: "sh-title" }, it.name),
              h("div", { className: "sh-slug" }, it.slug + (it.version ? " v" + it.version : "")),
            ),
            h("div", { className: "sh-row-actions" },
              h(Button, { type: "button", size: "sm", variant: "outline", onClick: () => openItem(it) }, tr("action.detail")),
              h(Button, {
                type: "button",
                size: "sm",
                variant: "outline",
                onClick: () => setConfirmTarget(it),
              }, tr("action.uninstall")),
            ),
          )),
          open ? h(Drawer, {
            item: open,
            onClose: () => setOpen(null),
            onUninstalled: (it) => setItems((cur) => cur.filter((x) => x.slug !== it.slug)),
          }) : null,
          confirmModalNode,
          toast ? h(Toast, { text: toast, onDone: () => setToast("") }) : null,
        ),
      );
    }

    export { ListToolView };
