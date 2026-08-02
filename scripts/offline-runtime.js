(() => {
  document.documentElement.dataset.maxlistStaticReady = "true";
  const hashLinks = document.querySelectorAll('a[href^="#"]');
  document.documentElement.dataset.maxlistHashLinks = String(hashLinks.length);
  hashLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const hash = link.getAttribute("href") ?? "";
      if (!hash || hash === "#") return;
      let id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Keep the literal fragment when legacy content contains malformed escaping.
      }
      const target = document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", hash);
    });
  });

  if (location.protocol !== "file:") return;

  const script = document.currentScript;
  if (!script?.src) return;

  const siteRoot = new URL("../../", script.src);
  const siteHosts = new Set(["maxlist.xyz", "www.maxlist.xyz"]);

  function siteUrl(value) {
    if (!value || value.startsWith("#") || /^(data|mailto|tel|javascript|blob):/i.test(value)) {
      return null;
    }
    if (!value.startsWith("/") && !/^https?:\/\//i.test(value)) return null;
    try {
      const url = new URL(value, "https://www.maxlist.xyz/");
      return siteHosts.has(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }

  function offlineUrl(value, pageLink = false) {
    const url = siteUrl(value);
    if (!url) return value;

    let pathname = url.pathname.replace(/^\/+/, "");
    if (pageLink) {
      const finalSegment = pathname.split("/").filter(Boolean).at(-1) ?? "";
      if (!pathname || pathname.endsWith("/")) pathname += "index.html";
      else if (!finalSegment.includes(".")) pathname += "/index.html";
    }
    return new URL(`${pathname}${url.search}${url.hash}`, siteRoot).href;
  }

  const attributes = [
    ["a[href]", "href", true],
    ["form[action]", "action", true],
    ["img[src]", "src", false],
    ["img[data-src]", "data-src", false],
    ["img[data-lazy-src]", "data-lazy-src", false],
    ["source[src]", "src", false],
    ["video[src]", "src", false],
    ["video[poster]", "poster", false],
    ["audio[src]", "src", false],
    ["iframe[src]", "src", false],
    ["object[data]", "data", false],
    ["embed[src]", "src", false]
  ];

  for (const [selector, attribute, pageLink] of attributes) {
    document.querySelectorAll(selector).forEach((element) => {
      const value = element.getAttribute(attribute);
      const rewritten = offlineUrl(value, pageLink);
      if (rewritten !== value) element.setAttribute(attribute, rewritten);
    });
  }

  for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
    document.querySelectorAll(`[${attribute}]`).forEach((element) => {
      const value = element.getAttribute(attribute);
      if (!value) return;
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const [url, ...descriptor] = candidate.trim().split(/\s+/);
          return [offlineUrl(url), ...descriptor].join(" ");
        })
        .join(", ");
      element.setAttribute(attribute, rewritten);
    });
  }
})();
