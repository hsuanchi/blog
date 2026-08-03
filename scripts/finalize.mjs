import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { writeFileEnsured } from "./lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const MIGRATION_REPORT = path.join(REPO_ROOT, "reports", "migration.json");
const OFFLINE_RUNTIME_SOURCE = path.join(REPO_ROOT, "scripts", "offline-runtime.js");
const OFFLINE_RUNTIME_OUTPUT = path.join(DOCS_ROOT, "assets", "js", "offline.js");
const SEARCH_INDEX_OUTPUT = path.join(DOCS_ROOT, "assets", "js", "search-index.js");
const SEARCH_PAGE_OUTPUT = path.join(DOCS_ROOT, "search", "index.html");
const SITE_ORIGIN = "https://www.maxlist.xyz";
const OFFLINE_RUNTIME_VERSION = "20260802-7";
const COMPONENT_VERSION = "20260803-1";
const CANONICAL_ALIASES = new Map([["首頁/index.html", `${SITE_ORIGIN}/`]]);
const OBSOLETE_COMMERCE_PATHS = ["cart", "checkout", "my-account", "shop"];

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

function plainText(value) {
  return value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

function conciseDescription(value, limit = 160) {
  const text = plainText(value).replace(/\s*\[…\]\s*$/, "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function ensureMeta($, selector, attributes) {
  const existing = $(selector).first();
  if (existing.length) {
    for (const [name, value] of Object.entries(attributes)) existing.attr(name, value);
    return existing;
  }
  const element = $("<meta>").attr(attributes);
  $("head").append(element);
  return element;
}

function setNoindex($) {
  ensureMeta($, 'meta[name="robots"]', { name: "robots", content: "noindex, follow" });
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

function retargetReference(reference, sourcePageUrl, targetFile) {
  if (!reference || reference.startsWith("#") || /^(data|mailto|tel|javascript|blob):/i.test(reference)) {
    return reference;
  }
  try {
    const url = new URL(reference, sourcePageUrl);
    if (!new Set(["maxlist.xyz", "www.maxlist.xyz"]).has(url.hostname)) return reference;
    return relativeRootReference(`${url.pathname}${url.search}${url.hash}`, targetFile);
  } catch {
    return reference;
  }
}

function retargetPageResources($, sourcePageUrl, targetFile) {
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
    ["iframe[src]", "src"]
  ];
  for (const [selector, attribute] of attributes) {
    $(selector).each((_index, element) => {
      if (element.tagName === "link" && ($(element).attr("rel") ?? "").includes("canonical")) return;
      const value = $(element).attr(attribute);
      if (value) $(element).attr(attribute, retargetReference(value, sourcePageUrl, targetFile));
    });
  }
  for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
    $(`[${attribute}]`).each((_index, element) => {
      const value = $(element).attr(attribute) ?? "";
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const [url, ...descriptor] = candidate.trim().split(/\s+/);
          return [retargetReference(url, sourcePageUrl, targetFile), ...descriptor].join(" ");
        })
        .join(", ");
      $(element).attr(attribute, rewritten);
    });
  }
  $("style").each((_index, element) => {
    const css = $(element).html() ?? "";
    $(element).html(
      css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (_match, quote, reference) => {
        const rewritten = retargetReference(reference, sourcePageUrl, targetFile);
        return `url(${quote}${rewritten}${quote})`;
      })
    );
  });
}

function usefulImageAlt($, element) {
  const figureCaption = plainText($(element).closest("figure").find("figcaption").first().text());
  if (figureCaption) return conciseDescription(figureCaption, 120);
  const linkTitle = plainText($(element).closest("a[title]").attr("title") ?? "");
  if (linkTitle) return conciseDescription(linkTitle, 120);
  const source = $(element).attr("src") ?? $(element).attr("data-src") ?? "";
  try {
    const filename = decodeURIComponent(source.split("/").pop()?.split("?")[0] ?? "")
      .replace(/-\d+x\d+(?=\.[a-z0-9]+$)/i, "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (filename && !/^(image|img|photo|screenshot|untitled|logo)?\s*\d*$/i.test(filename)) {
      return conciseDescription(filename, 120);
    }
  } catch {
    // Keep decorative images empty when the filename cannot be decoded.
  }
  const contextTitle = plainText(
    $(element).closest("article").find("h1, h2, .entry-title").first().text() ||
      $("h1").first().text()
  );
  if (contextTitle) return conciseDescription(`${contextTitle} 圖片`, 120);
  return "";
}

function updateStructuredSearch($) {
  $('script[type="application/ld+json"]').each((_index, element) => {
    const raw = $(element).html() ?? "";
    let schema;
    try {
      schema = JSON.parse(raw);
    } catch {
      return;
    }
    let changed = false;
    const visit = (value) => {
      if (typeof value === "string") {
        const normalized = value.replace(/^http:\/\/(?:www\.)?maxlist\.xyz\//i, `${SITE_ORIGIN}/`);
        if (normalized !== value) changed = true;
        return normalized;
      }
      if (Array.isArray(value)) return value.map(visit);
      if (!value || typeof value !== "object") return value;
      if (value["@type"] === "SearchAction" && value.target) {
        if (typeof value.target === "string") {
          value.target = `${SITE_ORIGIN}/search/?q={search_term_string}`;
        } else if (typeof value.target === "object") {
          value.target.urlTemplate = `${SITE_ORIGIN}/search/?q={search_term_string}`;
        }
        value["query-input"] = "required name=search_term_string";
        changed = true;
      }
      for (const [key, child] of Object.entries(value)) value[key] = visit(child);
      return value;
    };
    schema = visit(schema);
    if (changed) $(element).text(JSON.stringify(schema));
  });
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

await Promise.all(
  OBSOLETE_COMMERCE_PATHS.map((relative) =>
    rm(path.join(DOCS_ROOT, relative), { force: true, recursive: true })
  )
);

async function ensureYearArchive(year, templateYear = "2025") {
  const archiveFile = path.join(DOCS_ROOT, year, "index.html");
  let existingArchive = "";
  try {
    existingArchive = await readFile(archiveFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existingArchive) {
    const $existing = load(existingArchive, { decodeEntities: false });
    if (!$existing('meta[name="maxlist-generated-year-archive"]').length) return false;
  }

  const yearRoot = path.join(DOCS_ROOT, year);
  let yearFiles;
  try {
    yearFiles = await filesBelow(yearRoot);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const articleFiles = yearFiles.filter((file) =>
    /^\d{2}\/\d{2}\/[^/]+\/index\.html$/.test(
      path.relative(yearRoot, file).split(path.sep).join("/")
    )
  );
  if (!articleFiles.length) return false;

  const posts = [];
  for (const articleFile of articleFiles) {
    const $article = load(await readFile(articleFile, "utf8"), { decodeEntities: false });
    const article = $article("article").first();
    const canonical = normalizedCanonical(
      $article('link[rel="canonical"]').attr("href"),
      canonicalForFile(articleFile)
    );
    const permalink = new URL(canonical).pathname;
    const title = plainText(
      $article("h1.entry-title").first().text() ||
        $article('meta[property="og:title"]').attr("content") ||
        $article("title").text()
    ).replace(/\s+-\s+Max行銷誌$/, "");
    const time = $article("time.entry-date").first();
    const datetime =
      time.attr("datetime") ||
      $article('meta[property="article:modified_time"]').attr("content") ||
      $article('meta[property="article:published_time"]').attr("content") ||
      `${year}-01-01T00:00:00+08:00`;
    const dateText = plainText(time.text()) || year;
    const imageUrl = $article('meta[property="og:image"]').attr("content") ?? "";
    const sourceImage = $article(".entry-thumb img").first();
    let imagePath = "";
    try {
      const parsed = new URL(imageUrl, SITE_ORIGIN);
      if (new Set(["maxlist.xyz", "www.maxlist.xyz"]).has(parsed.hostname)) {
        imagePath = parsed.pathname;
      }
    } catch {
      imagePath = "";
    }
    posts.push({
      id: article.attr("id") || `post-${posts.length + 1}`,
      classes: article.attr("class") || "post type-post status-publish format-standard hentry",
      permalink,
      title,
      datetime,
      dateText,
      imagePath,
      imageWidth:
        $article('meta[property="og:image:width"]').attr("content") || sourceImage.attr("width") || "",
      imageHeight:
        $article('meta[property="og:image:height"]').attr("content") || sourceImage.attr("height") || "",
      imageAlt: sourceImage.attr("alt") || title
    });
  }
  posts.sort((left, right) => right.datetime.localeCompare(left.datetime));

  const templateFile = path.join(DOCS_ROOT, templateYear, "index.html");
  const $ = load(await readFile(templateFile, "utf8"), { decodeEntities: false });
  const archiveUrl = `${SITE_ORIGIN}/${year}/`;
  const archiveTitle = `${year} - Max行銷誌`;
  const archiveDescription = `${year} 年 Max行銷誌文章彙整，共 ${posts.length} 篇。`;
  $("title").text(archiveTitle);
  $('link[rel="canonical"]').attr("href", archiveUrl);
  ensureMeta($, 'meta[name="maxlist-generated-year-archive"]', {
    name: "maxlist-generated-year-archive",
    content: year
  });
  ensureMeta($, 'meta[name="description"]', { name: "description", content: archiveDescription });
  ensureMeta($, 'meta[property="og:title"]', { property: "og:title", content: archiveTitle });
  ensureMeta($, 'meta[property="og:description"]', {
    property: "og:description",
    content: archiveDescription
  });
  ensureMeta($, 'meta[property="og:url"]', { property: "og:url", content: archiveUrl });
  $("h1.archive-title span").text(`${year} 年`);

  const cards = posts.map((post) => {
    const classes = new Set(post.classes.split(/\s+/).filter(Boolean));
    for (const className of [
      "post-align-center",
      "post-vertical-align-middle",
      "col-lg-4",
      "col-md-4"
    ]) {
      classes.add(className);
    }
    const dimensions = [
      post.imageWidth ? `width="${escapeXml(post.imageWidth)}"` : "",
      post.imageHeight ? `height="${escapeXml(post.imageHeight)}"` : ""
    ]
      .filter(Boolean)
      .join(" ");
    const thumbnail = post.imagePath
      ? `<div class="entry-thumb"><a href="${escapeXml(post.permalink)}" title="${escapeXml(post.title)}"><img ${dimensions} src="${escapeXml(post.imagePath)}" class="attachment-large-thumb size-large-thumb wp-post-image" alt="${escapeXml(post.imageAlt)}" decoding="async" loading="lazy"></a></div>`
      : "";
    return `<article id="${escapeXml(post.id)}" class="${escapeXml([...classes].join(" "))}">
  <div class="content-inner">
    ${thumbnail}
    <header class="entry-header"><h2 class="title-post entry-title"><a href="${escapeXml(post.permalink)}" rel="bookmark">${escapeXml(post.title)}</a></h2></header>
    <div class="entry-meta below-excerpt delimiter-dot"><span class="posted-on"> 最後更新時間 <a href="${escapeXml(post.permalink)}" rel="bookmark"><time class="entry-date updated-time" datetime="${escapeXml(post.datetime)}">${escapeXml(post.dateText)}</time></a></span></div>
  </div>
</article>`;
  });
  $(".posts-layout > .row").html(cards.join("\n"));
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${archiveUrl}#webpage`,
    url: archiveUrl,
    name: archiveTitle,
    description: archiveDescription,
    inLanguage: "zh-TW"
  };
  const schemaElement = $('script.yoast-schema-graph[type="application/ld+json"]').first();
  if (schemaElement.length) schemaElement.text(JSON.stringify(schema));
  else $("head").append(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`);
  await writeFileEnsured(archiveFile, cleanGeneratedText($.html()));
  return true;
}

const yearDirectories = (await readdir(DOCS_ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
  .map((entry) => entry.name);
for (const year of yearDirectories) await ensureYearArchive(year);

const htmlFiles = (await filesBelow(DOCS_ROOT)).filter(
  (file) =>
    file.endsWith(".html") &&
    !new Set(["404.html", "search/index.html"]).has(path.relative(DOCS_ROOT, file).split(path.sep).join("/"))
);
await writeFileEnsured(OFFLINE_RUNTIME_OUTPUT, await readFile(OFFLINE_RUNTIME_SOURCE, "utf8"));
const sitemapEntries = [];
const feedArticles = [];
const searchDocuments = [];
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

  $('script[src*="static.cloudflareinsights.com/beacon.min.js"], script[src*="/cdn-cgi/scripts/"][src*="email-decode"], script[src*="stats.wp.com"], script[type="speculationrules"]').remove();
  $("script:not([src])").each((_index, element) => {
    let script = $(element).html() ?? "";
    if (
      script.includes("window.__CF$cv$params") ||
      script.includes("/cdn-cgi/challenge-platform/") ||
      script.includes("_stq = window._stq") ||
      script.includes("var wc_order_attribution =") ||
      script.includes("window._wpemojiSettings") ||
      script.includes("window._wca = window._wca")
    ) {
      $(element).remove();
      return;
    }
    script = script
      .replace(/var woocommerce_params\s*=\s*\{.*?\};;;var wc_add_to_cart_params\s*=\s*\{.*?\};;;/gs, "")
      .replace(/"ajaxurl":"[^"]*wp-admin[^"]*"/g, '"ajaxurl":""');
    if (($(element).attr("type") ?? "").toLowerCase() !== "application/ld+json") {
      script = script
        .replace(/https?:\/\/(?:www\.)?maxlist\.xyz\//gi, "/")
        .replace(/\n\s*img\.alt = tool\.name;/g, "")
        .replace(/\n\s*btn\.type = 'button';/g, "")
        .replace(
          "const currentUrl = window.location.origin + window.location.pathname;",
          "const currentUrl = document.querySelector('link[rel=\"canonical\"]')?.href || (window.location.origin + window.location.pathname);"
        )
        .replace(
          "const btn = document.createElement('button');",
          "const btn = document.createElement('a');\n            btn.href = `${tool.prompt}${encodeURIComponent(currentUrl)}`;\n            btn.target = '_blank';\n            btn.rel = 'noopener noreferrer';"
        )
        .replace(
          /transition: transform 0\.2s, opacity 0\.2s;(?!\n\s*text-decoration: none;)/,
          "transition: transform 0.2s, opacity 0.2s;\n                text-decoration: none;"
        )
        .replace(
          /img\.src = tool\.icon;(?!\n\s*img\.alt = '';\n\s*img\.setAttribute\('aria-hidden', 'true'\);)/,
          "img.src = tool.icon;\n                img.alt = '';\n                img.setAttribute('aria-hidden', 'true');"
        )
        .replace(/\n\s*\/\/ 2\. 開啟新分頁\n\s*window\.open\(`\$\{tool\.prompt\}\$\{encodeURIComponent\(currentUrl\)\}`, '_blank'\);/g, "");
    }
    $(element).html(script);
  });
  $("#wp-emoji-styles-inline-css, style:contains('img#wpstats')").remove();
  $("noscript").each((_index, element) => {
    const fallback = $(element).html() ?? "";
    $(element).html(
      fallback.replace(/http:\/\/(?:www\.)?maxlist\.xyz\//gi, `${SITE_ORIGIN}/`)
    );
  });
  updateStructuredSearch($);

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
    if (href.includes("%E4%BB%80%E9%BA%BC%E6%98%AF_threadsafe%EF%BC%9F")) {
      $(element).attr(
        "href",
        href.replace(
          "%E4%BB%80%E9%BA%BC%E6%98%AF_threadsafe%EF%BC%9F",
          "%E4%BB%80%E9%BA%BC%E6%98%AF_thread-safe%EF%BC%9F"
        )
      );
      return;
    }
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

  $("iframe").each((_index, element) => {
    if (plainText($(element).attr("title") ?? "")) return;
    const source = $(element).attr("src") ?? $(element).attr("data-src") ?? "";
    const title = source.includes("datastudio.google.com") || source.includes("lookerstudio.google.com")
      ? "互動式資料報表"
      : source.includes("GA4-tree")
        ? "GA4 欄位架構圖"
        : source.includes("GA3-tree")
          ? "Universal Analytics 欄位架構圖"
          : "嵌入內容";
    $(element).attr("title", title);
  });

  $("[id]").each((_index, element) => {
    const id = $(element).attr("id") ?? "";
    if (!id.includes("%")) return;
    try {
      $(element).attr("id", decodeURIComponent(id));
    } catch {
      // Preserve malformed legacy identifiers.
    }
  });

  $('a.go-top').attr({ href: "#toptarget", "aria-label": "返回頁首" });

  $('a[href^="http://"]').each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    try {
      const url = new URL(href);
      if (!new Set(["localhost", "127.0.0.1", "0.0.0.0"]).has(url.hostname)) {
        url.protocol = "https:";
        $(element).attr("href", url.href);
      }
    } catch {
      // Leave malformed tutorial examples unchanged.
    }
  });

  $("img").each((_index, element) => {
    if (plainText($(element).attr("alt") ?? "")) return;
    const alt = usefulImageAlt($, element);
    if (alt) $(element).attr("alt", alt);
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
  ensureMeta($, 'meta[name="referrer"]', {
    name: "referrer",
    content: "strict-origin-when-cross-origin"
  });

  const relativeFile = path.relative(DOCS_ROOT, file).split(path.sep).join("/");
  if (relativeFile === "index.html" && !$("h1").length) {
    const heading = $(".elementor-heading-title").first().get(0);
    if (heading) {
      heading.tagName = "h1";
      heading.name = "h1";
    }
  }
  if (relativeFile === "index.html") {
    const homepageTitle = "Max行銷誌｜行銷、數據分析與 Python 教學";
    $("title").text(homepageTitle);
    ensureMeta($, 'meta[property="og:title"]', { property: "og:title", content: homepageTitle });
    const twitterTitle = $('meta[name="twitter:title"]');
    if (twitterTitle.length) twitterTitle.attr("content", homepageTitle);
  }

  const fallbackDescription =
    $(".entry-content").first().text() ||
    $("main").first().text() ||
    $("#content").first().text() ||
    $("title").text();
  const description = conciseDescription(
    $('meta[property="og:description"]').attr("content") ??
      $('meta[name="description"]').attr("content") ??
      fallbackDescription
  );
  if (description) {
    ensureMeta($, 'meta[name="description"]', { name: "description", content: description });
    ensureMeta($, 'meta[property="og:description"]', { property: "og:description", content: description });
  }

  for (const component of ["header", "sidebar", "footer"]) {
    $(`script[src*="assets/js/components/${component}.js"]`).attr(
      "src",
      relativeRootReference(`/assets/js/components/${component}.js?v=${COMPONENT_VERSION}`, file)
    );
  }

  const offlineScript = relativeRootReference(`/assets/js/offline.js?v=${OFFLINE_RUNTIME_VERSION}`, file);
  const offlineElement = $('script[data-maxlist-offline="true"]').first();
  if (offlineElement.length) offlineElement.attr("src", offlineScript);
  else $("body").append(`<script data-maxlist-offline="true" src="${offlineScript}"></script>`);

  const fallback = canonicalForFile(file);
  const canonicalElement = $('link[rel="canonical"]').first();
  const canonical = normalizedCanonical(
    CANONICAL_ALIASES.get(relativeFile) ?? canonicalElement.attr("href"),
    fallback
  );
  if (canonicalElement.length) canonicalElement.attr("href", canonical);
  else $("head").append(`<link rel="canonical" href="${canonical}">`);
  if (decodedPathname(canonical) !== decodedPathname(fallback)) setNoindex($);
  // Tag archives duplicate category/article listings and add little search value.
  // Keep the pages available for readers, but do not place them in the index or sitemap.
  if (relativeFile.startsWith("tag/")) setNoindex($);

  const noindex = /(?:^|,)\s*noindex\b/i.test($('meta[name="robots"]').attr("content") ?? "");

  const modified =
    $('meta[property="article:modified_time"]').attr("content") ??
    $("time.updated, time.entry-date").first().attr("datetime") ??
    "";
  if (!noindex) sitemapEntries.push({ location: canonical, modified });
  const isArticle = ($('meta[property="og:type"]').attr("content") ?? "").toLowerCase() === "article";
  if (isArticle && !noindex) {
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("h1").first().text().trim() ||
      $("title").text().trim();
    const articleDescription =
      $('meta[name="description"]').attr("content") ??
      $('meta[property="og:description"]').attr("content") ??
      "";
    feedArticles.push({
      title,
      description: articleDescription,
      link: canonical,
      published:
        $('meta[property="article:published_time"]').attr("content") ??
        $("time.entry-date").first().attr("datetime") ??
        modified
    });
    searchDocuments.push({
      title: plainText(title),
      description: plainText(articleDescription),
      url: new URL(canonical).pathname,
      content: plainText($(".entry-content").first().text()).slice(0, 4000)
    });
  }
  relativizePageResources($, file);
  await writeFileEnsured(file, cleanGeneratedText($.html()));
  finalized += 1;
}

const homepage = await readFile(path.join(DOCS_ROOT, "index.html"), "utf8");
await writeFileEnsured(
  SEARCH_INDEX_OUTPUT,
  `window.MAXLIST_SEARCH_INDEX=${JSON.stringify(searchDocuments)};\n`
);

const $search = load(homepage, { decodeEntities: false });
$search("body").removeClass("home blog").addClass("search-results-page");
$search("title").text("搜尋文章 — Max行銷誌");
$search('link[rel="canonical"]').attr("href", `${SITE_ORIGIN}/search/`);
ensureMeta($search, 'meta[name="robots"]', { name: "robots", content: "noindex, follow" });
ensureMeta($search, 'meta[name="description"]', {
  name: "description",
  content: "搜尋 Max行銷誌的文章與教學內容。"
});
ensureMeta($search, 'meta[property="og:title"]', {
  property: "og:title",
  content: "搜尋文章 — Max行銷誌"
});
ensureMeta($search, 'meta[property="og:description"]', {
  property: "og:description",
  content: "搜尋 Max行銷誌的文章與教學內容。"
});
$search('script.yoast-schema-graph[type="application/ld+json"]').remove();
$search("#content").replaceWith(`<div id="content" class="page-wrap">
  <div class="content-wrapper container">
    <div class="row">
      <div id="primary" class="content-area col-md-12">
        <main id="main" class="site-main" role="main">
          <header class="page-header"><h1 class="page-title">搜尋文章</h1></header>
          <form class="search-page-form" role="search" method="get" action="/search/" data-static-search-form>
            <label class="screen-reader-text" for="static-search-query">搜尋關鍵字</label>
            <input id="static-search-query" type="search" name="q" placeholder="輸入文章標題或關鍵字" autocomplete="off">
            <button type="submit">搜尋</button>
          </form>
          <p class="search-status" aria-live="polite" data-search-status>請輸入關鍵字搜尋文章。</p>
          <ol class="search-results-list" data-search-results></ol>
        </main>
      </div>
    </div>
  </div>
</div>`);
$search("body").append('<script src="/assets/js/search-index.js"></script>');
$search("body").append('<script src="/assets/js/search-page.js"></script>');
retargetPageResources($search, `${SITE_ORIGIN}/`, SEARCH_PAGE_OUTPUT);
await writeFileEnsured(SEARCH_PAGE_OUTPUT, cleanGeneratedText($search.html()));

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
