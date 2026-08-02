import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { writeFileEnsured } from "./lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const MIGRATION_REPORT = path.join(REPO_ROOT, "reports", "migration.json");
const OFFLINE_RUNTIME_SOURCE = path.join(REPO_ROOT, "scripts", "offline-runtime.js");
const OFFLINE_RUNTIME_OUTPUT = path.join(DOCS_ROOT, "assets", "js", "offline.js");
const SITE_ORIGIN = "https://www.maxlist.xyz";

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(absolute)));
    else files.push(absolute);
  }
  return files;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cleanGeneratedText(value) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
}

function canonicalForFile(file) {
  const relative = path.relative(DOCS_ROOT, file).split(path.sep).join("/");
  if (relative === "index.html") return `${SITE_ORIGIN}/`;
  return `${SITE_ORIGIN}/${relative.replace(/index\.html$/, "")}`;
}

function normalizedCanonical(input, fallback) {
  try {
    const url = new URL(input || fallback, SITE_ORIGIN);
    if (new Set(["maxlist.xyz", "www.maxlist.xyz"]).has(url.hostname)) {
      url.protocol = "https:";
      url.hostname = "www.maxlist.xyz";
      url.port = "";
    }
    url.hash = "";
    return url.href;
  } catch {
    return fallback;
  }
}

function decodedPathname(input) {
  try {
    const pathname = new URL(input, SITE_ORIGIN).pathname;
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  } catch {
    return "";
  }
}

function isSameSiteReference(input) {
  if (!input || input.startsWith("#")) return true;
  if (/^(mailto|tel|javascript|data|blob):/i.test(input)) return false;
  try {
    const url = new URL(input, SITE_ORIGIN);
    return new Set(["maxlist.xyz", "www.maxlist.xyz"]).has(url.hostname);
  } catch {
    return false;
  }
}

let migrationReport = null;
try {
  migrationReport = JSON.parse(await readFile(MIGRATION_REPORT, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const failedAssetPaths = new Set(
  (migrationReport?.assets?.failed ?? []).map(({ url }) => decodedPathname(url))
);
const isFailedAsset = (reference) => failedAssetPaths.has(decodedPathname(reference));

function cleanedSrcset(value) {
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .filter((candidate) => !isFailedAsset(candidate.split(/\s+/)[0]))
    .join(", ");
}

function relativeRootReference(reference, sourceFile) {
  if (!reference?.startsWith("/") || reference.startsWith("//")) return reference;
  try {
    const url = new URL(reference, SITE_ORIGIN);
    const prefix = path.relative(path.dirname(sourceFile), DOCS_ROOT).split(path.sep).join("/");
    const pathname = url.pathname.replace(/^\/+/, "");
    const relative = prefix ? `${prefix}/${pathname}` : pathname;
    return `${relative || "."}${url.search}${url.hash}`;
  } catch {
    return reference;
  }
}

function relativeSrcset(value, sourceFile) {
  return value
    .split(",")
    .map((candidate) => {
      const [url, ...descriptor] = candidate.trim().split(/\s+/);
      return [relativeRootReference(url, sourceFile), ...descriptor].join(" ");
    })
    .join(", ");
}

function relativizePageResources($, file) {
  const attributes = [
    ["link[href]", "href"],
    ["script[src]", "src"],
    ["img[src]", "src"],
    ["img[data-src]", "data-src"],
    ["img[data-lazy-src]", "data-lazy-src"],
    ["source[src]", "src"],
    ["video[src]", "src"],
    ["video[poster]", "poster"],
    ["audio[src]", "src"],
    ["iframe[src]", "src"],
    ["object[data]", "data"],
    ["embed[src]", "src"],
    ["input[src]", "src"],
    ["[background]", "background"]
  ];
  for (const [selector, attribute] of attributes) {
    $(selector).each((_index, element) => {
      const value = $(element).attr(attribute);
      if (value) $(element).attr(attribute, relativeRootReference(value, file));
    });
  }
  for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
    $(`[${attribute}]`).each((_index, element) => {
      const value = $(element).attr(attribute);
      if (value) $(element).attr(attribute, relativeSrcset(value, file));
    });
  }
}

function relativizeCssRootUrls(css, file) {
  return css.replace(
    /url\(\s*(["']?)(\/(?!\/)[^"')]+)\1\s*\)/g,
    (_match, quote, reference) => `url(${quote}${relativeRootReference(reference, file)}${quote})`
  );
}

function decodeCloudflareEmail(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return "";
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let email = "";
  for (let index = 2; index < hex.length; index += 2) {
    email += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16) ^ key);
  }
  return email;
}

const htmlFiles = (await filesBelow(DOCS_ROOT)).filter(
  (file) => file.endsWith(".html") && path.relative(DOCS_ROOT, file) !== "404.html"
);
await writeFileEnsured(OFFLINE_RUNTIME_OUTPUT, await readFile(OFFLINE_RUNTIME_SOURCE, "utf8"));
const sitemapEntries = [];
const feedArticles = [];
let finalized = 0;

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const $ = load(html, { decodeEntities: false });

  $('link[rel="EditURI"], link[rel="shortlink"], link[rel="https://api.w.org/"], link[rel="pingback"]').remove();
  $('link[type="application/json+oembed"], link[type="text/xml+oembed"]').remove();
  $('link[rel="alternate"][type="application/json"]').remove();
  $('link[rel="alternate"][type="application/rss+xml"]').attr("href", "/feed.xml");
  $('link[rel="dns-prefetch"][href*="stats.wp.com"]').remove();
  $('meta[name="generator"]').remove();
  $(".preloader").remove();

  $('script[src*="static.cloudflareinsights.com/beacon.min.js"], script[src*="/cdn-cgi/scripts/"][src*="email-decode"]').remove();
  $("script:not([src])").each((_index, element) => {
    const script = $(element).html() ?? "";
    if (
      script.includes("window.__CF$cv$params") ||
      script.includes("/cdn-cgi/challenge-platform/") ||
      script.includes("_stq = window._stq") ||
      script.includes("var wc_order_attribution =")
    ) {
      $(element).remove();
    }
  });

  $("link[href], script[src]").each((_index, element) => {
    const attribute = element.tagName === "link" ? "href" : "src";
    const value = $(element).attr(attribute);
    if (value && isFailedAsset(value)) $(element).remove();
  });

  for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
    $(`[${attribute}]`).each((_index, element) => {
      const value = $(element).attr(attribute) ?? "";
      const cleaned = cleanedSrcset(value);
      if (cleaned) $(element).attr(attribute, cleaned);
      else $(element).removeAttr(attribute);
    });
  }

  $("img").each((_index, element) => {
    for (const attribute of ["data-src", "data-lazy-src"]) {
      const value = $(element).attr(attribute);
      if (value && isFailedAsset(value)) $(element).removeAttr(attribute);
    }
    const source = $(element).attr("src") ?? "";
    if (source && isFailedAsset(source)) {
      const srcset = $(element).attr("srcset") ?? $(element).attr("data-srcset") ?? "";
      const candidate = srcset.split(",").map((entry) => entry.trim().split(/\s+/)[0]).find(Boolean);
      const lazy = $(element).attr("data-src") ?? $(element).attr("data-lazy-src") ?? "";
      const fallback = candidate || (lazy && !isFailedAsset(lazy) ? lazy : "");
      if (fallback) $(element).attr("src", fallback);
      else $(element).removeAttr("src");
    }
  });

  $("source[src], video[src], video[poster], audio[src]").each((_index, element) => {
    for (const attribute of ["src", "poster"]) {
      const value = $(element).attr(attribute);
      if (value && isFailedAsset(value)) $(element).removeAttr(attribute);
    }
  });

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const embeddedSiteUrl = href.match(/_https?:\/\/(?:www\.)?maxlist\.xyz(\/.*?)(?:\/_)?$/i);
    if (embeddedSiteUrl) {
      $(element).attr("href", embeddedSiteUrl[1].replace(/\/_$/, "/"));
      return;
    }
    const pathname = decodedPathname(href);
    if (pathname.endsWith("/feed/")) {
      $(element).attr("href", "/feed.xml");
      return;
    }
    if (isFailedAsset(href)) {
      const imageFallback = $(element).find("img[src]").first().attr("src");
      if (imageFallback && !isFailedAsset(imageFallback)) $(element).attr("href", imageFallback);
      else $(element).removeAttr("href");
    }
  });

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    if (!isSameSiteReference(href)) return;
    $(element).removeAttr("target");
    const rel = ($(element).attr("rel") ?? "")
      .split(/\s+/)
      .filter((value) => value && !new Set(["noopener", "noreferrer"]).has(value));
    if (rel.length) $(element).attr("rel", rel.join(" "));
    else $(element).removeAttr("rel");
  });

  $("a.__cf_email__[data-cfemail]").each((_index, element) => {
    const email = decodeCloudflareEmail($(element).attr("data-cfemail") ?? "");
    if (!email) return;
    $(element).attr("href", `mailto:${email}`);
    $(element).text(email);
  });

  $("iframe[data-src], iframe[data-lazy-src]").each((_index, element) => {
    const actual = $(element).attr("data-src") ?? $(element).attr("data-lazy-src");
    if (actual) $(element).attr("src", actual);
  });

  $('a[target="_blank"]').each((_index, element) => {
    const values = new Set(($(element).attr("rel") ?? "").split(/\s+/).filter(Boolean));
    values.add("noopener");
    values.add("noreferrer");
    $(element).attr("rel", [...values].join(" "));
  });

  if (!$('meta[name="maxlist-static-snapshot"]').length) {
    $("head").append('<meta name="maxlist-static-snapshot" content="2026-08-01">');
  }

  const offlineScript = relativeRootReference("/assets/js/offline.js?v=20260802-5", file);
  const offlineElement = $('script[data-maxlist-offline="true"]').first();
  if (offlineElement.length) offlineElement.attr("src", offlineScript);
  else $("body").append(`<script data-maxlist-offline="true" src="${offlineScript}"></script>`);

  const fallback = canonicalForFile(file);
  const canonicalElement = $('link[rel="canonical"]').first();
  const canonical = normalizedCanonical(canonicalElement.attr("href"), fallback);
  if (canonicalElement.length) canonicalElement.attr("href", canonical);
  else $("head").append(`<link rel="canonical" href="${canonical}">`);

  const modified =
    $('meta[property="article:modified_time"]').attr("content") ??
    $("time.updated, time.entry-date").first().attr("datetime") ??
    "";
  sitemapEntries.push({ location: canonical, modified });
  if (($('meta[property="og:type"]').attr("content") ?? "").toLowerCase() === "article") {
    feedArticles.push({
      title:
        $('meta[property="og:title"]').attr("content") ??
        $("title").text().trim(),
      description:
        $('meta[property="og:description"]').attr("content") ??
        $('meta[name="description"]').attr("content") ??
        "",
      link: canonical,
      published:
        $('meta[property="article:published_time"]').attr("content") ??
        $("time.entry-date").first().attr("datetime") ??
        modified
    });
  }
  relativizePageResources($, file);
  await writeFileEnsured(file, cleanGeneratedText($.html()));
  finalized += 1;
}

const homepage = await readFile(path.join(DOCS_ROOT, "index.html"), "utf8");
const $404 = load(homepage, { decodeEntities: false });
$404("body")
  .removeClass("home blog")
  .addClass("error404");
$404("title").text("找不到頁面 — Max行銷誌");
$404('link[rel="canonical"]').remove();
$404('meta[name="robots"]').remove();
$404("head").append('<meta name="robots" content="noindex, follow">');
$404("#primary main").html(`<section class="error-404 not-found">
  <header class="page-header"><h1 class="page-title">找不到這個頁面</h1></header>
  <div class="page-content">
    <p>你要找的內容可能已移動或網址有誤。請回到首頁繼續瀏覽 Max行銷誌。</p>
    <p><a class="roll-button button" href="/">返回首頁</a></p>
  </div>
</section>`);
await writeFileEnsured(path.join(DOCS_ROOT, "404.html"), cleanGeneratedText($404.html()));

let offlineCssFiles = 0;
for (const file of (await filesBelow(DOCS_ROOT)).filter((candidate) => candidate.endsWith(".css"))) {
  const css = await readFile(file, "utf8");
  const rewritten = relativizeCssRootUrls(css, file);
  const cleaned = cleanGeneratedText(rewritten);
  if (cleaned !== css) {
    await writeFileEnsured(file, cleaned);
    offlineCssFiles += 1;
  }
}

const uniqueEntries = [...new Map(sitemapEntries.map((entry) => [entry.location, entry])).values()]
  .filter((entry) => entry.location.startsWith(`${SITE_ORIGIN}/`))
  .sort((left, right) => left.location.localeCompare(right.location, "zh-Hant"));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${uniqueEntries
  .map(
    ({ location, modified }) =>
      `  <url>\n    <loc>${escapeXml(location)}</loc>${
        modified ? `\n    <lastmod>${escapeXml(modified)}</lastmod>` : ""
      }\n  </url>`
  )
  .join("\n")}
</urlset>
`;
await writeFileEnsured(path.join(DOCS_ROOT, "sitemap.xml"), sitemap);
await writeFileEnsured(
  path.join(DOCS_ROOT, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`
);

const recentArticles = feedArticles
  .sort((left, right) => new Date(right.published || 0) - new Date(left.published || 0))
  .slice(0, 30);
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Max行銷誌</title>
    <link>${SITE_ORIGIN}/</link>
    <description>行銷、數據分析、與 Python</description>
    <language>zh-TW</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_ORIGIN}/feed.xml" rel="self" type="application/rss+xml" />
${recentArticles
  .map(
    ({ title, description, link, published }) => `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${new Date(published || 0).toUTCString()}</pubDate>
      <description>${escapeXml(description)}</description>
    </item>`
  )
  .join("\n")}
  </channel>
</rss>
`;
await writeFileEnsured(path.join(DOCS_ROOT, "feed.xml"), rss);

// The public report is committed; keep machine-specific backup paths private.
if (migrationReport) {
  delete migrationReport.backupRoot;
  await writeFileEnsured(MIGRATION_REPORT, `${JSON.stringify(migrationReport, null, 2)}\n`);
}

console.log(
  `Finalized ${finalized} HTML pages for web and offline use; removed the blocking preloader, ` +
    `rewrote ${offlineCssFiles} CSS files, and generated 404.html, feed.xml, robots.txt, ` +
    `and a ${uniqueEntries.length}-URL sitemap.`
);
