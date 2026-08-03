import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir
} from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { writeFileEnsured } from "./lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const UPLOADS_ROOT = path.join(DOCS_ROOT, "wp-content", "uploads");
const IMAGE_ROOT = path.join(DOCS_ROOT, "image");
const REPORT_FILE = path.join(REPO_ROOT, "reports", "url-migration.json");
const WORKER_FILE = path.join(REPO_ROOT, "cloudflare", "redirect-worker.js");
const SITE_ORIGIN = "https://www.maxlist.xyz";
const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const SITE_HOSTS = new Set(["maxlist.xyz", "www.maxlist.xyz"]);

async function filesBelow(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(absolute)));
    else files.push(absolute);
  }
  return files;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function slashPath(file) {
  return file.split(path.sep).join("/");
}

function pagePathForFile(file) {
  const relative = slashPath(path.relative(DOCS_ROOT, file));
  if (relative === "index.html") return "/";
  return `/${relative.replace(/index\.html$/, "")}`;
}

function safeDecodePathname(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodePathname(value) {
  const trailingSlash = value.endsWith("/");
  const encoded = value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return trailingSlash && !encoded.endsWith("/") ? `${encoded}/` : encoded;
}

function normalizedPagePath(value) {
  if (value === "/") return value;
  return value.endsWith("/") ? value : `${value}/`;
}

function publicUrl(value) {
  return `${SITE_ORIGIN}${encodePathname(value)}`;
}

async function contentHash(file) {
  const contents = await readFile(file);
  return createHash("sha256").update(contents).digest("hex");
}

function hashedFilename(filename, hash) {
  const extension = path.extname(filename);
  const stem = filename.slice(0, -extension.length);
  return `${stem}--${hash.slice(0, 10)}${extension.toLowerCase()}`;
}

async function discoverPosts() {
  const htmlFiles = (await filesBelow(DOCS_ROOT)).filter((file) => file.endsWith(".html"));
  const candidates = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const $ = load(html, { decodeEntities: false });
    if (!$('body.single-post, meta[property="og:type"][content="article"]').length) continue;
    const oldPath = pagePathForFile(file);
    let canonicalPath = oldPath;
    try {
      const canonical = new URL($('link[rel="canonical"]').first().attr("href") || oldPath, SITE_ORIGIN);
      if (SITE_HOSTS.has(canonical.hostname)) canonicalPath = safeDecodePathname(canonical.pathname);
    } catch {
      canonicalPath = oldPath;
    }
    canonicalPath = normalizedPagePath(canonicalPath);
    const match = canonicalPath.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\/$/);
    if (!match) continue;
    const newPath = `/post/${match[4]}/`;
    candidates.push({
      title: ($('meta[property="og:title"]').attr("content") || $("h1").first().text() || $("title").text())
        .replace(/\s+/g, " ")
        .trim(),
      sourceFile: slashPath(path.relative(REPO_ROOT, file)),
      oldPath: normalizedPagePath(oldPath),
      canonicalPath,
      newPath,
      date: `${match[1]}-${match[2]}-${match[3]}`,
      primary: normalizedPagePath(oldPath) === canonicalPath
    });
  }

  const grouped = new Map();
  for (const candidate of candidates) {
    grouped.set(candidate.newPath, [...(grouped.get(candidate.newPath) ?? []), candidate]);
  }

  const posts = [];
  const aliases = [];
  for (const [newPath, group] of grouped) {
    const primary = group.find((candidate) => candidate.primary) ?? group[0];
    posts.push(primary);
    for (const candidate of group) {
      if (candidate.sourceFile !== primary.sourceFile) {
        aliases.push({ oldPath: candidate.oldPath, newPath, sourceFile: candidate.sourceFile });
      }
    }
  }
  posts.sort((left, right) => right.date.localeCompare(left.date) || left.newPath.localeCompare(right.newPath));
  aliases.sort((left, right) => left.oldPath.localeCompare(right.oldPath));
  return { posts, aliases };
}

async function discoverImages() {
  const imageFiles = (await filesBelow(UPLOADS_ROOT)).filter((file) => {
    return IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
  });
  const groups = new Map();
  for (const file of imageFiles) {
    const key = path.basename(file).normalize("NFC").toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }

  const images = [];
  const collisionGroups = [];
  for (const files of groups.values()) {
    files.sort((left, right) => left.localeCompare(right));
    if (files.length === 1) {
      const file = files[0];
      const oldRelative = slashPath(path.relative(DOCS_ROOT, file));
      images.push({
        sourceFile: slashPath(path.relative(REPO_ROOT, file)),
        oldPath: `/${oldRelative}`,
        newPath: `/image/${path.basename(file)}`,
        duplicateOf: null
      });
      continue;
    }

    const hashed = [];
    for (const file of files) hashed.push({ file, hash: await contentHash(file) });
    const uniqueHashes = new Set(hashed.map(({ hash }) => hash));
    if (uniqueHashes.size === 1) {
      const destination = `/image/${path.basename(files[0])}`;
      for (const [index, file] of files.entries()) {
        const oldRelative = slashPath(path.relative(DOCS_ROOT, file));
        images.push({
          sourceFile: slashPath(path.relative(REPO_ROOT, file)),
          oldPath: `/${oldRelative}`,
          newPath: destination,
          duplicateOf: index === 0 ? null : slashPath(path.relative(REPO_ROOT, files[0]))
        });
      }
    } else {
      for (const { file, hash } of hashed) {
        const oldRelative = slashPath(path.relative(DOCS_ROOT, file));
        images.push({
          sourceFile: slashPath(path.relative(REPO_ROOT, file)),
          oldPath: `/${oldRelative}`,
          newPath: `/image/${hashedFilename(path.basename(file), hash)}`,
          duplicateOf: null
        });
      }
    }
    collisionGroups.push({
      identical: uniqueHashes.size === 1,
      mappings: images
        .filter((image) => files.some((file) => image.sourceFile === slashPath(path.relative(REPO_ROOT, file))))
        .map(({ oldPath, newPath }) => ({ oldPath, newPath }))
    });
  }
  images.sort((left, right) => left.oldPath.localeCompare(right.oldPath));
  collisionGroups.sort((left, right) => left.mappings[0].oldPath.localeCompare(right.mappings[0].oldPath));
  return { images, collisionGroups };
}

function mappingsFromReport(report) {
  const pathMappings = new Map();
  for (const post of report.posts) pathMappings.set(normalizedPagePath(post.oldPath), post.newPath);
  for (const alias of report.articleAliases) pathMappings.set(normalizedPagePath(alias.oldPath), alias.newPath);
  for (const image of report.images) pathMappings.set(image.oldPath, image.newPath);
  return pathMappings;
}

function mappedUrlReference(reference, baseUrl, pathMappings, forceRoot = false, absolute = false) {
  if (!reference || reference.startsWith("#") || /^(data|mailto|tel|javascript|blob):/i.test(reference)) {
    return reference;
  }
  let url;
  try {
    url = new URL(reference, baseUrl);
  } catch {
    return reference;
  }
  if (!SITE_HOSTS.has(url.hostname)) return reference;
  const decoded = safeDecodePathname(url.pathname);
  const mapped = pathMappings.get(decoded) ?? pathMappings.get(normalizedPagePath(decoded));
  if (!mapped && !forceRoot) return reference;
  const pathname = mapped ? encodePathname(mapped) : url.pathname;
  const suffix = `${url.search}${url.hash}`;
  return absolute ? `${SITE_ORIGIN}${pathname}${suffix}` : `${pathname}${suffix}`;
}

function rewriteCssUrls(value, baseUrl, pathMappings, forceRoot = false) {
  return value.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, quote, reference) => {
    const rewritten = mappedUrlReference(reference, baseUrl, pathMappings, forceRoot, false);
    return rewritten === reference ? match : `url(${quote}${rewritten}${quote})`;
  });
}

function rewriteJsonStrings(value, baseUrl, pathMappings, forceRoot = false) {
  if (typeof value === "string") {
    if (!/^(?:https?:\/\/|\/|\.\.?\/)/i.test(value)) return value;
    return mappedUrlReference(value, baseUrl, pathMappings, forceRoot, /^https?:\/\//i.test(value));
  }
  if (Array.isArray(value)) return value.map((child) => rewriteJsonStrings(child, baseUrl, pathMappings, forceRoot));
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      value[key] = rewriteJsonStrings(child, baseUrl, pathMappings, forceRoot);
    }
  }
  return value;
}

function repairStructuredDataValue(value, originalPagePath) {
  if (typeof value === "string") {
    const prefixes = [originalPagePath, encodePathname(originalPagePath)];
    for (const prefix of prefixes) {
      if (value.startsWith(prefix) && value !== prefix) {
        const remainder = value.slice(prefix.length);
        try {
          return decodeURIComponent(remainder);
        } catch {
          return remainder;
        }
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => repairStructuredDataValue(child, originalPagePath));
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      value[key] = repairStructuredDataValue(child, originalPagePath);
    }
  }
  return value;
}

function rewriteKnownPaths(value, pathMappings) {
  const pathPattern = /\/(?:20\d{2}\/\d{2}\/\d{2}\/[^"'`<>\s\\),;}]+|wp-content\/uploads\/(?:20\d{2}\/\d{2}\/)?[^"'`<>\s\\),;}]+)/g;
  return value.replace(pathPattern, (reference) => {
    let url;
    try {
      url = new URL(reference, SITE_ORIGIN);
    } catch {
      return reference;
    }
    const decoded = safeDecodePathname(url.pathname);
    const mapped = pathMappings.get(decoded) ?? pathMappings.get(normalizedPagePath(decoded));
    if (!mapped) return reference;
    return `${encodePathname(mapped)}${url.search}${url.hash}`;
  });
}

function rewriteHtml(html, oldPagePath, pathMappings, forceRoot = false, originalPagePath = null) {
  const baseUrl = `${SITE_ORIGIN}${encodePathname(oldPagePath)}`;
  const $ = load(html, { decodeEntities: false });
  const attributes = [
    ["a[href]", "href"],
    ["area[href]", "href"],
    ["form[action]", "action"],
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
      if (!value) return;
      const isCanonical = element.tagName === "link" && (($(element).attr("rel") ?? "").includes("canonical"));
      const rewritten = mappedUrlReference(value, baseUrl, pathMappings, forceRoot, isCanonical);
      if (rewritten !== value) $(element).attr(attribute, rewritten);
    });
  }
  $("meta[content]").each((_index, element) => {
    const value = $(element).attr("content") ?? "";
    if (!/^https?:\/\//i.test(value)) return;
    const rewritten = mappedUrlReference(value, baseUrl, pathMappings, forceRoot, true);
    if (rewritten !== value) $(element).attr("content", rewritten);
  });
  for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
    $(`[${attribute}]`).each((_index, element) => {
      const value = $(element).attr(attribute) ?? "";
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const [reference, ...descriptor] = candidate.trim().split(/\s+/);
          return [mappedUrlReference(reference, baseUrl, pathMappings, forceRoot, false), ...descriptor].join(" ");
        })
        .join(", ");
      $(element).attr(attribute, rewritten);
    });
  }
  $("[style]").each((_index, element) => {
    const value = $(element).attr("style") ?? "";
    $(element).attr("style", rewriteCssUrls(value, baseUrl, pathMappings, forceRoot));
  });
  $("style").each((_index, element) => {
    const value = $(element).html() ?? "";
    $(element).html(rewriteCssUrls(value, baseUrl, pathMappings, forceRoot));
  });
  $('script[type="application/ld+json"]').each((_index, element) => {
    const source = $(element).html() ?? "";
    try {
      let parsed = JSON.parse(source);
      if (originalPagePath) parsed = repairStructuredDataValue(parsed, originalPagePath);
      $(element).text(JSON.stringify(rewriteJsonStrings(parsed, baseUrl, pathMappings, forceRoot)));
    } catch {
      // Malformed legacy schema is left intact and caught by the reference audit.
    }
  });
  return rewriteKnownPaths($.html(), pathMappings);
}

async function rewriteSiteHtml(report, pathMappings) {
  const htmlFiles = (await filesBelow(DOCS_ROOT)).filter((file) => file.endsWith(".html"));
  const movedPosts = new Set(report.posts.map((post) => path.resolve(REPO_ROOT, post.sourceFile)));
  const originalPostPaths = new Map();
  for (const post of report.posts) {
    originalPostPaths.set(path.resolve(REPO_ROOT, post.sourceFile), post.oldPath);
    originalPostPaths.set(
      path.join(DOCS_ROOT, post.newPath.replace(/^\/+|\/+$/g, ""), "index.html"),
      post.oldPath
    );
  }
  const aliases = new Set(report.articleAliases.map((alias) => path.resolve(REPO_ROOT, alias.sourceFile)));
  let rewritten = 0;
  for (const file of htmlFiles) {
    if (aliases.has(file)) continue;
    const oldPagePath = pagePathForFile(file);
    const html = await readFile(file, "utf8");
    const output = rewriteHtml(
      html,
      oldPagePath,
      pathMappings,
      movedPosts.has(file),
      originalPostPaths.get(file) ?? null
    );
    if (output !== html) {
      await writeFileEnsured(file, output);
      rewritten += 1;
    }
  }

  const componentFiles = (await filesBelow(path.join(REPO_ROOT, "components"))).filter((file) => file.endsWith(".html"));
  for (const file of componentFiles) {
    const html = await readFile(file, "utf8");
    const output = rewriteHtml(html, "/", pathMappings, false);
    if (output !== html) {
      await writeFileEnsured(file, output);
      rewritten += 1;
    }
  }
  return rewritten;
}

async function rewriteCssFiles(pathMappings) {
  const cssFiles = (await filesBelow(DOCS_ROOT)).filter((file) => file.endsWith(".css"));
  let rewritten = 0;
  for (const file of cssFiles) {
    const relative = slashPath(path.relative(DOCS_ROOT, file));
    const baseUrl = `${SITE_ORIGIN}/${relative}`;
    const css = await readFile(file, "utf8");
    const output = rewriteCssUrls(css, baseUrl, pathMappings, false);
    if (output !== css) {
      await writeFileEnsured(file, output);
      rewritten += 1;
    }
  }
  return rewritten;
}

async function pruneEmptyParents(start, stop) {
  let current = start;
  const boundary = path.resolve(stop);
  while (path.resolve(current).startsWith(`${boundary}${path.sep}`)) {
    let entries;
    try {
      entries = await readdir(current);
    } catch (error) {
      if (error.code === "ENOENT") {
        current = path.dirname(current);
        continue;
      }
      throw error;
    }
    if (entries.length) break;
    await rmdir(current);
    current = path.dirname(current);
  }
}

async function movePosts(report) {
  let moved = 0;
  for (const post of report.posts) {
    const source = path.resolve(REPO_ROOT, post.sourceFile);
    const destination = path.join(DOCS_ROOT, post.newPath.replace(/^\/+|\/+$/g, ""), "index.html");
    if (source === destination || !(await exists(source))) continue;
    if (await exists(destination)) throw new Error(`Post destination already exists: ${destination}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    await pruneEmptyParents(path.dirname(source), DOCS_ROOT);
    moved += 1;
  }
  for (const alias of report.articleAliases) {
    const source = path.resolve(REPO_ROOT, alias.sourceFile);
    if (!(await exists(source))) continue;
    await rm(source);
    await pruneEmptyParents(path.dirname(source), DOCS_ROOT);
  }
  return moved;
}

async function moveImages(report) {
  await mkdir(IMAGE_ROOT, { recursive: true });
  const destinationSources = new Map();
  let moved = 0;
  let deduplicated = 0;
  for (const image of report.images) {
    const source = path.resolve(REPO_ROOT, image.sourceFile);
    if (!(await exists(source))) continue;
    const destination = path.join(DOCS_ROOT, image.newPath.replace(/^\/+/, ""));
    if (destinationSources.has(image.newPath)) {
      await rm(source);
      await pruneEmptyParents(path.dirname(source), UPLOADS_ROOT);
      deduplicated += 1;
      continue;
    }
    if (await exists(destination)) throw new Error(`Image destination already exists: ${destination}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    destinationSources.set(image.newPath, image.sourceFile);
    await pruneEmptyParents(path.dirname(source), UPLOADS_ROOT);
    moved += 1;
  }
  return { moved, deduplicated };
}

function workerSource(report) {
  const articleAliases = Object.fromEntries(
    report.articleAliases.map(({ oldPath, newPath }) => [oldPath, newPath])
  );
  const imageExceptions = Object.fromEntries(
    report.images
      .filter(({ oldPath, newPath }) => path.basename(safeDecodePathname(oldPath)) !== path.basename(newPath))
      .map(({ oldPath, newPath }) => [oldPath, newPath])
  );
  return `// Generated by scripts/migrate-urls.mjs.\n` +
    `const ARTICLE_ALIASES = ${JSON.stringify(articleAliases, null, 2)};\n\n` +
    `const IMAGE_EXCEPTIONS = ${JSON.stringify(imageExceptions, null, 2)};\n\n` +
    `function decodePathname(pathname) {\n` +
    `  try { return decodeURIComponent(pathname); } catch { return pathname; }\n` +
    `}\n\n` +
    `function encodePathname(pathname) {\n` +
    `  return pathname.split(\"/\").map((segment) => encodeURIComponent(segment)).join(\"/\");\n` +
    `}\n\n` +
    `function redirectTarget(url) {\n` +
    `  const pathname = decodePathname(url.pathname);\n` +
    `  const normalized = pathname === \"/\" || pathname.endsWith(\"/\") ? pathname : \`\${pathname}/\`;\n` +
    `  if (ARTICLE_ALIASES[normalized]) return ARTICLE_ALIASES[normalized];\n` +
    `  const post = normalized.match(/^\\/\\d{4}\\/\\d{2}\\/\\d{2}\\/([^/]+)\\/$/);\n` +
    `  if (post) return \`/post/\${post[1]}/\`;\n` +
    `  if (IMAGE_EXCEPTIONS[pathname]) return IMAGE_EXCEPTIONS[pathname];\n` +
    `  const image = pathname.match(/^\\/wp-content\\/uploads\\/(?:\\d{4}\\/\\d{2}\\/)?([^/]+)$/);\n` +
    `  if (image && /\\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(image[1])) return \`/image/\${image[1]}\`;\n` +
    `  return null;\n` +
    `}\n\n` +
    `export default {\n` +
    `  async fetch(request) {\n` +
    `    if (request.method !== \"GET\" && request.method !== \"HEAD\") return fetch(request);\n` +
    `    const url = new URL(request.url);\n` +
    `    const target = redirectTarget(url);\n` +
    `    if (!target) return fetch(request);\n` +
    `    url.protocol = \"https:\";\n` +
    `    url.hostname = \"www.maxlist.xyz\";\n` +
    `    url.port = \"\";\n` +
    `    url.pathname = encodePathname(target);\n` +
    `    return Response.redirect(url.toString(), 301);\n` +
    `  }\n` +
    `};\n`;
}

let report;
if (await exists(REPORT_FILE)) {
  report = JSON.parse(await readFile(REPORT_FILE, "utf8"));
} else {
  const { posts, aliases } = await discoverPosts();
  const { images, collisionGroups } = await discoverImages();
  report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    siteOrigin: SITE_ORIGIN,
    postCount: posts.length,
    posts: posts.map(({ title, sourceFile, oldPath, newPath, date }) => ({
      date,
      title,
      sourceFile,
      oldPath,
      newPath
    })),
    articleAliases: aliases,
    imageSourceCount: images.length,
    imageDestinationCount: new Set(images.map(({ newPath }) => newPath)).size,
    imageCollisionGroups: collisionGroups,
    images
  };
  await writeFileEnsured(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
}

if (report.postCount !== 178) throw new Error(`Expected 178 posts, found ${report.postCount}`);
if (report.imageSourceCount !== 9419) throw new Error(`Expected 9419 images, found ${report.imageSourceCount}`);

const pathMappings = mappingsFromReport(report);
const rewrittenHtml = await rewriteSiteHtml(report, pathMappings);
const rewrittenCss = await rewriteCssFiles(pathMappings);
const movedPosts = await movePosts(report);
const imageMoves = await moveImages(report);
await writeFileEnsured(WORKER_FILE, workerSource(report));

console.log(
  `URL migration prepared: ${movedPosts} posts moved, ${imageMoves.moved} images moved, ` +
    `${imageMoves.deduplicated} identical image deduplicated, ${rewrittenHtml} HTML/component files and ` +
    `${rewrittenCss} CSS files rewritten.`
);
