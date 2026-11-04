import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";

// Entry cards at the top of the homepage, counted from each post's category classes.
export const HOMEPAGE_TOPICS = [
  { anchor: "data-analyst", label: "數據分析", categories: ["analytics"] },
  { anchor: "data-visualization", label: "數據視覺化", categories: ["looker-studio-"] },
  { anchor: "data-tracking", label: "數據追蹤學", categories: ["gtm"] },
  {
    anchor: "data-skill",
    label: "程式大補帖",
    categories: ["python-base", "python-crawler", "python-flask", "python-sql", "python-ml", "python-django", "git-"]
  }
];

export async function collectHomepagePosts(docsRoot) {
  const posts = [];
  const seen = new Set();
  for (const entry of await readdir(path.join(docsRoot, "post"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const $ = load(await readFile(path.join(docsRoot, "post", entry.name, "index.html"), "utf8"));
    if (!$("body.single-post").length || $("article.status-draft").length || /\bnoindex\b/i.test($('meta[name="robots"]').attr("content") ?? "")) continue;
    const canonical = $('link[rel="canonical"]').attr("href") || `/post/${entry.name}/`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const categories = ($("article").first().attr("class") ?? "").split(/\s+/)
      .filter((name) => name.startsWith("category-"))
      .map((name) => name.slice("category-".length));
    // Same year rule as the yearly archives (scripts/archive-counts.mjs).
    const published = $('meta[property="article:published_time"]').attr("content") || $("time.entry-date").first().attr("datetime") || "";
    const title = ($("h1.entry-title").first().text() || $('meta[property="og:title"]').attr("content") || entry.name)
      .replace(/\s*-\s*Max行銷誌\s*$/, "").trim();
    const categoryNames = $(".entry-meta .cat-links a").toArray().map((element) => $(element).text().trim())
      .filter((name) => name && !["All posts", "所有文章"].includes(name));
    posts.push({ slug: entry.name, categories, published, title, categoryNames });
  }
  return posts;
}

export function homepageTopicCounts(posts) {
  return Object.fromEntries(HOMEPAGE_TOPICS.map((topic) => [
    topic.anchor,
    posts.filter((post) => post.categories.some((category) => topic.categories.includes(category))).length
  ]));
}

export function homepageCountText(count) {
  return `${count} 篇`;
}

// Every element tagged data-topic-count (learning-path steps, "看全部" buttons) shows its topic's count.
export function enhanceHomepage($, { counts }) {
  for (const topic of HOMEPAGE_TOPICS) {
    $(`[data-topic-count="${topic.anchor}"]`).text(homepageCountText(counts[topic.anchor]));
  }
}
