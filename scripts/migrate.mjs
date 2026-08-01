import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { load } from "cheerio";
import {
  ORIGIN,
  SITE_HOSTS,
  assetOutputPath,
  ensureDir,
  fetchWithRetry,
  isSameSite,
  normalizeSiteUrl,
  pageOutputPath,
  safePathname,
  writeFileEnsured
} from "./lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = path.join(REPO_ROOT, "docs");
const DATE_STAMP = new Date().toISOString().slice(0, 10);
const BACKUP_ROOT = path.resolve(
  process.env.MIGRATION_BACKUP_DIR ??
    path.join(REPO_ROOT, "..", "blog-migration-backup", DATE_STAMP)
);
const RAW_HTML_ROOT = path.join(BACKUP_ROOT, "public-html");
const API_ROOT = path.join(BACKUP_ROOT, "wordpress-rest-api");
const REPORT_ROOT = path.join(REPO_ROOT, "reports");

const PAGE_CONCURRENCY = 3;
const ASSET_CONCURRENCY = 8;
const SKIP_PATH_PREFIXES = [
  "/wp-admin",
  "/wp-login.php",
  "/wp-json",
  "/xmlrpc.php",
  "/wp-cron.php",
  "/wp-comments-post.php"
];
const SKIP_PATH_SUFFIXES = ["/feed/", "/trackback/", "/embed/"];
const ASSET_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".css",
  ".csv",
  ".eot",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".svg",
  ".ttf",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xml",
  ".zip"
]);

const crawlQueue = [];
const enqueuedPages = new Set();
const fetchedPages = new Set();
const failedPages = [];
const assetQueue = [];
const enqueuedAssets = new Set();
const downloadedAssets = new Set();
const failedAssets = [];
const pageRecords = [];
const apiSummary = {};

function canonicalize(input, base = ORIGIN) {
  const url = new URL(input, base);
  if (SITE_HOSTS.has(url.hostname)) {
    url.protocol = "https:";
    url.hostname = "www.maxlist.xyz";
    url.port = "";
  }
  return url;
}

function rootRelative(input, base = ORIGIN) {
  const url = canonicalize(input, base);
  return `${url.pathname}${url.search}${url.hash}`;
}

function hasAssetExtension(pathname) {
  return ASSET_EXTENSIONS.has(path.extname(pathname).toLowerCase());
}

function shouldCrawl(input, base = ORIGIN) {
  let url;
  try {
    url = canonicalize(input, base);
  } catch {
    return false;
  }

  if (!SITE_HOSTS.has(url.hostname)) return false;
  if (!new Set(["http:", "https:"]).has(url.protocol)) return false;
  if (SKIP_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return false;
  if (SKIP_PATH_SUFFIXES.some((suffix) => url.pathname.endsWith(suffix))) return false;
  if (hasAssetExtension(url.pathname)) return false;

  // Search and preview URLs are dynamic and cannot be represented as stable files.
  if (url.searchParams.has("s") || url.searchParams.has("preview")) return false;
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || ["fbclid", "gclid"].includes(key)) {
      url.searchParams.delete(key);
    }
  }
  if ([...url.searchParams.keys()].length > 0) return false;
  return true;
}

function enqueuePage(input, base = ORIGIN) {
  if (!shouldCrawl(input, base)) return;
  const url = canonicalize(input, base);
  url.hash = "";
  const key = url.href;
  if (enqueuedPages.has(key)) return;
  enqueuedPages.add(key);
  crawlQueue.push(key);
}

function enqueueAsset(input, base = ORIGIN) {
  let url;
  try {
    url = canonicalize(input, base);
  } catch {
    return;
  }
  if (!SITE_HOSTS.has(url.hostname)) return;
  if (!new Set(["http:", "https:"]).has(url.protocol)) return;
  if (url.pathname.endsWith("/")) return;
  url.hash = "";
  const key = url.href;
  if (enqueuedAssets.has(key)) return;
  enqueuedAssets.add(key);
  assetQueue.push(key);
}

function parseSrcset(srcset, base) {
  return srcset
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [candidate, ...descriptor] = entry.split(/\s+/);
      let resolved = candidate;
      try {
        const url = canonicalize(candidate, base);
        if (SITE_HOSTS.has(url.hostname)) {
          enqueueAsset(url.href);
          resolved = rootRelative(url.href);
        }
      } catch {
        // Preserve malformed or data URL candidates exactly as supplied.
      }
      return [resolved, ...descriptor].join(" ");
    })
    .join(", ");
}

function cssReferences(css, base) {
  const references = [];
  const urlPattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  const importPattern = /@import\s+(["'])([^"']+)\1/gi;
  for (const match of css.matchAll(urlPattern)) references.push(match[2].trim());
  for (const match of css.matchAll(importPattern)) references.push(match[2].trim());

  for (const reference of references) {
    if (!reference || reference.startsWith("data:") || reference.startsWith("#")) continue;
    enqueueAsset(reference, base);
  }
  return references;
}

function rewriteCss(css, base) {
  cssReferences(css, base);
  const rewrite = (reference) => {
    if (!reference || reference.startsWith("data:") || reference.startsWith("#")) {
      return reference;
    }
    try {
      const url = canonicalize(reference, base);
      return SITE_HOSTS.has(url.hostname) ? rootRelative(url.href) : reference;
    } catch {
      return reference;
    }
  };

  return css
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_whole, quote, reference) => {
      const next = rewrite(reference.trim());
      return `url(${quote}${next}${quote})`;
    })
    .replace(/@import\s+(["'])([^"']+)\1/gi, (_whole, quote, reference) => {
      return `@import ${quote}${rewrite(reference.trim())}${quote}`;
    });
}

function discoverAndRewritePage(html, pageUrl) {
  const $ = load(html, { decodeEntities: false });

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }
    enqueuePage(href, pageUrl);
  });

  $("iframe[src]").each((_index, element) => {
    const src = $(element).attr("src");
    if (src && isSameSite(src, pageUrl)) enqueuePage(src, pageUrl);
  });

  const simpleAssetAttributes = [
    ["script[src]", "src"],
    ["img[src]", "src"],
    ["img[data-src]", "data-src"],
    ["img[data-lazy-src]", "data-lazy-src"],
    ["source[src]", "src"],
    ["video[src]", "src"],
    ["video[poster]", "poster"],
    ["audio[src]", "src"],
    ["track[src]", "src"],
    ["input[type=image][src]", "src"],
    ["object[data]", "data"],
    ["use[href]", "href"],
    ["use[xlink\\:href]", "xlink:href"]
  ];

  for (const [selector, attribute] of simpleAssetAttributes) {
    $(selector).each((_index, element) => {
      const value = $(element).attr(attribute);
      if (!value || value.startsWith("data:") || value.startsWith("#")) return;
      if (isSameSite(value, pageUrl)) {
        enqueueAsset(value, pageUrl);
        $(element).attr(attribute, rootRelative(value, pageUrl));
      }
    });
  }

  $("link[href]").each((_index, element) => {
    const rel = ($(element).attr("rel") ?? "").toLowerCase();
    const as = ($(element).attr("as") ?? "").toLowerCase();
    const href = $(element).attr("href");
    const isAssetLink =
      /stylesheet|icon|preload|modulepreload/.test(rel) ||
      ["font", "image", "script", "style"].includes(as) ||
      (href && hasAssetExtension(new URL(href, pageUrl).pathname));
    if (href && isAssetLink && isSameSite(href, pageUrl)) {
      enqueueAsset(href, pageUrl);
      $(element).attr("href", rootRelative(href, pageUrl));
    }
  });

  for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
    $(`[${attribute}]`).each((_index, element) => {
      const value = $(element).attr(attribute);
      if (value) $(element).attr(attribute, parseSrcset(value, pageUrl));
    });
  }

  // Replace lazy-load placeholders with the actual image so every static page works
  // even if a WordPress optimization plugin is no longer present.
  $("img[data-src], img[data-lazy-src]").each((_index, element) => {
    const actual = $(element).attr("data-src") ?? $(element).attr("data-lazy-src");
    if (actual) $(element).attr("src", actual);
    const actualSrcset =
      $(element).attr("data-srcset") ?? $(element).attr("data-lazy-srcset");
    if (actualSrcset) $(element).attr("srcset", actualSrcset);
    $(element).removeAttr("loading-placeholder");
  });

  $("style").each((_index, element) => {
    const contents = $(element).html() ?? "";
    $(element).html(rewriteCss(contents, pageUrl));
  });
  $("[style]").each((_index, element) => {
    const contents = $(element).attr("style") ?? "";
    $(element).attr("style", rewriteCss(contents, pageUrl));
  });

  // Normalize every remaining same-site URL while retaining query strings and anchors.
  const navigationalAttributes = [
    ["a[href]", "href"],
    ["form[action]", "action"],
    ["iframe[src]", "src"]
  ];
  for (const [selector, attribute] of navigationalAttributes) {
    $(selector).each((_index, element) => {
      const value = $(element).attr(attribute);
      if (value && !value.startsWith("#") && isSameSite(value, pageUrl)) {
        $(element).attr(attribute, rootRelative(value, pageUrl));
      }
    });
  }

  for (const attribute of ["content", "href"]) {
    $(`link[${attribute}], meta[${attribute}]`).each((_index, element) => {
      const value = $(element).attr(attribute);
      if (value && /^https?:\/\//i.test(value) && isSameSite(value, pageUrl)) {
        const normalized = canonicalize(value, pageUrl);
        normalized.hash = new URL(value, pageUrl).hash;
        $(element).attr(attribute, normalized.href);
      }
    });
  }

  return $.html();
}

async function saveJson(file, value) {
  await writeFileEnsured(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchApiCollection(route) {
  const firstUrl = `${ORIGIN}/wp-json/wp/v2/${route}?per_page=100&page=1`;
  const firstResponse = await fetchWithRetry(firstUrl, { accept: "application/json" });
  const firstPage = await firstResponse.json();
  const totalPages = Number(firstResponse.headers.get("x-wp-totalpages") ?? 1);
  const total = Number(firstResponse.headers.get("x-wp-total") ?? firstPage.length);
  const pages = [firstPage];
  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
    const response = await fetchWithRetry(
      `${ORIGIN}/wp-json/wp/v2/${route}?per_page=100&page=${pageNumber}`,
      { accept: "application/json" }
    );
    pages.push(await response.json());
  }
  const items = pages.flat();
  await saveJson(path.join(API_ROOT, `${route}.json`), items);
  apiSummary[route] = { reportedTotal: total, fetched: items.length, pages: totalPages };
  return items;
}

async function inventoryWordPress() {
  console.log("Inventorying public WordPress REST API …");
  const posts = await fetchApiCollection("posts");
  const pages = await fetchApiCollection("pages");
  const media = await fetchApiCollection("media");
  const categories = await fetchApiCollection("categories");
  const tags = await fetchApiCollection("tags");

  for (const item of [...posts, ...pages]) {
    if (item.link) enqueuePage(item.link);
  }
  for (const item of media) {
    if (item.source_url) enqueueAsset(item.source_url);
    if (item.guid?.rendered) enqueueAsset(item.guid.rendered);
    for (const size of Object.values(item.media_details?.sizes ?? {})) {
      if (size?.source_url) enqueueAsset(size.source_url);
    }
  }
  await saveJson(path.join(API_ROOT, "summary.json"), {
    generatedAt: new Date().toISOString(),
    collections: apiSummary,
    publishedPostLinks: posts.map((item) => item.link),
    publishedPageLinks: pages.map((item) => item.link),
    categories: categories.map(({ id, count, link, name, slug }) => ({ id, count, link, name, slug })),
    tags: tags.map(({ id, count, link, name, slug }) => ({ id, count, link, name, slug }))
  });
}

async function discoverSitemap(startUrl) {
  const pending = [startUrl];
  const visited = new Set();
  while (pending.length > 0) {
    const requested = pending.shift();
    const url = canonicalize(requested).href;
    if (visited.has(url)) continue;
    visited.add(url);
    const response = await fetchWithRetry(url, { accept: "application/xml,text/xml,*/*" });
    const xml = await response.text();
    const filename = `${String(visited.size).padStart(2, "0")}-${path.basename(new URL(url).pathname) || "sitemap.xml"}`;
    await writeFileEnsured(path.join(BACKUP_ROOT, "sitemaps", filename), xml);
    const $ = load(xml, { xmlMode: true });
    $("sitemapindex > sitemap > loc").each((_index, element) => {
      pending.push($(element).text().trim());
    });
    $("urlset > url > loc").each((_index, element) => enqueuePage($(element).text().trim()));
  }
  return visited.size;
}

async function processPage(pageUrl) {
  try {
    const response = await fetchWithRetry(pageUrl, {
      accept: "text/html,application/xhtml+xml",
      allowNotFound: true
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status === 404 || !contentType.includes("text/html")) {
      failedPages.push({ url: pageUrl, status: response.status, reason: contentType || "not HTML" });
      return;
    }
    const html = await response.text();
    await writeFileEnsured(pageOutputPath(RAW_HTML_ROOT, pageUrl), html);
    const rewritten = discoverAndRewritePage(html, pageUrl);
    const outputFile = pageOutputPath(OUTPUT_ROOT, pageUrl);
    await writeFileEnsured(outputFile, rewritten);
    fetchedPages.add(pageUrl);
    pageRecords.push({
      url: pageUrl,
      output: path.relative(REPO_ROOT, outputFile),
      bytes: Buffer.byteLength(rewritten)
    });
    if (fetchedPages.size % 50 === 0) {
      console.log(`  ${fetchedPages.size} HTML pages saved; ${crawlQueue.length} discovered`);
    }
  } catch (error) {
    failedPages.push({ url: pageUrl, reason: error.message });
  }
}

async function crawlPages() {
  let cursor = 0;
  while (cursor < crawlQueue.length) {
    const batch = crawlQueue.slice(cursor, cursor + PAGE_CONCURRENCY);
    cursor += batch.length;
    await Promise.all(batch.map(processPage));
  }
}

async function processAsset(assetUrl) {
  try {
    const response = await fetchWithRetry(assetUrl, { allowNotFound: true });
    if (response.status === 404) {
      failedAssets.push({ url: assetUrl, status: 404 });
      return;
    }
    const contentType = response.headers.get("content-type") ?? "";
    let contents;
    if (contentType.includes("text/css") || new URL(assetUrl).pathname.endsWith(".css")) {
      contents = rewriteCss(await response.text(), assetUrl);
    } else {
      contents = Buffer.from(await response.arrayBuffer());
    }
    const outputFile = assetOutputPath(OUTPUT_ROOT, assetUrl);
    await writeFileEnsured(outputFile, contents);
    downloadedAssets.add(assetUrl);
    if (downloadedAssets.size % 250 === 0) {
      console.log(`  ${downloadedAssets.size} assets saved; ${assetQueue.length} discovered`);
    }
  } catch (error) {
    failedAssets.push({ url: assetUrl, reason: error.message });
  }
}

async function downloadAssets() {
  let cursor = 0;
  while (cursor < assetQueue.length) {
    const batch = assetQueue.slice(cursor, cursor + ASSET_CONCURRENCY);
    cursor += batch.length;
    await Promise.all(batch.map(processAsset));
  }
}

async function main() {
  await Promise.all([
    ensureDir(OUTPUT_ROOT),
    ensureDir(BACKUP_ROOT),
    ensureDir(REPORT_ROOT)
  ]);
  enqueuePage(ORIGIN);
  const sitemapCount = await discoverSitemap(`${ORIGIN}/sitemap_index.xml`);
  await inventoryWordPress();

  console.log(`Crawling ${crawlQueue.length} initial public URLs from ${sitemapCount} sitemaps …`);
  await crawlPages();
  console.log(`Downloading ${assetQueue.length} discovered same-origin assets …`);
  await downloadAssets();

  const report = {
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    sitemaps: sitemapCount,
    api: apiSummary,
    pages: {
      discovered: enqueuedPages.size,
      saved: fetchedPages.size,
      failed: failedPages
    },
    assets: {
      discovered: enqueuedAssets.size,
      saved: downloadedAssets.size,
      failed: failedAssets
    },
    pageRecords
  };
  await saveJson(path.join(REPORT_ROOT, "migration.json"), report);
  await writeFileEnsured(path.join(OUTPUT_ROOT, ".nojekyll"), "");
  await writeFileEnsured(
    path.join(OUTPUT_ROOT, ".migration-state.json"),
    `${JSON.stringify({ completedAt: report.generatedAt }, null, 2)}\n`
  );
  console.log(
    `Migration snapshot complete: ${fetchedPages.size} pages, ${downloadedAssets.size} assets, ` +
      `${failedPages.length} page failures, ${failedAssets.length} asset failures.`
  );
}

await main();
