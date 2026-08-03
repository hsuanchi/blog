import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { load } from "cheerio";
import { writeFileEnsured } from "./lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const COMPONENT_ROOT = path.join(DOCS_ROOT, "assets", "js", "components");
const PARTIAL_ROOT = path.join(REPO_ROOT, "components");
const DATE_STAMP = new Date().toISOString().slice(0, 10);
const BACKUP_ROOT = path.resolve(
  process.env.MIGRATION_BACKUP_DIR ??
    path.join(REPO_ROOT, "..", "blog-migration-backup", DATE_STAMP)
);
const RAW_HTML_ROOT = path.join(BACKUP_ROOT, "public-html");

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

function classicComponentScript(html, afterInsert = "") {
  const safeHtml = html.replace(/<\/script/gi, "<\\/script");
  return `(() => {\n  const script = document.currentScript;\n  script.insertAdjacentHTML("beforebegin", ${JSON.stringify(safeHtml)});\n${afterInsert}  script.remove();\n})();\n`;
}

function stripMenuState($fragment) {
  $fragment(".current-menu-item, .current-menu-parent, .current-menu-ancestor, .current_page_item")
    .removeClass("current-menu-item current-menu-parent current-menu-ancestor current_page_item");
  $fragment("[aria-current]").removeAttr("aria-current");
}

function sameSiteRootRelative(value, base = "https://www.maxlist.xyz/") {
  try {
    const url = new URL(value, base);
    if (!new Set(["maxlist.xyz", "www.maxlist.xyz"]).has(url.hostname)) return value;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

function normalizeRawPartial(html, pageUrl) {
  const $ = load(`<body>${html}</body>`, { decodeEntities: false });
  const attributes = [
    ["a[href]", "href"],
    ["form[action]", "action"],
    ["img[src]", "src"],
    ["img[data-src]", "data-src"],
    ["img[data-lazy-src]", "data-lazy-src"],
    ["script[src]", "src"]
  ];
  for (const [selector, attribute] of attributes) {
    $(selector).each((_index, element) => {
      const value = $(element).attr(attribute);
      if (value) $(element).attr(attribute, sameSiteRootRelative(value, pageUrl));
    });
  }
  for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
    $(`[${attribute}]`).each((_index, element) => {
      const value = $(element).attr(attribute) ?? "";
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const [url, ...descriptor] = candidate.trim().split(/\s+/);
          return [sameSiteRootRelative(url, pageUrl), ...descriptor].join(" ");
        })
        .join(", ");
      $(element).attr(attribute, rewritten);
    });
  }
  $("img[data-src], img[data-lazy-src]").each((_index, element) => {
    const actual = $(element).attr("data-src") ?? $(element).attr("data-lazy-src");
    if (actual) $(element).attr("src", actual);
    const srcset = $(element).attr("data-srcset") ?? $(element).attr("data-lazy-srcset");
    if (srcset) $(element).attr("srcset", srcset);
  });
  return $("body").html() ?? html;
}

function extractComponents(sourceHtml) {
  const $ = load(sourceHtml, { decodeEntities: false });
  const headerSelectors = [
    ".header-clone",
    "header#masthead",
    ".sydney-offcanvas-menu",
    "header#masthead-mobile"
  ];
  const headerHtml = headerSelectors.map((selector) => $(selector).first().prop("outerHTML") ?? "").join("\n");
  const sidebarHtml = $("#secondary").first().prop("outerHTML") ?? "";
  const footerHtml = ["#sidebar-footer", "footer#colophon"]
    .map((selector) => $(selector).first().prop("outerHTML") ?? "")
    .join("\n");

  return {
    header: headerHtml,
    sidebar: sidebarHtml,
    footer: footerHtml
  };
}

async function readableNonEmpty(file) {
  try {
    await access(file);
    const contents = await readFile(file, "utf8");
    return contents.trim() ? contents.trim() : "";
  } catch {
    return "";
  }
}

async function findRawSelector(selector) {
  const rawFiles = (await filesBelow(RAW_HTML_ROOT)).filter((file) => file.endsWith(".html"));
  for (const file of rawFiles) {
    const html = await readFile(file, "utf8");
    const $ = load(html, { decodeEntities: false });
    const component = $(selector).first().prop("outerHTML") ?? "";
    if (component.trim()) {
      const relative = path.relative(RAW_HTML_ROOT, file).replace(/index\.html$/, "");
      const pageUrl = new URL(relative, "https://www.maxlist.xyz/").href;
      return normalizeRawPartial(component, pageUrl);
    }
  }
  return "";
}

function replaceGroup($, selectors, scriptSrc) {
  const elements = selectors.flatMap((selector) => $(selector).toArray());
  if (elements.length === 0) return false;
  $(elements[0]).before(`<script src="${scriptSrc}"></script>`);
  for (const element of elements) $(element).remove();
  return true;
}

const source = await readFile(path.join(DOCS_ROOT, "index.html"), "utf8");
const extracted = extractComponents(source);
const components = {
  header:
    extracted.header.trim() ||
    (await readableNonEmpty(path.join(PARTIAL_ROOT, "header.html"))),
  sidebar:
    extracted.sidebar.trim() ||
    (await readableNonEmpty(path.join(PARTIAL_ROOT, "sidebar.html"))) ||
    (await findRawSelector("#secondary")),
  footer:
    extracted.footer.trim() ||
    (await readableNonEmpty(path.join(PARTIAL_ROOT, "footer.html")))
};
if (!components.header || !components.sidebar || !components.footer) {
  throw new Error("Could not recover non-empty Sydney header, sidebar, and footer components");
}
const headerFragment = load(`<body>${components.header}</body>`, { decodeEntities: false });
stripMenuState(headerFragment);
components.header = headerFragment("body").html() ?? components.header;
await Promise.all(
  Object.entries(components).map(([name, html]) =>
    writeFileEnsured(path.join(PARTIAL_ROOT, `${name}.html`), `${html}\n`)
  )
);

const activeMenuCode = `  const fixes = document.createElement("link");
  fixes.rel = "stylesheet";
  fixes.href = new URL("../../css/static-fixes.css?v=20260802-3", script.src).href;
  document.head.append(fixes);
  const current = location.pathname.replace(/\\/$/, "") || "/";
  document.querySelectorAll("#masthead a[href], #masthead-mobile a[href]").forEach((link) => {
    const target = new URL(link.href, location.href).pathname.replace(/\\/$/, "") || "/";
    if (target === current) {
      link.setAttribute("aria-current", "page");
      link.closest("li")?.classList.add("current-menu-item");
    }
  });
  const menuToggle = document.querySelector("#masthead-mobile .menu-toggle");
  const menuClose = document.querySelector(".mobile-menu-close");
  const syncMenuState = () => {
    const open = document.body.classList.contains("mobile-menu-visible");
    menuToggle?.setAttribute("aria-expanded", String(open));
    menuToggle?.setAttribute("aria-label", open ? "關閉選單" : "開啟選單");
  };
  menuToggle?.addEventListener("click", () => requestAnimationFrame(syncMenuState));
  menuClose?.addEventListener("click", () => requestAnimationFrame(syncMenuState));
  document.querySelectorAll(".header-search").forEach((toggle) => {
    toggle.addEventListener("click", () => requestAnimationFrame(() => {
      const open = toggle.querySelector(".icon-cancel")?.classList.contains("active") ?? false;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "關閉搜尋" : "開啟搜尋");
    }));
  });
`;

await Promise.all([
  writeFileEnsured(
    path.join(COMPONENT_ROOT, "header.js"),
    classicComponentScript(components.header, activeMenuCode)
  ),
  writeFileEnsured(
    path.join(COMPONENT_ROOT, "sidebar.js"),
    classicComponentScript(components.sidebar)
  ),
  writeFileEnsured(
    path.join(COMPONENT_ROOT, "footer.js"),
    classicComponentScript(components.footer)
  )
]);

const htmlFiles = (await filesBelow(DOCS_ROOT)).filter(
  (file) => file.endsWith(".html") && !file.startsWith(PARTIAL_ROOT)
);
let modified = 0;
let alreadyUsingComponents = 0;
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const $ = load(html, { decodeEntities: false });
  if (
    $('script[src="/assets/js/components/header.js"]').length ||
    $('script[src="/assets/js/components/footer.js"]').length
  ) {
    alreadyUsingComponents += 1;
  }
  const changed = [
    replaceGroup(
      $,
      [".header-clone", "header#masthead", ".sydney-offcanvas-menu", "header#masthead-mobile"],
      "/assets/js/components/header.js"
    ),
    replaceGroup($, ["#secondary"], "/assets/js/components/sidebar.js"),
    replaceGroup($, ["#sidebar-footer", "footer#colophon"], "/assets/js/components/footer.js")
  ].some(Boolean);
  if (changed) {
    await writeFileEnsured(file, $.html());
    modified += 1;
  }
}

console.log(
  `Shared Sydney components generated; ${modified} pages converted and ` +
    `${alreadyUsingComponents} pages were already componentized.`
);
