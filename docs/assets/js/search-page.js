(() => {
  const script = document.currentScript;
  const form = document.querySelector("[data-static-search-form]");
  const input = form?.querySelector('input[name="q"]');
  const status = document.querySelector("[data-search-status]");
  const results = document.querySelector("[data-search-results]");
  if (!script || !form || !input || !status || !results) return;

  const parameters = new URLSearchParams(location.search);
  const query = (parameters.get("q") ?? parameters.get("s") ?? "").trim();
  input.value = query;

  const normalized = query.normalize("NFKC").toLocaleLowerCase("zh-TW");
  const terms = normalized.split(/\s+/).filter(Boolean);
  const documents = Array.isArray(window.MAXLIST_SEARCH_INDEX) ? window.MAXLIST_SEARCH_INDEX : [];

  function resultUrl(url) {
    if (location.protocol === "file:") {
      const siteRoot = new URL("../../", script.src);
      const pathname = url.replace(/^\/+/, "");
      return new URL(`${pathname}${pathname.endsWith("/") ? "index.html" : ""}`, siteRoot).href;
    }
    if (location.hostname.endsWith(".github.io")) {
      const project = location.pathname.split("/").filter(Boolean)[0];
      return project ? `/${project}${url}` : url;
    }
    return url;
  }

  function score(item) {
    if (!terms.length) return 0;
    const title = item.title.normalize("NFKC").toLocaleLowerCase("zh-TW");
    const description = item.description.normalize("NFKC").toLocaleLowerCase("zh-TW");
    const content = item.content.normalize("NFKC").toLocaleLowerCase("zh-TW");
    let total = 0;
    for (const term of terms) {
      if (!title.includes(term) && !description.includes(term) && !content.includes(term)) return 0;
      if (title.includes(term)) total += 12;
      if (description.includes(term)) total += 4;
      if (content.includes(term)) total += 1;
    }
    return total;
  }

  if (!query) {
    status.textContent = "請輸入關鍵字搜尋文章。";
    return;
  }

  const matches = documents
    .map((item) => ({ item, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title, "zh-TW"))
    .slice(0, 100);

  status.textContent = matches.length
    ? `找到 ${matches.length} 篇與「${query}」相關的文章`
    : `找不到與「${query}」相關的文章`;

  const fragment = document.createDocumentFragment();
  for (const { item } of matches) {
    const row = document.createElement("li");
    row.className = "search-result";
    const heading = document.createElement("h2");
    const link = document.createElement("a");
    link.href = resultUrl(item.url);
    link.textContent = item.title;
    heading.append(link);
    const description = document.createElement("p");
    description.textContent = item.description;
    row.append(heading, description);
    fragment.append(row);
  }
  results.append(fragment);
})();
