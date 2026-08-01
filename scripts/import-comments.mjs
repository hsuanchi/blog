import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { load } from "cheerio";
import { pageOutputPath, writeFileEnsured } from "./lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const DATE_STAMP = new Date().toISOString().slice(0, 10);
const BACKUP_ROOT = path.resolve(
  process.env.MIGRATION_BACKUP_DIR ??
    path.join(REPO_ROOT, "..", "blog-migration-backup", DATE_STAMP)
);
const WXR_FILE =
  process.env.WXR_FILE ?? path.join(BACKUP_ROOT, "wordpress-export.xml");
const REPORT_FILE = path.join(REPO_ROOT, "reports", "comments.json");
const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul"
]);
const ALLOWED_ATTRIBUTES = {
  a: new Set(["href", "title"]),
  blockquote: new Set(["cite"])
};

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeCommentHtml(input) {
  const $ = load(`<div id="comment-sanitizer">${input}</div>`, {
    decodeEntities: false
  });
  $("script, style, iframe, object, embed, form, input, button").remove();
  $("#comment-sanitizer *").each((_index, element) => {
    const tagName = element.tagName?.toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) {
      $(element).replaceWith($(element).contents());
      return;
    }
    const allowed = ALLOWED_ATTRIBUTES[tagName] ?? new Set();
    for (const attribute of Object.keys(element.attribs ?? {})) {
      if (!allowed.has(attribute.toLowerCase())) $(element).removeAttr(attribute);
    }
    if (tagName === "a") {
      const href = $(element).attr("href") ?? "";
      if (!/^(https?:|mailto:|\/|#)/i.test(href)) $(element).removeAttr("href");
      else {
        $(element).attr("rel", "nofollow ugc");
        if (/^https?:/i.test(href)) $(element).attr("target", "_blank");
      }
    }
  });
  return $("#comment-sanitizer").html() ?? "";
}

function formatLocalDate(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!match) return value;
  return `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日 ${match[4]}:${match[5]}`;
}

function isoDate(localDate, gmtDate) {
  const source = gmtDate || localDate;
  const normalized = source.replace(" ", "T");
  return `${normalized}${gmtDate ? "Z" : "+08:00"}`;
}

function renderComment(comment, childrenByParent, depth = 1) {
  const children = childrenByParent.get(comment.id) ?? [];
  const childMarkup = children.length
    ? `<ol class="children">${children
        .map((child) => renderComment(child, childrenByParent, depth + 1))
        .join("")}</ol>`
    : "";
  return `<li id="comment-${comment.id}" class="comment depth-${depth}">
  <article id="div-comment-${comment.id}" class="comment-body">
    <footer class="comment-meta">
      <div class="comment-author vcard"><b class="fn">${escapeHtml(comment.author || "匿名")}</b><span class="says"> 表示：</span></div>
      <div class="comment-metadata"><a href="#comment-${comment.id}"><time datetime="${escapeHtml(isoDate(comment.date, comment.dateGmt))}">${escapeHtml(formatLocalDate(comment.date))}</time></a></div>
    </footer>
    <div class="comment-content">${sanitizeCommentHtml(comment.content)}</div>
  </article>
  ${childMarkup}
</li>`;
}

function renderComments(title, comments) {
  const childrenByParent = new Map();
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  for (const comment of comments) {
    const parent = byId.has(comment.parent) ? comment.parent : "0";
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(comment);
  }
  const roots = childrenByParent.get("0") ?? [];
  const list = roots.map((comment) => renderComment(comment, childrenByParent)).join("");
  return `<div id="comments" class="comments-area comments-static" data-static-comments="true">
  <h2 class="comments-title">「${escapeHtml(title)}」共有 ${comments.length} 則已核准留言</h2>
  <ol class="comment-list">${list}</ol>
</div>`;
}

const wxr = await readFile(WXR_FILE, "utf8");
const $xml = load(wxr, { xmlMode: true, decodeEntities: false });
const postRecords = [];

$xml("channel > item").each((_index, itemElement) => {
  const item = $xml(itemElement);
  const type = item.find("wp\\:post_type").first().text().trim();
  const status = item.find("wp\\:status").first().text().trim();
  if (!new Set(["post", "page"]).has(type) || status !== "publish") return;
  const link = item.children("link").first().text().trim();
  const title = item.children("title").first().text().trim();
  const comments = [];
  item.children("wp\\:comment").each((_commentIndex, commentElement) => {
    const comment = $xml(commentElement);
    const approved = comment.children("wp\\:comment_approved").first().text().trim();
    const commentType = comment.children("wp\\:comment_type").first().text().trim();
    if (approved !== "1" || !new Set(["", "comment"]).has(commentType)) return;
    comments.push({
      id: comment.children("wp\\:comment_id").first().text().trim(),
      parent: comment.children("wp\\:comment_parent").first().text().trim() || "0",
      author: comment.children("wp\\:comment_author").first().text().trim(),
      date: comment.children("wp\\:comment_date").first().text().trim(),
      dateGmt: comment.children("wp\\:comment_date_gmt").first().text().trim(),
      content: comment.children("wp\\:comment_content").first().text()
    });
  });
  if (comments.length > 0) postRecords.push({ link, title, comments });
});

let importedComments = 0;
let pagesUpdated = 0;
const skipped = [];
const countsByPage = [];

for (const record of postRecords) {
  const file = pageOutputPath(DOCS_ROOT, record.link);
  if (!(await exists(file))) {
    skipped.push({ link: record.link, reason: "Static published page was not found" });
    continue;
  }
  const html = await readFile(file, "utf8");
  const $ = load(html, { decodeEntities: false });
  $("#comments[data-static-comments]").remove();
  const markup = renderComments(record.title, record.comments);
  const navigation = $("#primary main .post-navigation").last();
  const article = $("#primary main article").last();
  if (navigation.length) navigation.after(markup);
  else if (article.length) article.after(markup);
  else {
    skipped.push({ link: record.link, reason: "Could not locate Sydney article container" });
    continue;
  }
  await writeFileEnsured(file, $.html());
  importedComments += record.comments.length;
  pagesUpdated += 1;
  countsByPage.push({ link: record.link, approvedComments: record.comments.length });
}

await writeFileEnsured(
  REPORT_FILE,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: path.basename(WXR_FILE),
      pagesUpdated,
      approvedCommentsImported: importedComments,
      skipped,
      countsByPage
    },
    null,
    2
  )}\n`
);

console.log(
  `Imported ${importedComments} approved comments into ${pagesUpdated} published static pages; ` +
    `${skipped.length} page records skipped.`
);
