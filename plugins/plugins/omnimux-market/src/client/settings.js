    function ChevronDown({ className }) {
      return h("svg", {
        className,
        width: 14,
        height: 14,
        viewBox: "0 0 14 14",
        fill: "none",
        xmlns: "http://www.w3.org/2000/svg",
        "aria-hidden": "true",
      }, h("path", {
        d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
        fill: "currentColor",
      }));
    }

    function emptyDraft() {
      return {
        apiBase: "https://api.skillhub.cn",
        skillsDir: "",
        maxResults: 12,
        timeoutMs: 20000,
        sortBy: "score",
      };
    }

    function ConfigCard(props) {
      useEffect(() => ensureCss(), []);
      const tr = typeof props.t === "function" ? props.t : lookup;
      const [open, setOpen] = useState(false);
      const [saved, setSaved] = useState(emptyDraft);
      const [draft, setDraft] = useState(emptyDraft);
      const [saving, setSaving] = useState(false);
      const [updateInfo, setUpdateInfo] = useState(null);
      const [err, setErr] = useState("");
      useEffect(() => {
        let live = true;
        api("config", {})
          .then((d) => {
            if (!live) return;
            const next = {
              apiBase: d.apiBase || "https://api.skillhub.cn",
              skillsDir: d.skillsDir || "",
              maxResults: d.maxResults || 12,
              timeoutMs: d.timeoutMs || 20000,
              sortBy: d.sortBy || "score",
            };
            setSaved(next);
            setDraft(next);
          })
          .catch((e) => { if (live) setErr(e.message || String(e)); });
        api("updateCheck", {})
          .then((d) => { if (live) setUpdateInfo(d); })
          .catch(() => {});
        return () => { live = false; };
      }, []);
      const dirty = !!(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
      const save = async () => {
        if (!draft) return;
        setSaving(true);
        setErr("");
        try {
          const d = await api("config", { save: true, ...draft });
          const next = {
            apiBase: d.apiBase,
            skillsDir: d.skillsDir,
            maxResults: d.maxResults,
            timeoutMs: d.timeoutMs,
            sortBy: d.sortBy,
          };
          setSaved(next);
          setDraft(next);
        } catch (e) {
          setErr(e.message || String(e));
        } finally {
          setSaving(false);
        }
      };
      const versionHint = updateInfo?.latest
        ? tr("cfg.updateHint", { cur: updateInfo.currentVersion || "-", latest: updateInfo.latest.version || "-" })
        : "";
      return h(I18nProvider, { t: tr },
        h("li", { className: "sh-cfg-item" },
        h("div", { className: "sh-cfg" + (open ? " open" : "") },
          h("div", { className: "sh-cfg-h" },
            h(Button, {
              type: "button",
              variant: "ghost",
              className: "sh-cfg-expand",
              "aria-expanded": open,
              onClick: () => setOpen((v) => !v),
            },
              h("span", { className: "sh-cfg-t" },
                h("span", { className: "sh-cfg-n" }, "SkillHub"),
                h("span", { className: "sh-cfg-d" }, versionHint || tr("cfg.desc")),
              ),
              dirty ? h("span", { className: "sh-tag orange" }, tr("cfg.unsaved")) : null,
            ),
            h(IconButton, {
              type: "button",
              variant: "ghost",
              size: "sm",
              className: "sh-cfg-toggle",
              "aria-label": open ? tr("cfg.collapse") : tr("cfg.expand"),
              onClick: () => setOpen((v) => !v),
            }, h(ChevronDown, { className: "sh-cfg-ch" })),
          ),
          open ? h("div", { className: "sh-cfg-b" },
            h(InputField, {
              id: "sh-api",
              label: tr("cfg.api"),
              value: draft.apiBase,
              onChange: (e) => setDraft({ ...draft, apiBase: e.target.value }),
            }),
            h(InputField, {
              id: "sh-dir",
              label: tr("cfg.dir"),
              value: draft.skillsDir,
              onChange: (e) => setDraft({ ...draft, skillsDir: e.target.value }),
            }),
            h(InputField, {
              id: "sh-max",
              label: tr("cfg.max"),
              type: "number",
              min: 1,
              max: 80,
              value: draft.maxResults,
              onChange: (e) => setDraft({ ...draft, maxResults: Number(e.target.value) || 12 }),
            }),
            h("div", { className: "sh-cfg-ft" },
              err ? h("p", { className: "sh-cfg-err" }, err) : null,
              h(Button, { type: "button", size: "sm", variant: "outline", disabled: !dirty || saving, onClick: () => setDraft(saved) }, tr("cfg.discard")),
              h(Button, { type: "button", size: "sm", variant: "primary", disabled: !dirty, loading: saving, onClick: save }, tr("cfg.save")),
            ),
          ) : null,
        ),
      ));
    }
