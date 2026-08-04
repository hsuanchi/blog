import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { writeFileEnsured } from "./lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
if (!process.env.CAFE_SOURCE_DIR) {
  throw new Error(
    "Set CAFE_SOURCE_DIR to a local checkout of https://github.com/hsuanchi/miyako-cafes"
  );
}
const SOURCE_ROOT = path.resolve(process.env.CAFE_SOURCE_DIR);
const TEMPLATE_FILE = path.join(DOCS_ROOT, "post", "shopee-crawler", "index.html");
const MODIFIED = "2026-08-04T00:00:00+08:00";
const AUTHOR_ID = "https://www.maxlist.xyz/#/schema/person/e66635bb66154fb8e67d40281a5de5aa";

const guides = [
  {
    key: "miyako",
    slug: "miyako-cafes",
    postId: "11001",
    title: "宮古島咖啡地圖：分析 3,091 則評論，精選 15 家咖啡店",
    shortTitle: "宮古島咖啡地圖",
    description:
      "分析 3,091 則 Google Maps 公開評論，從咖啡信號、星等、口碑與負評精選宮古島 15 間咖啡店，附完整評論、地圖與店家資訊。",
    published: "2026-04-04T22:10:10+08:00",
    dateText: "4 4 月, 2026",
    sourceHtml: "miyako-cafes.html",
    cover: "miyako-cafes-cover.jpg",
    coverWidth: 2880,
    coverHeight: 1488,
    mapSource: "map-full.png",
    mapTarget: "/image/miyako-cafes-map.png",
    cssOutput: "miyako-cafes.css",
    jsOutput: "miyako-cafes.js",
    scope: ".cafe-guide-miyako",
    keywords: ["宮古島咖啡", "宮古島咖啡廳", "宮古島旅遊", "咖啡地圖", "Google Maps 評論分析"]
  },
  {
    key: "thonglor",
    slug: "bts-thong-lor-station-cafes",
    postId: "11002",
    title: "BTS Thong Lor 咖啡地圖：分析 4,731 則評論，精選 20 家咖啡店",
    shortTitle: "BTS Thong Lor Station 咖啡地圖",
    description:
      "分析 4,731 則 Google Maps 公開評論，從咖啡信號、星等、語系與負評精選 BTS Thong Lor Station 周邊 20 間咖啡店。",
    published: "2026-07-20T11:13:20+08:00",
    dateText: "20 7 月, 2026",
    sourceHtml: "bts-thong-lor-station-cafes.html",
    cover: "bts-thong-lor-cafes-cover.png",
    coverWidth: 1200,
    coverHeight: 630,
    mapSource: "bts-thong-lor-map.png",
    mapTarget: "/image/bts-thong-lor-cafes-map.png",
    cssOutput: "bts-thong-lor-cafes.css",
    jsOutput: "bts-thong-lor-cafes.js",
    scope: ".cafe-guide-thonglor",
    keywords: ["Thong Lor 咖啡", "曼谷咖啡廳", "BTS Thong Lor", "咖啡地圖", "Google Maps 評論分析"]
  }
];

function ensureMeta($, selector, attributes) {
  const existing = $(selector).first();
  const element = existing.length ? existing : $("<meta>").appendTo("head");
  element.attr(attributes);
  return element;
}

function splitSelectors(input) {
  const selectors = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const previous = input[index - 1];
    if (quote) {
      current += character;
      if (character === quote && previous !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      selectors.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  selectors.push(current);
  return selectors;
}

function scopedSelector(selector, scope) {
  let value = selector.trim();
  if (!value) return value;
  value = value
    .replace(/\bhtml\s+body\b/g, scope)
    .replace(/\bbody\b/g, scope)
    .replace(/\bhtml\b/g, scope)
    .replace(/:root\b/g, scope);
  if (value.includes(scope)) return value;
  return `${scope} ${value}`;
}

function findOpeningBrace(css, start) {
  let quote = "";
  let comment = false;
  for (let index = start; index < css.length; index += 1) {
    const character = css[index];
    const next = css[index + 1];
    const previous = css[index - 1];
    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && character === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote && previous !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") return index;
  }
  return -1;
}

function findClosingBrace(css, opening) {
  let depth = 1;
  let quote = "";
  let comment = false;
  for (let index = opening + 1; index < css.length; index += 1) {
    const character = css[index];
    const next = css[index + 1];
    const previous = css[index - 1];
    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && character === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote && previous !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Unbalanced CSS block");
}

function scopeCss(css, scope) {
  let output = "";
  let cursor = 0;
  while (cursor < css.length) {
    const opening = findOpeningBrace(css, cursor);
    if (opening < 0) {
      output += css.slice(cursor);
      break;
    }
    const closing = findClosingBrace(css, opening);
    const rawHeader = css.slice(cursor, opening);
    const body = css.slice(opening + 1, closing);
    const match = rawHeader.match(/^(\s*(?:(?:\/\*[\s\S]*?\*\/)\s*)*)([\s\S]*)$/);
    const prefix = match?.[1] ?? "";
    const header = (match?.[2] ?? rawHeader).trim();
    if (/^@(media|supports|container|layer|document)\b/i.test(header)) {
      output += `${prefix}${header}{${scopeCss(body, scope)}}`;
    } else if (/^@(keyframes|-webkit-keyframes|font-face|page|property|counter-style)\b/i.test(header)) {
      output += `${prefix}${header}{${body}}`;
    } else {
      const selectors = splitSelectors(header).map((selector) => scopedSelector(selector, scope));
      output += `${prefix}${selectors.join(",\n")}{${body}}`;
    }
    cursor = closing + 1;
  }
  return output;
}

function schemaFor(guide, wordCount) {
  const canonical = `https://www.maxlist.xyz/post/${guide.slug}/`;
  const image = `https://www.maxlist.xyz/image/${guide.cover}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${canonical}#article`,
        isPartOf: { "@id": canonical },
        author: { "@id": AUTHOR_ID, name: "Max" },
        headline: guide.title,
        description: guide.description,
        datePublished: guide.published,
        dateModified: MODIFIED,
        mainEntityOfPage: { "@id": canonical },
        wordCount,
        image: { "@id": `${canonical}#primaryimage` },
        keywords: guide.keywords,
        articleSection: ["All posts", "咖啡地圖"],
        inLanguage: "zh-TW"
      },
      {
        "@type": "WebPage",
        "@id": canonical,
        url: canonical,
        name: `${guide.title} - Max行銷誌`,
        description: guide.description,
        primaryImageOfPage: { "@id": `${canonical}#primaryimage` },
        datePublished: guide.published,
        dateModified: MODIFIED,
        breadcrumb: { "@id": `${canonical}#breadcrumb` },
        inLanguage: "zh-TW"
      },
      {
        "@type": "ImageObject",
        "@id": `${canonical}#primaryimage`,
        url: image,
        contentUrl: image,
        width: guide.coverWidth,
        height: guide.coverHeight,
        caption: guide.shortTitle,
        inLanguage: "zh-TW"
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "首頁", item: "https://www.maxlist.xyz/" },
          {
            "@type": "ListItem",
            position: 2,
            name: "咖啡地圖",
            item: "https://www.maxlist.xyz/category/%E5%92%96%E5%95%A1%E5%9C%B0%E5%9C%96/"
          },
          { "@type": "ListItem", position: 3, name: guide.title }
        ]
      },
      {
        "@type": "WebSite",
        "@id": "https://www.maxlist.xyz/#website",
        url: "https://www.maxlist.xyz/",
        name: "Max行銷誌",
        description: "行銷、數據分析、與 Python",
        inLanguage: "zh-TW"
      },
      {
        "@type": ["Person", "Organization"],
        "@id": AUTHOR_ID,
        name: "Max",
        url: "https://www.maxlist.xyz/post/author/"
      }
    ]
  };
}

function archiveCard($archive, guide) {
  const card = $archive(".posts-layout article").first().clone();
  card.attr("id", `post-${guide.postId}`);
  card.attr(
    "class",
    `post-${guide.postId} post type-post status-publish format-standard has-post-thumbnail hentry category-220 category-cafe-map post-align-center post-vertical-align-middle col-lg-4 col-md-4`
  );
  card.find(".entry-thumb").remove();
  card.find(".content-inner").prepend(`<div class="entry-thumb"><a href="/post/${guide.slug}/" title="${guide.title}"><img width="${guide.coverWidth}" height="${guide.coverHeight}" src="/image/${guide.cover}" class="attachment-large-thumb size-large-thumb wp-post-image" alt="${guide.shortTitle}" decoding="async" loading="lazy"></a></div>`);
  card.find("h2.entry-title").html(`<a href="/post/${guide.slug}/" rel="bookmark">${guide.title}</a>`);
  const time = card.find("time.entry-date").first();
  time.attr("datetime", guide.published).text(guide.dateText);
  time.closest("a").attr("href", `/post/${guide.slug}/`);
  return card.prop("outerHTML");
}

function cleanGuideHtml($source, guide) {
  $source("body script").remove();
  $source("body h1").each((_index, element) => {
    element.tagName = "div";
    element.name = "div";
    $source(element).addClass("guide-display-title").removeAttr("id");
  });
  $source(`img[src="${guide.mapSource}"]`).attr("src", guide.mapTarget);
  $source("img").attr("decoding", "async").attr("loading", "lazy");
  $source(".hero img").attr("loading", "eager").attr("fetchpriority", "high");
  if (guide.key === "thonglor") {
    const main = $source("body > main").first();
    if (main.length) {
      const element = main.get(0);
      element.tagName = "div";
      element.name = "div";
      main.addClass("guide-main");
    }
  }
  if (guide.key === "miyako") {
    $source(".collapsed-row").attr({ role: "button", tabindex: "0", "aria-expanded": "false" });
    $source(".map-callout-label").attr({ role: "button", tabindex: "0" });
  }
  return $source("body").html() ?? "";
}

async function buildGuide(guide) {
  const sourceRaw = await readFile(path.join(SOURCE_ROOT, guide.sourceHtml), "utf8");
  const $source = load(sourceRaw, { decodeEntities: false });
  const guideHtml = cleanGuideHtml($source, guide);
  let css;
  let js;
  if (guide.key === "miyako") {
    const $raw = load(sourceRaw, { decodeEntities: false });
    css = $raw("head style").first().html() ?? "";
    js = $raw("body script")
      .toArray()
      .map((element) => $raw(element).html() ?? "")
      .join("\n\n");
    css = css.replace(
      /https:\/\/images\.unsplash\.com\/photo-1495474472287-4d71bcdd2085\?w=1920&q=80/g,
      "../../../image/miyako-cafes-hero.jpg"
    );
    js += `\n\ndocument.querySelectorAll('.cafe-guide-miyako .collapsed-row, .cafe-guide-miyako .map-callout-label').forEach(function (control) {\n  control.addEventListener('keydown', function (event) {\n    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); control.click(); }\n  });\n  if (control.classList.contains('collapsed-row')) {\n    control.addEventListener('click', function () {\n      var detail = document.getElementById(control.id.replace('row-', 'detail-'));\n      control.setAttribute('aria-expanded', detail && detail.style.display === 'block' ? 'true' : 'false');\n    });\n  }\n});\n`;
  } else {
    css = await readFile(path.join(SOURCE_ROOT, "bts-thong-lor.css"), "utf8");
    js = await readFile(path.join(SOURCE_ROOT, "bts-thong-lor.js"), "utf8");
    css = css.replace(/bts-thong-lor-hero\.jpg/g, "../../../image/bts-thong-lor-cafes-hero.jpg");
  }
  const scoped = scopeCss(css, guide.scope);
  const overrides = `
body.cafe-guide-post .content-wrapper.container{max-width:1400px}
body.cafe-guide-post #primary.content-area{float:none;flex:0 0 100%;width:100%;max-width:100%;min-width:0}
body.cafe-guide-post #secondary{display:none!important}
body.cafe-guide-post #main,body.cafe-guide-post article,body.cafe-guide-post .content-inner,body.cafe-guide-post .entry-content{min-width:0}
body.cafe-guide-post .entry-header,body.cafe-guide-post .entry-footer,body.cafe-guide-post .cafe-guide-navigation{max-width:1100px;margin-left:auto;margin-right:auto}
${guide.scope}{display:block;max-width:100%;margin:0 0 40px;overflow:hidden;border-radius:14px;background:#fdfbf9;color:#1e1410;font-size:16px;line-height:1.65;box-shadow:0 12px 36px rgba(44,24,16,.08)}
${guide.scope} .guide-display-title{font-family:var(--serif,Georgia,serif);font-size:clamp(42px,7vw,76px);font-weight:800;color:#fff;line-height:1.06;letter-spacing:-.03em;margin:0 0 28px}
${guide.scope} .hero{min-height:clamp(540px,72vh,760px)}
${guide.scope} .guide-main{display:block}
${guide.scope} button{font-family:inherit;text-transform:none;letter-spacing:normal}
${guide.scope} img{max-width:100%;height:auto}
${guide.scope} [role="button"]:focus-visible,${guide.scope} button:focus-visible,${guide.scope} a:focus-visible{outline:3px solid #d65050;outline-offset:3px}
${guide.scope} .map-wrapper,${guide.scope} .map-shell{max-width:100%}
${guide.scope} .map-legend{min-width:0}
${guide.scope} .map-shell{height:auto}
${guide.scope} .map-canvas{flex:1 1 62%;min-width:0;height:auto;aspect-ratio:1}
${guide.scope} .map-aside{flex:1 1 34%;min-width:0;height:auto}
@media(max-width:767px){
body.cafe-guide-post.single .entry-header h1.entry-title{font-size:28px;line-height:1.25;letter-spacing:-.02em;overflow-wrap:anywhere}
${guide.scope}{width:calc(100% + 30px);max-width:none;margin-left:-15px;margin-right:-15px;border-radius:0}
${guide.scope} .hero{min-height:520px}
${guide.scope} .guide-display-title{font-size:42px}
}
`;
  await writeFileEnsured(
    path.join(DOCS_ROOT, "assets", "css", "posts", guide.cssOutput),
    `${scoped.trim()}\n${overrides.trim()}\n`
  );
  await writeFileEnsured(
    path.join(DOCS_ROOT, "assets", "js", "posts", guide.jsOutput),
    `${js.trim()}\n`
  );

  const template = await readFile(TEMPLATE_FILE, "utf8");
  const $ = load(template, { decodeEntities: false });
  const canonical = `https://www.maxlist.xyz/post/${guide.slug}/`;
  const coverUrl = `https://www.maxlist.xyz/image/${guide.cover}`;
  $("html").attr("lang", "zh-TW");
  $("body")
    .removeClass((_index, className) =>
      (className ?? "")
        .split(/\s+/)
        .filter((name) => /^postid-\d+$/.test(name))
        .join(" ")
    )
    .addClass(`postid-${guide.postId} cafe-guide-post`);
  $("title").text(`${guide.title} - Max行銷誌`);
  $('link[rel="canonical"]').attr("href", canonical);
  ensureMeta($, 'meta[name="description"]', { name: "description", content: guide.description });
  ensureMeta($, 'meta[name="robots"]', {
    name: "robots",
    content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
  });
  ensureMeta($, 'meta[name="author"]', { name: "author", content: "Max" });
  ensureMeta($, 'meta[property="og:locale"]', { property: "og:locale", content: "zh_TW" });
  ensureMeta($, 'meta[property="og:type"]', { property: "og:type", content: "article" });
  ensureMeta($, 'meta[property="og:title"]', { property: "og:title", content: guide.title });
  ensureMeta($, 'meta[property="og:description"]', {
    property: "og:description",
    content: guide.description
  });
  ensureMeta($, 'meta[property="og:url"]', { property: "og:url", content: canonical });
  ensureMeta($, 'meta[property="og:site_name"]', { property: "og:site_name", content: "Max行銷誌" });
  ensureMeta($, 'meta[property="og:image"]', { property: "og:image", content: coverUrl });
  ensureMeta($, 'meta[property="og:image:width"]', {
    property: "og:image:width",
    content: String(guide.coverWidth)
  });
  ensureMeta($, 'meta[property="og:image:height"]', {
    property: "og:image:height",
    content: String(guide.coverHeight)
  });
  ensureMeta($, 'meta[property="article:published_time"]', {
    property: "article:published_time",
    content: guide.published
  });
  ensureMeta($, 'meta[property="article:modified_time"]', {
    property: "article:modified_time",
    content: MODIFIED
  });
  ensureMeta($, 'meta[property="article:section"]', {
    property: "article:section",
    content: "咖啡地圖"
  });
  ensureMeta($, 'meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  ensureMeta($, 'meta[name="twitter:title"]', { name: "twitter:title", content: guide.title });
  ensureMeta($, 'meta[name="twitter:description"]', {
    name: "twitter:description",
    content: guide.description
  });
  ensureMeta($, 'meta[name="twitter:image"]', { name: "twitter:image", content: coverUrl });
  $("head").append(`<link rel="stylesheet" href="/assets/css/posts/${guide.cssOutput}">`);

  const article = $("main article").first();
  article.attr(
    "class",
    `post-${guide.postId} post type-post status-publish format-standard has-post-thumbnail hentry category-220 category-cafe-map`
  );
  article.attr("id", `post-${guide.postId}`);
  article.find("h1.entry-title").text(guide.title);
  article.find(".entry-meta").html(`<span class="byline"><span class="author vcard">By <a class="url fn n" href="/post/author/">Max</a></span></span><span class="cat-links"><a href="/category/%E5%92%96%E5%95%A1%E5%9C%B0%E5%9C%96/" rel="category tag">咖啡地圖</a></span><span class="posted-on"> 發布時間 <a href="/post/${guide.slug}/" rel="bookmark"><time class="entry-date published" datetime="${guide.published}">${guide.dateText}</time></a></span>`);
  article.find(".entry-thumb").remove();
  article.find(".entry-content").html(`<div class="cafe-guide cafe-guide-${guide.key === "thonglor" ? "thonglor" : "miyako"}">${guideHtml}</div>`);
  article.find(".entry-footer").html(
    `<span class="cat-links"><a href="/category/%E5%92%96%E5%95%A1%E5%9C%B0%E5%9C%96/" rel="category tag">咖啡地圖</a></span>`
  );
  $("#comments").remove();
  $(".post-navigation").remove();
  const other = guides.find((candidate) => candidate.slug !== guide.slug);
  article.after(`<nav class="navigation post-navigation cafe-guide-navigation" aria-label="咖啡地圖文章"><div class="nav-links"><div class="nav-next"><a href="/post/${other.slug}/" rel="next"><span class="title">下一篇咖啡地圖</span> ${other.title}</a></div></div></nav>`);
  if (guide.key === "thonglor") {
    $("body").append('<script src="/assets/data/posts/bts-thong-lor-embedded-data.js"></script>');
  }
  $("body").append(`<script src="/assets/js/posts/${guide.jsOutput}"></script>`);
  const wordCount = $source("body").text().replace(/\s+/g, "").length;
  $("script.yoast-schema-graph").first().text(JSON.stringify(schemaFor(guide, wordCount)));
  const output = path.join(DOCS_ROOT, "post", guide.slug, "index.html");
  await writeFileEnsured(output, $.html());
}

async function updateArchive(file, selectedGuides) {
  const $ = load(await readFile(file, "utf8"), { decodeEntities: false });
  for (const guide of selectedGuides) $(`#post-${guide.postId}`).remove();
  const cards = selectedGuides.map((guide) => archiveCard($, guide)).join("\n");
  $(".posts-layout > .row").prepend(cards);
  if (file === path.join(DOCS_ROOT, "2026", "index.html")) {
    const description = "2026 年 Max行銷誌文章彙整，共 3 篇。";
    ensureMeta($, 'meta[name="description"]', { name: "description", content: description });
    ensureMeta($, 'meta[property="og:description"]', {
      property: "og:description",
      content: description
    });
  }
  if (file === path.join(DOCS_ROOT, "category", "所有文章", "index.html")) {
    const description = "Max行銷誌全部 180 篇文章，涵蓋行銷、數據分析、Python、資料工程與咖啡地圖。";
    ensureMeta($, 'meta[name="description"]', { name: "description", content: description });
    ensureMeta($, 'meta[property="og:description"]', {
      property: "og:description",
      content: description
    });
  }
  await writeFile(file, $.html());
}

async function createCoffeeCategory() {
  const source = path.join(DOCS_ROOT, "category", "所有文章", "index.html");
  const $ = load(await readFile(source, "utf8"), { decodeEntities: false });
  const canonical = "https://www.maxlist.xyz/category/%E5%92%96%E5%95%A1%E5%9C%B0%E5%9C%96/";
  const description = "Max行銷誌的咖啡地圖與 Google Maps 評論分析文章。";
  $("title").text("咖啡地圖 - Max行銷誌");
  $('link[rel="canonical"]').attr("href", canonical);
  ensureMeta($, 'meta[name="description"]', { name: "description", content: description });
  ensureMeta($, 'meta[property="og:title"]', { property: "og:title", content: "咖啡地圖 - Max行銷誌" });
  ensureMeta($, 'meta[property="og:description"]', { property: "og:description", content: description });
  ensureMeta($, 'meta[property="og:url"]', { property: "og:url", content: canonical });
  $("body").removeClass().addClass("archive category category-cafe-map");
  $("h1.archive-title span").text("咖啡地圖");
  const cards = guides
    .slice()
    .sort((left, right) => right.published.localeCompare(left.published))
    .map((guide) => archiveCard($, guide))
    .join("\n");
  $(".posts-layout > .row").html(cards);
  $("nav.navigation.pagination").remove();
  const output = path.join(DOCS_ROOT, "category", "咖啡地圖", "index.html");
  await writeFileEnsured(output, $.html());
}

async function updateHomepage() {
  const file = path.join(DOCS_ROOT, "index.html");
  const $ = load(await readFile(file, "utf8"), { decodeEntities: false });
  $("#coffee-guides").remove();
  $("#maxlist-coffee-home-style").remove();
  $("head").append(`<style id="maxlist-coffee-home-style">
.maxlist-coffee-home{padding:70px 24px;background:#f8f3ed}.maxlist-coffee-home__inner{max-width:1100px;margin:auto}.maxlist-coffee-home h2{margin:0 0 8px;text-align:center;color:#2c1810}.maxlist-coffee-home__lead{text-align:center;color:#5c4a3e;margin:0 0 32px}.maxlist-coffee-home__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.maxlist-coffee-home__card{display:block;background:#fff;color:#2c1810;border-radius:14px;overflow:hidden;box-shadow:0 10px 28px rgba(44,24,16,.1);text-decoration:none;transition:transform .2s ease,box-shadow .2s ease}.maxlist-coffee-home__card:hover{transform:translateY(-4px);box-shadow:0 16px 34px rgba(44,24,16,.15)}.maxlist-coffee-home__card img{display:block;width:100%;aspect-ratio:1.91/1;object-fit:cover}.maxlist-coffee-home__copy{padding:22px}.maxlist-coffee-home__copy small{color:#a0673a;font-weight:700;letter-spacing:.08em}.maxlist-coffee-home__copy h3{font-size:23px;margin:7px 0;color:#2c1810}.maxlist-coffee-home__copy p{font-size:15px;color:#5c4a3e;margin:0}@media(max-width:700px){.maxlist-coffee-home{padding:48px 18px}.maxlist-coffee-home__grid{grid-template-columns:1fr}}
</style>`);
  const cards = guides
    .slice()
    .sort((left, right) => right.published.localeCompare(left.published))
    .map(
      (guide) => `<a class="maxlist-coffee-home__card" href="/post/${guide.slug}/"><img src="/image/${guide.cover}" width="${guide.coverWidth}" height="${guide.coverHeight}" alt="${guide.shortTitle}" loading="lazy" decoding="async"><div class="maxlist-coffee-home__copy"><small>COFFEE MAP · 2026</small><h3>${guide.title}</h3><p>${guide.description}</p></div></a>`
    )
    .join("");
  const section = `<section id="coffee-guides" class="maxlist-coffee-home" aria-labelledby="coffee-guides-title"><div class="maxlist-coffee-home__inner"><h2 id="coffee-guides-title">咖啡地圖</h2><p class="maxlist-coffee-home__lead">從數千則公開評論裡，找到真正值得喝的一杯咖啡。</p><div class="maxlist-coffee-home__grid">${cards}</div></div></section>`;
  const container = $(".elementor-section-wrap").first();
  if (!container.length) throw new Error("Homepage Elementor container not found");
  container.append(section);
  await writeFile(file, $.html());
}

async function updateSidebar() {
  const file = path.join(REPO_ROOT, "components", "sidebar.html");
  const $ = load(await readFile(file, "utf8"), { decodeEntities: false });
  const tagList = $("#categories-2 ul").first();
  tagList.find(".cat-item-cafe-map").remove();
  const allPosts = tagList.find(".cat-item-220").first();
  allPosts.contents().last().replaceWith(" (180)\n");
  allPosts.after('<li class="cat-item cat-item-cafe-map"><a href="/category/%E5%92%96%E5%95%A1%E5%9C%B0%E5%9C%96/">咖啡地圖</a> (2)</li>');
  const categoryMenu = $("#menu-side-bar");
  categoryMenu.find(".menu-item-cafe-map").remove();
  categoryMenu.append('<li class="menu-item menu-item-type-custom menu-item-object-custom menu-item-cafe-map"><a href="/category/%E5%92%96%E5%95%A1%E5%9C%B0%E5%9C%96/">咖啡地圖</a></li>');
  await writeFile(file, $("body").html() ?? $.html());
}

for (const guide of guides) await buildGuide(guide);
const recentFirst = guides.slice().sort((left, right) => right.published.localeCompare(left.published));
await updateArchive(path.join(DOCS_ROOT, "2026", "index.html"), recentFirst);
await updateArchive(path.join(DOCS_ROOT, "category", "所有文章", "index.html"), recentFirst);
await createCoffeeCategory();
await updateHomepage();
await updateSidebar();

console.log("Imported two complete coffee guides without changing legacy domains or redirects.");
