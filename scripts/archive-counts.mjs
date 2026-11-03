import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { ORIGIN, SITE_HOSTS, writeFileEnsured } from "./lib.mjs";

export async function countArticleArchives(docsRoot) {
  const entries = await readdir(path.join(docsRoot, "post"), { withFileTypes: true });
  const counts = { total: 0, byYear: {} };
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const $ = load(await readFile(path.join(docsRoot, "post", entry.name, "index.html"), "utf8"));
    if (!$("body.single-post").length || $("article.status-draft").length || /\bnoindex\b/i.test($('meta[name="robots"]').attr("content") ?? "")) continue;
    const canonical = $('link[rel="canonical"]').attr("href") || `/post/${entry.name}/`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    counts.total += 1;
    const published = $('meta[property="article:published_time"]').attr("content") || $("time.entry-date").first().attr("datetime") || "";
    const year = published.match(/^(\d{4})-/)?.[1];
    if (year) counts.byYear[year] = (counts.byYear[year] ?? 0) + 1;
  }
  return counts;
}

export function archiveCountLabel(reference, currentLabel, counts) {
  let url;
  try { url = new URL(reference, ORIGIN); } catch { return null; }
  if (!SITE_HOSTS.has(url.hostname)) return null;
  if (decodeURIComponent(url.pathname) === "/category/所有文章/") return `All posts (${counts.total} 篇)`;
  const year = url.pathname.match(/^\/(\d{4})\/$/)?.[1];
  // Existing historical labels already show their imported page totals.
  // Bare/new year labels and article-count labels stay synchronized with posts.
  if (year && !/\bpages?\b/i.test(currentLabel)) return `${year} (${counts.byYear[year] ?? 0} 篇)`;
  return null;
}

async function writeIfChanged(file, contents) {
  let previous;
  try { previous = await readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (previous !== contents) await writeFileEnsured(file, contents);
}

export async function syncArchiveCounts(repoRoot) {
  const counts = await countArticleArchives(path.join(repoRoot, "docs"));
  for (const name of ["sidebar", "footer"]) {
    const file = path.join(repoRoot, "components", `${name}.html`);
    const $ = load(await readFile(file, "utf8"));
    $("#menu-year-list a[href]").each((_index, element) => {
      const anchor = $(element);
      const label = archiveCountLabel(anchor.attr("href"), anchor.text(), counts);
      if (label) anchor.text(label);
    });
    const html = $("body").html().trim();
    await writeIfChanged(file, `${html}\n`);
    const safeHtml = html.replace(/<\/script/gi, "<\\/script");
    const script = `(() => {\n  const script = document.currentScript;\n  script.insertAdjacentHTML("beforebegin", ${JSON.stringify(safeHtml)});\n  script.remove();\n})();\n`;
    await writeIfChanged(path.join(repoRoot, "docs/assets/js/components", `${name}.js`), script);
  }
  return counts;
}
