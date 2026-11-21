import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { load } from 'cheerio';

const root = path.resolve(import.meta.dirname, '..');
const docs = path.join(root, 'docs');
const slug = 'claude-shopline-mcp';
const id = '11011';
const title = '【Claude 教學】串接 SHOPLINE MCP：從權限設定到查詢訂單';
const description = '用 Claude 串接 SHOPLINE MCP，從 OpenAPI 資格、管理員 MCP 權限、遠端連接器網址與 OAuth 設定，到商店授權、訂單及庫存查詢，附操作示意圖、指令範例與常見問題。';
const date = '2026-11-21T00:00:00+08:00';
const modified = '2026-11-21T13:21:40+08:00';
const dateText = '2026 年 11 月 21 日';
const permalink = `/post/${slug}/`;
const canonical = `https://www.maxlist.xyz${permalink}`;
const authorId = 'https://www.maxlist.xyz/#/schema/person/e66635bb66154fb8e67d40281a5de5aa';
const artwork = path.join(root, 'artwork', slug);
await mkdir(artwork, { recursive: true });

// Keep the established cover layout; the background is an original schematic.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-labelledby="title desc">
<title id="title">Claude 串接 SHOPLINE MCP 教學</title>
<desc id="desc">Claude 與 SHOPLINE 連接器介面示意背景，搭配 Max行銷誌紅色遮罩、白色標題及右下角 M 標記。</desc>
<rect width="1200" height="675" fill="#f5f3ee"/>
<rect x="38" y="52" width="512" height="567" rx="18" fill="#fffdfa" stroke="#d6d2c7"/>
<text x="78" y="108" font-size="32" font-weight="500" fill="#34332e">Claude</text>
<text x="78" y="164" font-size="23" fill="#777267">Connectors</text>
<rect x="76" y="193" width="432" height="268" rx="12" fill="#ffffff" stroke="#d6d2c7"/>
<text x="104" y="239" font-size="24" font-weight="500" fill="#34332e">SHOPLINE</text>
<text x="104" y="281" font-size="16" fill="#777267">Remote MCP server URL</text>
<rect x="104" y="298" width="374" height="51" rx="7" fill="#f3f2ec"/>
<text x="123" y="331" font-size="20" fill="#777267">/mcp/on-demand</text>
<rect x="326" y="382" width="152" height="45" rx="7" fill="#34332e"/>
<text x="402" y="413" font-size="21" fill="#ffffff" text-anchor="middle">Connect</text>
<rect x="650" y="52" width="512" height="567" rx="18" fill="#ffffff" stroke="#d6dce3"/>
<rect x="650" y="52" width="512" height="77" rx="18" fill="#374151"/>
<text x="684" y="103" font-size="29" font-weight="500" fill="#ffffff">SHOPLINE ADMIN</text>
<text x="686" y="176" font-size="24" fill="#374151">API Auth</text>
<rect x="683" y="208" width="445" height="97" rx="10" fill="#eef3f6"/>
<text x="706" y="265" font-size="25" fill="#374151">MCP 權限</text>
<rect x="1026" y="237" width="69" height="34" rx="17" fill="#5a9464"/>
<circle cx="1077" cy="254" r="13" fill="#ffffff"/>
<rect x="687" y="340" width="435" height="12" rx="6" fill="#dce2e8"/>
<rect x="687" y="383" width="338" height="12" rx="6" fill="#e4e8ec"/>
<rect x="687" y="426" width="395" height="12" rx="6" fill="#e4e8ec"/>
<rect width="1200" height="675" fill="#934f4c" opacity="0.86"/>
<text x="600" y="278" font-family="PingFang TC, sans-serif" font-size="66" font-weight="500" fill="#ffffff" text-anchor="middle">【 Claude × SHOPLINE 】</text>
<text x="600" y="391" font-family="PingFang TC, sans-serif" font-size="94" font-weight="500" fill="#ffffff" text-anchor="middle">MCP 串接教學</text>
<text x="600" y="455" font-family="PingFang TC, sans-serif" font-size="32" fill="#ff8580" text-anchor="middle">Max行銷誌</text>
<rect x="1134" y="609" width="46" height="46" fill="#ff8580"/>
<text x="1157" y="645" font-family="PingFang TC, sans-serif" font-size="34" font-weight="600" fill="#934f4c" text-anchor="middle">M</text>
</svg>\n`;
await writeFile(path.join(artwork, 'cover.svg'), svg);
await writeFile(path.join(artwork, 'cover.html'), '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Claude × SHOPLINE MCP · 封面圖稿</title><style>body{margin:0}img{display:block;width:1200px;max-width:100%;height:auto}</style></head><body><img src="cover.svg" width="1200" height="675" alt="Claude 串接 SHOPLINE MCP 教學"></body></html>\n');
const renderer = path.join(root, '.cache', 'brand-cover-renderer');
try { await access(renderer); } catch {
  await mkdir(path.dirname(renderer), { recursive: true });
  execFileSync('swiftc', [path.join(root, 'scripts/render-brand-cover.swift'), '-o', renderer]);
}
const imagePath = path.join(docs, 'image', slug, 'cover.jpg');
execFileSync(renderer, [path.join(artwork, 'cover.svg'), imagePath], { stdio: 'inherit' });
const version = createHash('sha256').update(await readFile(imagePath)).digest('hex').slice(0, 12);
const cover = `/image/${slug}/cover.jpg?v=${version}`;
const cssVersion = createHash('sha256').update(await readFile(path.join(docs, 'assets/css/posts', `${slug}.css`))).digest('hex').slice(0, 12);
const scriptVersion = createHash('sha256').update(await readFile(path.join(docs, 'assets/js/posts', `${slug}.js`))).digest('hex').slice(0, 12);

function meta($, selector, attributes) {
  const existing = $(selector).first();
  (existing.length ? existing : $('<meta>').appendTo('head')).attr(attributes);
}
function setDescription($, value) {
  meta($, 'meta[name="description"]', { name: 'description', content: value });
  meta($, 'meta[property="og:description"]', { property: 'og:description', content: value });
}
async function save(relative, $) {
  const file = path.join(docs, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, $.html());
}

const $ = load(await readFile(path.join(docs, 'post/chrome-extension-import/index.html'), 'utf8'));
$('title').text(`${title} - Max行銷誌`);
$('link[rel="canonical"]').attr('href', canonical);
setDescription($, description);
for (const [name, value] of Object.entries({ title, description, url: canonical, type: 'article', image: `https://www.maxlist.xyz${cover}`, 'image:width': '1200', 'image:height': '675', 'image:alt': 'Claude 串接 SHOPLINE MCP：權限設定與商店授權' })) {
  meta($, `meta[property="og:${name}"]`, { property: `og:${name}`, content: value });
}
for (const [name, value] of Object.entries({ title, description, image: `https://www.maxlist.xyz${cover}`, 'image:alt': 'Claude 串接 SHOPLINE MCP 教學' })) {
  meta($, `meta[name="twitter:${name}"]`, { name: `twitter:${name}`, content: value });
}
for (const [name, value] of Object.entries({ published_time: date, modified_time: modified })) meta($, `meta[property="article:${name}"]`, { property: `article:${name}`, content: value });
meta($, 'meta[property="article:section"]', { property: 'article:section', content: '數據自動化' });
$('link[href*="posts/chrome-extension-import.css"]').remove();
$('head').append(`<link rel="stylesheet" href="../../assets/css/posts/claude-shopline-mcp.css?v=${cssVersion}">`);
$('script[src*="posts/claude-shopline-mcp.js"]').remove();
$('body').append(`<script src="../../assets/js/posts/claude-shopline-mcp.js?v=${scriptVersion}" defer></script>`);
$('body').removeClass('postid-11006').addClass(`postid-${id}`);
const article = $('main article').first();
article.attr({ id: `post-${id}`, class: `post-${id} post type-post status-publish format-standard has-post-thumbnail hentry category-220 category-708 tag-api`, 'data-category-names': JSON.stringify(['數據自動化']) });
article.find('h1').text(title);
article.find('.entry-meta').html(`<span class="byline"><span class="author vcard">Made with ☕ by <a class="url fn n" href="/post/author/">Max</a></span></span><span class="cat-links"><a href="/category/數據自動化/" rel="category tag">數據自動化</a></span><span class="posted-on">最後更新時間 <time class="entry-date updated-time" datetime="${modified}">${dateText}</time></span>`);
article.find('.entry-thumb').html(`<img src="../..${cover}" width="1200" height="675" alt="Claude 串接 SHOPLINE MCP：從權限設定到查詢訂單" decoding="async" fetchpriority="high">`);
const content = load(await readFile(path.join(root, 'scripts/content', `${slug}.html`), 'utf8'), null, false);
// Keep related-reading labels aligned with the actual local article titles.
for (const link of content('.sl-related a').toArray()) {
  const href = content(link).attr('href');
  const related = load(await readFile(path.join(docs, href.replace(/^\//, ''), 'index.html'), 'utf8'));
  content(link).text(related('h1').first().text());
}
article.find('.entry-content').attr('class', 'entry-content shopline-mcp-guide').html(content.html());
article.find('.entry-footer, .post-navigation').remove();
const faq = content('.sl-faq details').toArray().map((element) => ({ '@type': 'Question', name: content(element).find('summary').text(), acceptedAnswer: { '@type': 'Answer', text: content(element).find('div').text() } }));
const graph = [
  { '@type': 'Article', '@id': `${canonical}#article`, headline: title, description, datePublished: date, dateModified: modified, author: { '@id': authorId }, publisher: { '@id': authorId }, mainEntityOfPage: { '@id': canonical }, image: { '@type': 'ImageObject', url: `https://www.maxlist.xyz${cover}`, width: 1200, height: 675 }, articleSection: ['數據自動化'], inLanguage: 'zh-TW' },
  { '@type': 'WebPage', '@id': canonical, url: canonical, name: `${title} - Max行銷誌`, description, datePublished: date, dateModified: modified, breadcrumb: { '@id': `${canonical}#breadcrumb` }, inLanguage: 'zh-TW' },
  { '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumb`, itemListElement: [{ '@type': 'ListItem', position: 1, name: '首頁', item: 'https://www.maxlist.xyz/' }, { '@type': 'ListItem', position: 2, name: '數據自動化', item: 'https://www.maxlist.xyz/category/數據自動化/' }, { '@type': 'ListItem', position: 3, name: title }] },
  { '@type': 'Person', '@id': authorId, name: 'Max', url: 'https://www.maxlist.xyz/post/author/' },
  { '@type': 'FAQPage', '@id': `${canonical}#faq`, mainEntity: faq }
];
$('script[type="application/ld+json"]').html(JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }));
await save(`post/${slug}/index.html`, $);

const card = `<article id="post-${id}" class="post-${id} post type-post status-publish format-standard has-post-thumbnail hentry category-220 category-708 tag-api post-align-center post-vertical-align-middle col-lg-4 col-md-4"><div class="content-inner"><div class="entry-thumb"><a href="${permalink}" title="${title}"><img src="${cover}" width="1200" height="675" alt="Claude 串接 SHOPLINE MCP 教學" loading="lazy" decoding="async"></a></div><header class="entry-header"><h2 class="title-post entry-title"><a href="${permalink}" rel="bookmark">${title}</a></h2></header><div class="entry-meta below-excerpt delimiter-dot"><span class="posted-on">最後更新時間 <a href="${permalink}" rel="bookmark"><time class="entry-date updated-time" datetime="${modified}">${dateText}</time></a></span></div></div></article>`;
for (const relative of ['2026/index.html', 'category/所有文章/index.html', 'category/數據自動化/index.html', 'tag/api/index.html']) {
  const archive = load(await readFile(path.join(docs, relative), 'utf8'));
  archive(`#post-${id}`).remove();
  archive('.posts-layout > .row').prepend(card);
  if (relative === 'category/數據自動化/index.html') setDescription(archive, '數據自動化教學，包含 Claude 串接 SHOPLINE MCP、查詢電商訂單與庫存，以及定時擷取行銷數據。');
  await save(relative, archive);
}
const home = load(await readFile(path.join(docs, 'index.html'), 'utf8'));
home(`.mh-case-side a[href="${permalink}"]`).remove();
home('.mh-case-side').prepend(`<a class="mh-case" href="${permalink}"><img src="${cover}" alt="Claude 串接 SHOPLINE MCP 教學" loading="lazy" width="1200" height="675"><span><span class="mh-kicker">AI 工具 → 電商營運</span><span class="mh-case-title">用 Claude 串接 SHOPLINE MCP</span><span class="mh-case-desc">設定權限、授權商店，再用對話查詢訂單與庫存。</span></span></a>`);
await save('index.html', home);
console.log(`Built ${permalink} with cover, ${content('figure.sl-figure').length} HTML interface illustrations, five FAQs and four archive entries.`);
