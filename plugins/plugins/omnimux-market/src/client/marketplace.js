    const MARKET_CAT_EN = {
      "fun-dressup": "Fun dress-up",
      "web-tools": "Web tools",
      memory: "Memory",
      "agent-workflow": "Agent workflow",
      "model-inference": "Model inference",
      client: "Client",
      "admin-security": "Admin & security",
    };
    const MARKET_CAT_FALLBACK = [
      { key: "fun-dressup", displayName: "趣味换装" },
      { key: "web-tools", displayName: "联网工具" },
      { key: "memory", displayName: "记忆" },
      { key: "agent-workflow", displayName: "Agent 工作流" },
      { key: "model-inference", displayName: "模型推理" },
      { key: "client", displayName: "客户端" },
      { key: "admin-security", displayName: "管理安全" },
    ];

    function pluginLetter(plugin) {
      const raw = String((plugin && plugin.name) || (plugin && plugin.owner) || "");
      const ch = raw.match(/[A-Za-z0-9]|[\u4e00-\u9fff]/);
      return (ch ? ch[0] : "?").toUpperCase();
    }

    function MarketAvatar({ plugin }) {
      const [failed, setFailed] = useState(false);
      const src = !failed && plugin.avatarUrl ? iconSrc(plugin.avatarUrl) : "";
      if (src) {
        return h("img", {
          className: "sh-mkt-avatar",
          src,
          alt: "",
          onError: () => setFailed(true),
        });
      }
      return h("div", {
        className: "sh-mkt-avatar sh-mkt-avatar-fallback",
        "aria-hidden": "true",
      }, pluginLetter(plugin));
    }

    function MarketSearchBar({ query, onQuery, placeholder, onSubmit, submitLabel }) {
      return h("form", {
        className: "sh-mkt-search",
        onSubmit: (e) => { e.preventDefault(); if (onSubmit) onSubmit(); },
      },
        h(FilterBar, {
          compact: true,
          search: h(SearchField, {
            stretch: true,
            value: query,
            debounceMs: 0,
            placeholder,
            onValueChange: onQuery,
          }),
          actions: h(Button, { type: "submit", variant: "primary", size: "sm" }, submitLabel),
        }),
      );
    }

    function StarIcon() {
      return h("svg", {
        className: "sh-star-ico",
        width: 12,
        height: 12,
        viewBox: "0 0 24 24",
        fill: "currentColor",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      },
        h("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" }),
      );
    }

    function installMarketPlugin(plugin) {
      return api("pluginInstall", {
        owner: plugin.owner,
        name: plugin.name,
        fullName: plugin.fullName,
      });
    }

    function phaseLabel(phase, tr) {
      if (phase === "resolving") return tr("mkt.phaseResolving");
      if (phase === "downloading") return tr("mkt.phaseDownloading");
      if (phase === "linking") return tr("mkt.phaseLinking");
      if (phase === "building") return tr("mkt.phaseBuilding");
      return "";
    }

    function progressCopy(status, tr) {
      if (status && status.phase) {
        const bits = [phaseLabel(status.phase, tr)];
        if (status.currentPackage) bits.push(status.currentPackage);
        if (Number(status.done) > 0) bits.push(tr("mkt.packagesDone", { n: status.done }));
        if (Number(status.seconds) > 0) bits.push(status.seconds + "s");
        return bits.filter(Boolean).join(" · ");
      }
      const line = status && status.lastLine;
      if (line) return line + (status.seconds ? "  (" + status.seconds + "s)" : "");
      return tr("mkt.progressHint");
    }

    function progressPercent(status) {
      if (!status || !status.active) return null;
      if (typeof status.size === "number" && status.size > 0 && typeof status.downloaded === "number") {
        return Math.max(4, Math.min(96, Math.round(status.downloaded / status.size * 100)));
      }
      const m = /resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)/.exec(status.lastLine || "");
      if (m && Number(m[1]) > 0) {
        const done = Number(m[2]) + Number(m[3]) + Number(m[4]);
        return Math.max(4, Math.min(96, Math.round(done / Number(m[1]) * 100)));
      }
      return null;
    }

    function Marketplace(props) {
      useEffect(() => ensureCss(), []);
      const tr = typeof props.t === "function" ? props.t : lookup;
      const locale = tr("locale") === "en" ? "en" : "zh";
      const submitted = (props && props.submittedQuery) ?? "";
      const [category, setCategory] = useState("");
      const [page, setPage] = useState(1);
      const [prevSubmitted, setPrevSubmitted] = useState(submitted);
      if (prevSubmitted !== submitted) {
        setPrevSubmitted(submitted);
        setPage(1);
      }
      const [items, setItems] = useState([]);
      const [total, setTotal] = useState(0);
      const [status, setStatus] = useState("loading");
      const [err, setErr] = useState("");
      const [sending, setSending] = useState("");
      const [feedback, setFeedback] = useState("");
      const [cats, setCats] = useState(MARKET_CAT_FALLBACK);
      const [bootId, setBootId] = useState("");
      const [liveStatus, setLiveStatus] = useState(null);
      const [pendingRestart, setPendingRestart] = useState("");
      const [restarting, setRestarting] = useState(false);
      const install = installMarketPlugin;
      useEffect(() => {
        let live = true;
        api("pluginCategories", {})
          .then((d) => {
            if (!live) return;
            const items = Array.isArray(d.items) ? d.items.filter((it) => it && it.key) : [];
            if (items.length) setCats(items);
          })
          .catch(() => {});
        api("pluginInstallStatus", {}).then((d) => {
          if (!live) return;
          if (d.boot) setBootId(d.boot);
        }).catch(() => {});
        api("config", {}).then((d) => {
          if (!live) return;
          if (typeof d.plazaKeepAlive === "boolean") plazaKeepAlive = d.plazaKeepAlive;
        }).catch(() => {});
        return () => { live = false; };
      }, []);
      useEffect(() => {
        let live = true;
        const payload = { q: submitted, scope: "verified", category, sort: "stars", page, pageSize: 48 };
        const key = apiCacheKey("plugins", payload);
        const cached = apiCache.get(key);
        const hasFresh = cached && Date.now() - cached.at < API_CACHE_TTL_MS;
        if (page === 1 && hasFresh) {
          const d = cached.body;
          setItems(d.items || []);
          setTotal(Number(d.total) || 0);
          setStatus("ready");
          setErr("");
        } else if (page === 1) {
          setStatus("loading");
        }
        api("plugins", payload)
          .then((d) => {
            if (!live) return;
            setItems((cur) => page === 1 ? (d.items || []) : cur.concat(d.items || []));
            setTotal(Number(d.total) || 0);
            setStatus("ready");
            setErr("");
          })
          .catch((e) => {
            if (!live) return;
            if (page === 1 && !hasFresh) {
              setItems([]);
              setTotal(0);
              setStatus("error");
              setErr(e.message || String(e));
            }
          });
        return () => { live = false; };
      }, [submitted, category, page]);
      useEffect(() => {
        if (!sending && !restarting) return;
        let live = true;
        const tick = () => {
          api("pluginInstallStatus", {}).then((d) => {
            if (!live) return;
            setLiveStatus(d);
            if (d.boot) setBootId((cur) => cur || d.boot);
          }).catch(() => {});
        };
        tick();
        const timer = setInterval(tick, 800);
        return () => { live = false; clearInterval(timer); };
      }, [sending, restarting]);
      const catLabelFor = (key) => {
        if (!key) return "";
        if (locale === "en" && MARKET_CAT_EN[key]) return MARKET_CAT_EN[key];
        const hit = cats.find((it) => it.key === key);
        return (hit && hit.displayName) || MARKET_CAT_FALLBACK.find((it) => it.key === key)?.displayName || key;
      };
      const detailHref = (plugin) => {
        const repo = String(plugin.repositoryUrl || "").trim();
        if (/^https:\/\/github\.com\//i.test(repo)) return repo;
        return "https://github.com/" + encodeURIComponent(plugin.owner) + "/" + encodeURIComponent(plugin.name);
      };
      const pct = sending ? progressPercent(liveStatus) : null;
      const startRestart = () => {
        if (restarting) return;
        setRestarting(true);
        setFeedback("");
        const previous = bootId;
        const deadline = Date.now() + 60000;
        const awaitNewBoot = () => {
          const poll = () => {
            api("pluginInstallStatus", {}).then((d) => {
              if (typeof d.boot === "string" && previous && d.boot !== previous) {
                location.reload();
                return;
              }
              retry();
            }).catch(retry);
          };
          const retry = () => {
            if (Date.now() > deadline) {
              setRestarting(false);
              setFeedback(tr("mkt.restartTimeout"));
              return;
            }
            setTimeout(poll, 1500);
          };
          poll();
        };
        const requestRestart = (left) => {
          api("pluginRestart", {}).then(() => {
            awaitNewBoot();
          }).catch((e) => {
            const msg = e && e.message ? String(e.message) : String(e);
            if (/cannot restart while|HTTP 409/.test(msg) && left > 0) {
              setTimeout(() => requestRestart(left - 1), 1500);
              return;
            }
            if (/Failed to fetch|NetworkError|HTTP 5/i.test(msg)) {
              awaitNewBoot();
              return;
            }
            setRestarting(false);
            setFeedback(tr("mkt.restartFail", { m: msg }));
          });
        };
        requestRestart(10);
      };
      return h(I18nProvider, { t: tr },
        h("div", { className: "sh-mkt" },
          h("div", { className: "sh-mkt-filters" },
            h(Button, {
              type: "button",
              size: "xs",
              variant: !category ? "secondary" : "ghost",
              onClick: () => { setCategory(""); setPage(1); },
            }, tr("mkt.catAll")),
            cats.map((it) => h(Button, {
              key: it.key,
              type: "button",
              size: "xs",
              variant: category === it.key ? "secondary" : "ghost",
              onClick: () => { setCategory(it.key); setPage(1); },
            }, catLabelFor(it.key))),
          ),
          status === "ready" ? h("div", { className: "sh-mkt-results" },
            h("p", { className: "sh-mkt-summary" }, tr("mkt.repos", { n: total })),
          ) : null,
          sending ? h("div", { className: "sh-mkt-progress" },
            h("div", { className: "sh-mkt-progress-row" },
              h("span", { className: "sh-mkt-progress-text" }, progressCopy(liveStatus, tr)),
              pct != null ? h("span", { className: "sh-mkt-progress-pct" }, pct + "%") : null,
            ),
            h("div", { className: "sh-mkt-bar" },
              h("div", {
                className: "sh-mkt-bar-fill" + (pct == null ? " wave" : ""),
                style: pct != null ? { "--bar-pct": pct + "%" } : undefined,
              }),
            ),
          ) : null,
          pendingRestart && !sending ? h("div", { className: "sh-mkt-banner" },
            h("span", { className: "sh-mkt-banner-text" }, tr("mkt.restartBanner", { name: pendingRestart })),
            h(Button, {
              type: "button",
              size: "sm",
              variant: "primary",
              loading: restarting,
              onClick: startRestart,
            }, tr("mkt.restartNow")),
          ) : null,
          feedback ? h("p", { className: "sh-mkt-status left" }, feedback) : null,
          status === "loading" && page === 1 ? h("p", { className: "sh-mkt-status" }, tr("mkt.loading")) : null,
          status === "error" ? h("p", { className: "sh-mkt-status" }, tr("mkt.error", { m: err })) : null,
          status === "ready" && !items.length ? h("p", { className: "sh-mkt-status" }, tr("mkt.empty")) : null,
          items.length ? h("div", { className: "sh-mkt-grid" },
            items.map((plugin) => {
              const id = plugin.fullName || (plugin.owner + "/" + plugin.name);
              const verified = plugin.installability === "verified";
              const installed = !!plugin.installed;
              const busy = !!sending;
              return h("article", { key: id, className: "sh-mkt-card" + (installed ? " on" : "") },
                h("div", { className: "sh-mkt-head" },
                  h(MarketAvatar, { plugin }),
                  h("div", { className: "sh-mkt-head-main" },
                    h("div", { className: "sh-mkt-top" },
                      h("p", { className: "sh-mkt-owner" }, plugin.owner),
                      h("span", { className: "sh-mkt-badge" + (installed ? " on" : verified ? " ok" : "") },
                        installed ? tr("mkt.installed") : (verified ? tr("mkt.verified") : tr("mkt.unsupported"))),
                    ),
                    h("div", { className: "sh-mkt-name" }, plugin.name),
                  ),
                ),
                h("p", { className: "sh-mkt-desc" }, plugin.description || tr("mkt.noDesc")),
                h("div", { className: "sh-mkt-meta" },
                  h("span", null, catLabelFor(plugin.categoryKey) || plugin.categoryKey),
                  h("span", { className: "sh-mkt-stars" }, h(StarIcon), String(Number(plugin.stars) || 0)),
                ),
                h("div", { className: "sh-mkt-actions" },
                  h("a", { className: "sh-mkt-details", href: detailHref(plugin), target: "_blank", rel: "noreferrer" }, tr("mkt.details")),
                  h(Button, {
                    type: "button",
                    size: "sm",
                    variant: installed ? "ghost" : "primary",
                    disabled: !verified || busy || restarting || installed,
                    loading: sending === id,
                    onClick: () => {
                      setSending(id);
                      setFeedback("");
                      setPendingRestart("");
                      setLiveStatus(null);
                      install(plugin).then(
                        () => {
                          setItems((cur) => cur.map((it) => {
                            const iid = it.fullName || (it.owner + "/" + it.name);
                            return iid === id ? { ...it, installed: true } : it;
                          }));
                          setPendingRestart(plugin.fullName || id);
                        },
                        (e) => setFeedback(e.message || String(e)),
                      ).finally(() => setSending(""));
                    },
                  }, !verified ? tr("mkt.unsupported") : installed ? tr("mkt.installed") : tr("mkt.install")),
                ),
              );
            }),
          ) : null,
          status === "ready" && items.length < total ? h(Button, {
            type: "button",
            variant: "outline",
            className: "sh-mkt-more",
            onClick: () => setPage((n) => n + 1),
          },
            h("span", null, tr("mkt.more")),
            h("span", { className: "sh-mkt-more-left" }, tr("mkt.moreLeft", { n: Math.max(0, total - items.length) })),
            h(ChevronDown),
          ) : null,
        ),
      );
    }
