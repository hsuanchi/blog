import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { ORIGIN, SITE_HOSTS, writeFileEnsured } from "./lib.mjs";

const TITLE = "Max行銷誌｜行銷、數據分析與 Python 教學";
const DESCRIPTION = "Max行銷誌分享數據分析、Looker Studio、GA4／GTM、Python 與 Git 實作教學。依主題找到入門指南，或直接搜尋解決問題的文章。";

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export async function renderHomepage(repoRoot, counts) {
  const docsRoot = path.join(repoRoot, "docs");
  const file = path.join(docsRoot, "index.html");
  const $ = load(await readFile(file, "utf8"));
  const content = load(await readFile(path.join(repoRoot, "scripts/content/homepage.html"), "utf8"), null, false);
  content("[data-home-article-count]").text(counts.total);
  const posts = [];
  for (const entry of await readdir(path.join(docsRoot, "post"), { withFileTypes: true })) {
    if (!entry.isDirectory() || /^netsuite-|^kobo-|cafes$/.test(entry.name)) continue;
    const post = load(await readFile(path.join(docsRoot, "post", entry.name, "index.html"), "utf8"));
    if (!post("body.single-post").length || post("article.status-draft").length || /\bnoindex\b/i.test(post('meta[name="robots"]').attr("content") ?? "")) continue;
    const published = post('meta[property="article:published_time"]').attr("content") ?? "";
    if (!/^\d{4}-/.test(published)) continue;
    const title = post("h1.entry-title").first().text().trim();
    const description = (post('meta[name="description"]').attr("content") ?? "").replace(/\s+/g, " ").trim();
    const rawImage = post('meta[property="og:image"]').attr("content");
    let image = "";
    if (rawImage) {
      const url = new URL(rawImage, ORIGIN);
      if (SITE_HOSTS.has(url.hostname)) image = url.pathname;
    }
    if (title && image) posts.push({ title, description, image, published, href: `/post/${entry.name}/` });
  }
  posts.sort((a, b) => b.published.localeCompare(a.published));
  content("[data-home-recent]").html(posts.slice(0, 3).map((post, index) => {
    const date = post.published.slice(0, 10).replaceAll("-", ".");
    return `<article class="home-post"><a href="${escapeHtml(post.href)}" aria-labelledby="home-recent-${index}"><img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" width="640" height="360" loading="lazy" decoding="async"><div class="home-post-copy"><time datetime="${escapeHtml(post.published)}">${date}</time><h3 id="home-recent-${index}">${escapeHtml(post.title)}</h3><p>${escapeHtml(post.description)}</p></div></a></article>`;
  }).join("\n"));
  $(".entry-content").first().html(content.html());
  $("body").addClass("home");
  $("title").text(TITLE);
  for (const [selector, attributes] of [
    ['meta[name="description"]', { name: "description", content: DESCRIPTION }],
    ['meta[property="og:title"]', { property: "og:title", content: TITLE }],
    ['meta[property="og:description"]', { property: "og:description", content: DESCRIPTION }],
    ['meta[name="twitter:description"]', { name: "twitter:description", content: DESCRIPTION }]
  ]) {
    const node = $(selector).first();
    (node.length ? node : $("<meta>").appendTo("head")).attr(attributes);
  }
  $("head link[rel='stylesheet']").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    if (!/themes\/sydney\/(?:style\.css|css\/styles\.min\.css|css\/bootstrap\/bootstrap\.min\.css)/.test(href)) $(element).remove();
  });
  $("head").append('<link rel="stylesheet" href="assets/css/homepage.css?v=20261103-1">');
  $("style[id]").each((_index, element) => { if ($(element).attr("id") !== "sydney-style-min-inline-css") $(element).remove(); });
  $("script").each((_index, element) => {
    const src = $(element).attr("src") ?? "";
    const code = $(element).html() ?? "";
    if (/urvanov|smush|themes\/sydney\/js\/elementor/.test(src) || /UrvanovSyntaxHighlighter|lazyloadRunObserver|lazySizes\.cfg|const aiTools/.test(code)) $(element).remove();
  });
  const schema = { "@context": "https://schema.org", "@graph": [
    { "@type": "WebSite", "@id": `${ORIGIN}/#website`, url: `${ORIGIN}/`, name: "Max行銷誌", inLanguage: "zh-TW", potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: `${ORIGIN}/search/?q={search_term_string}` }, "query-input": "required name=search_term_string" } },
    { "@type": "WebPage", "@id": `${ORIGIN}/`, url: `${ORIGIN}/`, name: TITLE, description: DESCRIPTION, isPartOf: { "@id": `${ORIGIN}/#website` }, inLanguage: "zh-TW" }
  ] };
  $('script[type="application/ld+json"]').remove();
  $("head").append(`<script type="application/ld+json" class="yoast-schema-graph">${JSON.stringify(schema)}</script>`);
  await writeFileEnsured(file, $.html());
}
