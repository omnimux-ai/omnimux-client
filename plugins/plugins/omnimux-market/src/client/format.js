    function initials(name) {
      const t = String(name || "").replace(/[a-zA-Z0-9._-]/g, "");
      return (t.slice(0, 3) || String(name || "SK").slice(0, 2)).toUpperCase();
    }

    function pluginUrl(path) {
      const suffix = String(path || "").replace(/^\/+/, "");
      const base = typeof document !== "undefined" ? document.baseURI : "/";
      return new URL("./omnimux-market" + (suffix ? "/" + suffix : ""), base).toString();
    }

    function iconSrc(url) {
      if (!url) return "";
      if (url.startsWith("data:")) return url;
      return pluginUrl("icon?url=" + encodeURIComponent(url));
    }

    function fmt(n, tr) {
      const v = Number(n) || 0;
      const en = tr && tr("locale") === "en";
      if (en) {
        if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1) + "M";
        if (v >= 10000) return (v / 1000).toFixed(v >= 100000 ? 0 : 1) + "k";
        return String(v);
      }
      if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + " 万";
      return String(v);
    }

    function fmtStat(n, tr) {
      if (n == null || n === "") return "…";
      return fmt(n, tr);
    }

    function fmtTime(n, tr) {
      const t = Number(n);
      if (!t) return "";
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) return "";
      const loc = tr && tr("locale") === "en" ? "en-US" : "zh-CN";
      return d.toLocaleDateString(loc, { year: "numeric", month: "short", day: "numeric" });
    }
