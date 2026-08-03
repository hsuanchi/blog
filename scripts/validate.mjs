import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { writeFileEnsured } from "./lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const REPORT_FILE = path.join(REPO_ROOT, "reports", "validation.json");
const URL_MIGRATION_REPORT = path.join(REPO_ROOT, "reports", "url-migration.json");
const EXPECTED_GTM = "GTM-WSG8N3Q";
const EXPECTED_GA4 = "G-YR986G8PX3";
const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

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

function plainText(value) {
  return value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

function localTarget(reference, sourceFile) {
  if (!reference || reference.startsWith("data:")) return null;
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
let urlMigrationPlan = null;
try {
  urlMigrationPlan = JSON.parse(await readFile(URL_MIGRATION_REPORT, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const knownLegacyPaths = new Set(
  urlMigrationPlan
    ? [...urlMigrationPlan.posts, ...urlMigrationPlan.articleAliases, ...urlMigrationPlan.images].map(
        ({ oldPath }) => decodeURIComponent(oldPath)
      )
    : []
);
const legacyReferencePattern =
  /\/(?:20\d{2}\/\d{2}\/\d{2}\/[^"'`<>\s\\),;}]+|wp-content\/uploads\/(?:20\d{2}\/\d{2}\/)?[^"'`<>\s\\),;}]+)/g;
const staleLegacyReferences = [];
const malformedStructuredData = [];
const missing = new Map();
const dynamicReferences = [];
const componentCoverage = { header: 0, sidebar: 0, footer: 0 };
const offlineCoverage = { runtime: 0, pagesWithoutPreloader: 0 };
const internalLinksOpeningNewTabs = [];
const offlineRootResourceReferences = [];
const offlineRootCssReferences = [];
const brokenInternalFragments = [];
const fragmentReferences = [];
const unexpectedForms = [];
const missingDescriptions = [];
const missingIndexableH1 = [];
const missingImageAlts = [];
const externalStatsScripts = [];
const backendScriptReferences = [];
const insecureSameSiteScriptReferences = [];
const indexableTitles = new Map();
let gtmPages = 0;
let canonicalPages = 0;

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const $ = load(html, { decodeEntities: false });
  const relativeFile = path.relative(REPO_ROOT, file);
  for (const match of html.matchAll(legacyReferencePattern)) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(match[0], "https://www.maxlist.xyz").pathname);
    } catch {
      continue;
    }
    if (knownLegacyPaths.has(pathname) || knownLegacyPaths.has(pathname.endsWith("/") ? pathname : `${pathname}/`)) {
      staleLegacyReferences.push({ file: relativeFile, reference: match[0] });
    }
  }
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      const schema = JSON.parse($(element).html() ?? "");
      const visit = (value, key = "") => {
        if (
          typeof value === "string" &&
          (/^\/20\d{2}\/\d{2}\/\d{2}\//.test(value) ||
            (new Set(["@type", "inLanguage"]).has(key) && value.startsWith("/")))
        ) {
          malformedStructuredData.push({ file: relativeFile, key, value: value.slice(0, 200) });
        } else if (Array.isArray(value)) {
          for (const child of value) visit(child, key);
        } else if (value && typeof value === "object") {
          for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
        }
      };
      visit(schema);
    } catch (error) {
      malformedStructuredData.push({ file: relativeFile, key: "parse", value: error.message });
    }
  });
  const noindex = /(?:^|,)\s*noindex\b/i.test($('meta[name="robots"]').attr("content") ?? "");
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

  $('a[href*="#"]').each((_index, element) => {
    const reference = $(element).attr("href") ?? "";
    if (reference && reference !== "#") fragmentReferences.push({ file, reference });
  });
  $("form").each((_index, element) => {
    if ($(element).hasClass("search-form") || $(element).is("[data-static-search-form]")) return;
    unexpectedForms.push({ file: relativeFile, class: $(element).attr("class") ?? "" });
  });
  if (!$('meta[name="description"][content]').length) missingDescriptions.push(relativeFile);
  if (!noindex && !$("h1").length) missingIndexableH1.push(relativeFile);
  if (!noindex) {
    const title = $("title").text().replace(/\s+/g, " ").trim();
    if (title) indexableTitles.set(title, [...(indexableTitles.get(title) ?? []), relativeFile]);
  }
  $("img").each((_index, element) => {
    if ($(element).parents("noscript").length) return;
    if (!($(element).attr("alt") ?? "").trim()) missingImageAlts.push(relativeFile);
  });
  $('script[src*="stats.wp.com"]').each((_index, element) => {
    externalStatsScripts.push({ file: relativeFile, source: $(element).attr("src") ?? "" });
  });
  $("script").each((_index, element) => {
    const script = ($(element).html() ?? "").replaceAll("\\/", "/");
    if (/wp-admin|wc-ajax|comments-post\.php|xmlrpc\.php/i.test(script)) {
      backendScriptReferences.push(relativeFile);
    }
    if (/http:\/\/(?:www\.)?maxlist\.xyz/i.test(script)) {
      insecureSameSiteScriptReferences.push(relativeFile);
    }
  });

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

  if ($('script[src*="assets/js/components/header.js"]').length) componentCoverage.header += 1;
  if ($('script[src*="assets/js/components/sidebar.js"]').length) componentCoverage.sidebar += 1;
  if ($('script[src*="assets/js/components/footer.js"]').length) componentCoverage.footer += 1;
  if ($('script[data-maxlist-offline="true"][src*="assets/js/offline.js"]').length) {
    offlineCoverage.runtime += 1;
  }
  if (!$(".preloader").length) offlineCoverage.pagesWithoutPreloader += 1;
  if (html.includes(EXPECTED_GTM)) gtmPages += 1;
  if ($('link[rel="canonical"]').length) canonicalPages += 1;
}

const duplicateIndexableTitles = [...indexableTitles]
  .filter(([, files]) => files.length > 1)
  .map(([title, files]) => ({ title, files }));

const archiveNavigation = { linksChecked: 0, yearMismatches: [], missingArchives: [] };
for (const component of ["sidebar", "footer"]) {
  const componentFile = path.join(REPO_ROOT, "components", `${component}.html`);
  const $component = load(await readFile(componentFile, "utf8"), { decodeEntities: false });
  for (const element of $component('a[href]').toArray()) {
    const anchor = $component(element);
    const year = plainText(anchor.text()).match(/^(\d{4})\b/)?.[1];
    if (!year) continue;
    archiveNavigation.linksChecked += 1;
    const reference = anchor.attr("href") ?? "";
    let linkedYear = "";
    try {
      linkedYear = new URL(reference, "https://www.maxlist.xyz/").pathname.match(/^\/(\d{4})\/$/)?.[1] ?? "";
    } catch {
      linkedYear = "";
    }
    if (linkedYear !== year) {
      archiveNavigation.yearMismatches.push({ component, label: plainText(anchor.text()), reference });
      continue;
    }
    const target = localTarget(reference, path.join(DOCS_ROOT, "index.html"));
    if (!target || !(await exists(target))) {
      archiveNavigation.missingArchives.push({ component, label: plainText(anchor.text()), reference });
    }
  }
}

const idsByFile = new Map();
async function idsFor(file) {
  if (idsByFile.has(file)) return idsByFile.get(file);
  const html = await readFile(file, "utf8");
  const $ = load(html, { decodeEntities: false });
  const ids = new Set();
  $("[id]").each((_index, element) => {
    const id = $(element).attr("id") ?? "";
    ids.add(id);
    try {
      ids.add(decodeURIComponent(id));
    } catch {
      // Preserve malformed legacy identifiers.
    }
  });
  idsByFile.set(file, ids);
  return ids;
}

for (const { file, reference } of fragmentReferences) {
  const target = localTarget(reference, file);
  if (!target || !(await exists(target))) continue;
  let fragment;
  try {
    const sourceRelative = path.relative(DOCS_ROOT, file).split(path.sep).join("/");
    fragment = decodeURIComponent(new URL(reference, `https://www.maxlist.xyz/${sourceRelative}`).hash.slice(1));
  } catch {
    fragment = reference.split("#").at(-1) ?? "";
  }
  if (fragment && !(await idsFor(target)).has(fragment)) {
    brokenInternalFragments.push({ file: path.relative(REPO_ROOT, file), reference });
  }
}

for (const file of allFiles.filter((candidate) => candidate.endsWith(".css"))) {
  const css = await readFile(file, "utf8");
  const references = css.match(/url\(\s*["']?\/(?!\/)[^"')]+/g) ?? [];
  for (const reference of references) {
    offlineRootCssReferences.push({ file: path.relative(REPO_ROOT, file), reference });
  }
}

const headerComponentSource = await readFile(
  path.join(DOCS_ROOT, "assets", "js", "components", "header.js"),
  "utf8"
);
const searchIndexSource = await readFile(path.join(DOCS_ROOT, "assets", "js", "search-index.js"), "utf8");
const searchIndexPayload = searchIndexSource.match(/^window\.MAXLIST_SEARCH_INDEX=(.*);\s*$/s)?.[1];
let searchIndexDocuments = 0;
try {
  const parsed = JSON.parse(searchIndexPayload ?? "[]");
  if (Array.isArray(parsed)) searchIndexDocuments = parsed.length;
} catch {
  searchIndexDocuments = 0;
}
const cname = (await readFile(path.join(DOCS_ROOT, "CNAME"), "utf8")).trim();
const obsoleteCommercePaths = [];
for (const relative of ["cart", "checkout", "my-account", "shop"]) {
  if (await exists(path.join(DOCS_ROOT, relative))) obsoleteCommercePaths.push(relative);
}
const generatedFeatures = {
  staticFixesStylesheet:
    headerComponentSource.includes('../../css/static-fixes.css') &&
    (await exists(path.join(DOCS_ROOT, "assets", "css", "static-fixes.css"))),
  searchIndexDocuments,
  cname,
  obsoleteCommercePaths
};

const postFiles = allFiles.filter((file) => /^post\/[^/]+\/index\.html$/.test(path.relative(DOCS_ROOT, file).split(path.sep).join("/")));
const imageFiles = allFiles.filter(
  (file) =>
    path.relative(DOCS_ROOT, file).split(path.sep)[0] === "image" &&
    IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())
);
const legacyDatedPostFiles = allFiles.filter((file) =>
  /^20\d{2}\/\d{2}\/\d{2}\/[^/]+\/index\.html$/.test(
    path.relative(DOCS_ROOT, file).split(path.sep).join("/")
  )
);
const legacyUploadImages = allFiles.filter((file) => {
  const relative = path.relative(DOCS_ROOT, file).split(path.sep).join("/");
  return relative.startsWith("wp-content/uploads/") && IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
});
const urlMigration = {
  migratedPosts: urlMigrationPlan?.postCount ?? 0,
  addedStaticPosts: 2,
  expectedPosts: (urlMigrationPlan?.postCount ?? 0) + 2,
  actualPosts: postFiles.length,
  migratedImages: urlMigrationPlan?.imageDestinationCount ?? 0,
  addedStaticImages: 6,
  expectedImages: (urlMigrationPlan?.imageDestinationCount ?? 0) + 6,
  actualImages: imageFiles.length,
  legacyDatedPostFiles: legacyDatedPostFiles.map((file) => path.relative(REPO_ROOT, file)),
  legacyUploadImages: legacyUploadImages.map((file) => path.relative(REPO_ROOT, file)),
  staleLegacyReferences,
  malformedStructuredData
};

const report = {
  generatedAt: new Date().toISOString(),
  files: { total: allFiles.length, html: htmlFiles.length, assets: allFiles.length - htmlFiles.length },
  componentCoverage,
  offlineCoverage,
  analytics: {
    pagesWithGtm: gtmPages,
    gtmContainer: EXPECTED_GTM,
    ga4Delivery: "via-gtm",
    ga4MeasurementId: EXPECTED_GA4
  },
  seo: {
    pagesWithCanonical: canonicalPages,
    missingDescriptions,
    missingIndexableH1,
    missingImageAlts: [...new Set(missingImageAlts)],
    duplicateIndexableTitles,
    brokenInternalFragments
  },
  generatedFeatures,
  urlMigration,
  archiveNavigation,
  security: {
    unexpectedForms,
    externalStatsScripts,
    backendScriptReferences,
    insecureSameSiteScriptReferences
  },
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
  brokenInternalFragments.length > 0 ||
  unexpectedForms.length > 0 ||
  missingDescriptions.length > 0 ||
  missingIndexableH1.length > 0 ||
  missingImageAlts.length > 0 ||
  duplicateIndexableTitles.length > 0 ||
  externalStatsScripts.length > 0 ||
  backendScriptReferences.length > 0 ||
  insecureSameSiteScriptReferences.length > 0 ||
  internalLinksOpeningNewTabs.length > 0 ||
  offlineRootResourceReferences.length > 0 ||
  offlineRootCssReferences.length > 0 ||
  componentCoverage.header !== htmlFiles.length ||
  componentCoverage.footer !== htmlFiles.length ||
  gtmPages !== htmlFiles.length ||
  canonicalPages !== htmlFiles.length - 1 ||
  !generatedFeatures.staticFixesStylesheet ||
  generatedFeatures.searchIndexDocuments < 1 ||
  generatedFeatures.cname !== "www.maxlist.xyz" ||
  generatedFeatures.obsoleteCommercePaths.length > 0 ||
  offlineCoverage.runtime !== htmlFiles.length ||
  offlineCoverage.pagesWithoutPreloader !== htmlFiles.length
  || urlMigration.migratedPosts !== 178
  || urlMigration.addedStaticPosts !== 2
  || urlMigration.expectedPosts !== 180
  || urlMigration.actualPosts !== urlMigration.expectedPosts
  || urlMigration.migratedImages !== 9418
  || urlMigration.addedStaticImages !== 6
  || urlMigration.expectedImages !== 9424
  || urlMigration.actualImages !== urlMigration.expectedImages
  || urlMigration.legacyDatedPostFiles.length > 0
  || urlMigration.legacyUploadImages.length > 0
  || urlMigration.staleLegacyReferences.length > 0
  || urlMigration.malformedStructuredData.length > 0
  || archiveNavigation.yearMismatches.length > 0
  || archiveNavigation.missingArchives.length > 0
) {
  process.exitCode = 1;
}
