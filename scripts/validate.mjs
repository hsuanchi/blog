import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { writeFileEnsured } from "./lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const REPORT_FILE = path.join(REPO_ROOT, "reports", "validation.json");

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

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function localTarget(reference, sourceFile) {
  if (!reference || reference.startsWith("#") || reference.startsWith("data:")) return null;
  if (/^(mailto|tel|javascript):/i.test(reference)) return null;
  let url;
  try {
    const sourceRelative = path.relative(DOCS_ROOT, sourceFile).split(path.sep).join("/");
    url = new URL(reference, `https://www.maxlist.xyz/${sourceRelative}`);
  } catch {
    return null;
  }
  if (!new Set(["maxlist.xyz", "www.maxlist.xyz"]).has(url.hostname)) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }
  const relative = pathname.replace(/^\/+/, "");
  if (!relative || pathname.endsWith("/")) return path.join(DOCS_ROOT, relative, "index.html");
  if (!path.extname(pathname)) return path.join(DOCS_ROOT, relative, "index.html");
  return path.join(DOCS_ROOT, relative);
}

const allFiles = await filesBelow(DOCS_ROOT);
const htmlFiles = allFiles.filter((file) => file.endsWith(".html"));
const missing = new Map();
const dynamicReferences = [];
const componentCoverage = { header: 0, sidebar: 0, footer: 0 };
const offlineCoverage = { runtime: 0, pagesWithoutPreloader: 0 };
const internalLinksOpeningNewTabs = [];
const offlineRootResourceReferences = [];
const offlineRootCssReferences = [];
let ga4Pages = 0;
let gtmPages = 0;
let canonicalPages = 0;

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const $ = load(html, { decodeEntities: false });
  const references = [];
  const selectors = [
    ["a[href]", "href"],
    ["link[href]", "href"],
    ["script[src]", "src"],
    ["img[src]", "src"],
    ["source[src]", "src"],
    ["video[src]", "src"],
    ["video[poster]", "poster"],
    ["iframe[src]", "src"],
    ["form[action]", "action"]
  ];
  for (const [selector, attribute] of selectors) {
    $(selector).each((_index, element) => {
      const value = $(element).attr(attribute);
      if (value) references.push(value);
      if (
        value?.startsWith("/") &&
        !value.startsWith("//") &&
        !new Set(["a[href]", "form[action]"]).has(selector)
      ) {
        offlineRootResourceReferences.push({ file: path.relative(REPO_ROOT, file), reference: value });
      }
    });
  }
  for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
    $(`[${attribute}]`).each((_index, element) => {
      const value = $(element).attr(attribute) ?? "";
      for (const candidate of value.split(",")) {
        const reference = candidate.trim().split(/\s+/)[0];
        if (reference) references.push(reference);
        if (reference.startsWith("/") && !reference.startsWith("//")) {
          offlineRootResourceReferences.push({ file: path.relative(REPO_ROOT, file), reference });
        }
      }
    });
  }

  for (const reference of references) {
    if (/\/wp-(admin|json|comments-post)|\/xmlrpc\.php|[?&]s=/.test(reference)) {
      dynamicReferences.push({ file: path.relative(REPO_ROOT, file), reference });
    }
    const target = localTarget(reference, file);
    if (target && !(await exists(target))) {
      const key = `${path.relative(REPO_ROOT, file)} -> ${reference}`;
      missing.set(key, path.relative(REPO_ROOT, target));
    }
  }

  $('a[target="_blank"][href]').each((_index, element) => {
    const reference = $(element).attr("href") ?? "";
    try {
      const sourceRelative = path.relative(DOCS_ROOT, file).split(path.sep).join("/");
      const url = new URL(reference, `https://www.maxlist.xyz/${sourceRelative}`);
      if (new Set(["maxlist.xyz", "www.maxlist.xyz"]).has(url.hostname)) {
        internalLinksOpeningNewTabs.push({ file: path.relative(REPO_ROOT, file), reference });
      }
    } catch {
      // Invalid links are handled by the normal reference checks.
    }
  });

  if ($('script[src$="assets/js/components/header.js"]').length) componentCoverage.header += 1;
  if ($('script[src$="assets/js/components/sidebar.js"]').length) componentCoverage.sidebar += 1;
  if ($('script[src$="assets/js/components/footer.js"]').length) componentCoverage.footer += 1;
  if ($('script[data-maxlist-offline="true"][src*="assets/js/offline.js"]').length) {
    offlineCoverage.runtime += 1;
  }
  if (!$(".preloader").length) offlineCoverage.pagesWithoutPreloader += 1;
  if (/G-[A-Z0-9]+|gtag\s*\(/i.test(html)) ga4Pages += 1;
  if (/GTM-[A-Z0-9]+|googletagmanager\.com\/gtm\.js/i.test(html)) gtmPages += 1;
  if ($('link[rel="canonical"]').length) canonicalPages += 1;
}

for (const file of allFiles.filter((candidate) => candidate.endsWith(".css"))) {
  const css = await readFile(file, "utf8");
  const references = css.match(/url\(\s*["']?\/(?!\/)[^"')]+/g) ?? [];
  for (const reference of references) {
    offlineRootCssReferences.push({ file: path.relative(REPO_ROOT, file), reference });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  files: { total: allFiles.length, html: htmlFiles.length, assets: allFiles.length - htmlFiles.length },
  componentCoverage,
  offlineCoverage,
  analytics: { pagesWithGa4: ga4Pages, pagesWithGtm: gtmPages },
  seo: { pagesWithCanonical: canonicalPages },
  internalLinksOpeningNewTabs,
  offlineRootResourceReferences,
  offlineRootCssReferences,
  missingLocalReferences: [...missing].map(([source, expected]) => ({ source, expected })),
  dynamicWordPressReferences: dynamicReferences
};
await writeFileEnsured(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (
  missing.size > 0 ||
  internalLinksOpeningNewTabs.length > 0 ||
  offlineRootResourceReferences.length > 0 ||
  offlineRootCssReferences.length > 0 ||
  offlineCoverage.runtime !== htmlFiles.length ||
  offlineCoverage.pagesWithoutPreloader !== htmlFiles.length
) {
  process.exitCode = 1;
}
