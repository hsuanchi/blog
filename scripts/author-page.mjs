// The "文章" block on /post/author/: every published post grouped by year, rebuilt on each finalize.
const OPEN_YEARS = 2;

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function topCategories(posts, limit) {
  const counts = new Map();
  for (const post of posts) {
    for (const name of post.categoryNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function authorArchiveYears(posts) {
  const byYear = new Map();
  for (const post of posts) {
    const year = post.published.match(/^(\d{4})-/)?.[1];
    if (!year) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(post);
  }
  return [...byYear.entries()]
    .map(([year, list]) => ({ year, posts: list.sort((a, b) => b.published.localeCompare(a.published) || a.title.localeCompare(b.title)) }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

function renderArchive(years) {
  const peak = years.reduce((best, entry) => (entry.posts.length > best.posts.length ? entry : best), years[0]);
  const chronological = [...years].reverse();
  const bars = chronological.map(({ year, posts }) => {
    const height = Math.round((posts.length / peak.posts.length) * 132) + 6;
    return `<a class="ma-bar${year === peak.year ? " is-peak" : ""}" href="#year-${year}" aria-label="${year} 年 ${posts.length} 篇"><span class="ma-bar-value">${posts.length}</span><span class="ma-bar-fill" style="height:${height}px"></span><span class="ma-bar-year">${year}</span></a>`;
  }).join("");
  const peakCategory = topCategories(peak.posts, 1)[0];
  const note = `${peak.year} 年寫得最多，共 ${peak.posts.length} 篇${peakCategory ? `，其中 ${peakCategory[1]} 篇是 ${escapeHtml(peakCategory[0])}` : ""}。`;
  const blocks = years.map(({ year, posts }, index) => {
    const tags = topCategories(posts, 3).map(([name]) => `<span class="ma-tag">${escapeHtml(name)}</span>`).join("");
    const items = posts.map((post) => {
      const date = post.published.slice(5, 10).replace("-", ".");
      const category = post.categoryNames[0] ? `<span class="ma-post-cat">${escapeHtml(post.categoryNames[0])}</span>` : "";
      return `<li><span class="ma-post-date">${date}</span><a class="ma-post-title" href="/post/${encodeURI(post.slug)}/">${escapeHtml(post.title)}</a>${category}</li>`;
    }).join("");
    return `<details class="ma-year" id="year-${year}"${index < OPEN_YEARS ? " open" : ""}><summary class="ma-year-head"><span class="ma-year-num">${year}</span><span class="ma-year-count">${posts.length} 篇</span><span class="ma-tags">${tags}</span><span class="ma-year-toggle" aria-hidden="true"></span></summary><ol class="ma-posts">${items}</ol><a class="ma-year-all" href="/${year}/">看 ${year} 年全部 ${posts.length} 篇 →</a></details>`;
  }).join("");
  return `<div class="ma-chart">${bars}</div><p class="ma-chart-note"><i aria-hidden="true"></i>${note}</p><div class="ma-years">${blocks}</div>`;
}

export function enhanceAuthorPage($, { posts }) {
  const target = $("[data-author-archive]");
  if (!target.length) return;
  const years = authorArchiveYears(posts);
  if (!years.length) return;
  target.html(renderArchive(years));
}
