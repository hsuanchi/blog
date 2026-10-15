import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOCS = path.join(ROOT, 'docs');
if (!process.env.NETSUITE_LANGUAGE_SOURCE) throw new Error('Set NETSUITE_LANGUAGE_SOURCE to tutorial 002.');
const SOURCE = path.resolve(process.env.NETSUITE_LANGUAGE_SOURCE);
const SLUG = 'netsuite-language-settings';
const POST_ID = '11004';
const TITLE = '【NetSuite 教學 02】切換介面語言：繁體中文與英文設定';
const DESCRIPTION = '從設定偏好切換 NetSuite 繁體中文與英文介面，附中英文路徑、操作示意圖、多語言功能檢查，以及介面與說明中心語言的差別。';
const DATE = '2026-10-15T16:25:00+08:00';
const PERMALINK = `/post/${SLUG}/`;
const CANONICAL = `https://www.maxlist.xyz${PERMALINK}`;
const CATEGORY = '/category/netsuite/';
const COVER = `/image/${SLUG}/cover.jpg`;
const VERSION = '20261015-1';
const AUTHOR_ID = 'https://www.maxlist.xyz/#/schema/person/e66635bb66154fb8e67d40281a5de5aa';
const ORIGINAL_FILE = path.join(DOCS, 'post/netsuite-report-permissions/index.html');
const artwork = JSON.parse(await readFile(path.join(ROOT, 'artwork', SLUG, 'exports.json'), 'utf8'));

function meta($, selector, attrs) {
  const existing = $(selector).first();
  (existing.length ? existing : $('<meta>').appendTo('head')).attr(attrs);
}
function description($, value) {
  meta($, 'meta[name="description"]', { name: 'description', content: value });
  meta($, 'meta[property="og:description"]', { property: 'og:description', content: value });
}
function styles($, prefix) {
  $('link[href*="posts/netsuite.css"]').remove();
  $('head').append(`<link rel="stylesheet" href="${prefix}assets/css/posts/netsuite.css?v=20261015-6">`);
}
async function save(file, $) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, $.html());
}
function figure(file, width, height, alt, caption) {
  const asset = `/image/${SLUG}/${file}?v=${file === 'language-preferences.jpg' ? '20261015-3' : VERSION}`;
  return `<figure class="netsuite-figure"><a href="${asset}" target="_blank" rel="noopener noreferrer" aria-label="放大圖解：${alt}（另開分頁）"><img src="../..${asset}" width="${width}" height="${height}" alt="${alt}" loading="lazy" decoding="async"></a><figcaption>${caption}<span>點圖放大 ↗</span></figcaption></figure>`;
}
function navigation(previous) {
  return `<nav class="netsuite-series-end netsuite-series-navigation" aria-label="NetSuite 教學篇章導覽">${previous ? '<a href="/post/netsuite-report-permissions/"><small>上一篇 · 教學 01</small>報表權限設定：對象與存取</a>' : '<a href="/category/netsuite/"><small>Oracle NetSuite 教學</small>瀏覽全部教學</a>'}${previous ? '<a href="/category/netsuite/"><small>Oracle NetSuite 教學</small>瀏覽全部教學</a>' : `<a href="${PERMALINK}"><small>下一篇 · 教學 02</small>切換介面語言：繁體中文與英文設定</a>`}</nav>`;
}

const $source = load(await readFile(path.join(SOURCE, 'index.html'), 'utf8'));
const $content = load(`<div class="entry-content">${$source('article').html().replace('下圖的橘色標記 1', '上方介面圖的步驟標記 1')}</div>`, null, false);
$content('a[href="../index.html"]').closest('p').remove();
await mkdir(path.join(DOCS, 'image', SLUG), { recursive: true });
const preferences = artwork['language-preferences'];
$content('.figure-link').each((_i, element) => {
  const link = $content(element);
  const paragraph = link.closest('p');
  const caption = paragraph.next('.caption');
  paragraph.remove();
  caption.remove();
});
$content('h3').each((_i, el) => $content(el).text($content(el).text().replace(/^(步驟[一二三四]) /, '$1：')));
$content('#section-1').nextUntil('h2').last().after(figure(preferences.file, preferences.width, preferences.height, 'NetSuite 語言設定介面示意：1 首頁圖示、2 一般分頁、3 本地化語言欄位', '圖一　操作介面示意：依序找到 1 首頁圖示、2 一般分頁、3 語言欄位，選擇後按「儲存」。實際欄位與排列以系統畫面為準。'));
$content('table').wrap('<div class="netsuite-table-scroll"></div>');
$content('#section-8').next('p').after('<p class="netsuite-key-point"><strong>介面有繁體中文，不代表說明中心也提供繁體中文。</strong> Oracle 文件目前列出的說明中心中文選項是簡體中文，請以實際下拉選單為準。<a href="https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N479109.html">Oracle 說明中心語言清單</a></p>');
const faq = [
  ['改語言會影響其他使用者嗎？', '不會。這是目前使用者的個人偏好，不會更改其他人的介面語言。'],
  ['英文介面要選哪個選項，才能切換成繁體中文？', '選擇 <strong>Chinese (Traditional)</strong>，再按 <strong>Save</strong>。簡體中文的選項則是 Chinese (Simplified)。'],
  ['為什麼找不到 Language 語言欄位？', '先請管理員確認帳戶已啟用 <strong>Multi-Language</strong> 功能。功能啟用後，使用者再回到自己的 Set Preferences 選擇個人語言。'],
  ['介面和說明中心會一起切換嗎？', '兩者可以分開選擇。Language 控制操作介面，Language of the Help Center 控制說明中心；兩個欄位提供的語言選項不完全相同。']
];
$content('.entry-content').append(`<h2 id="section-9">常見問題</h2><div class="netsuite-faq">${faq.map(([question, answer]) => `<details><summary>${question}</summary><div class="netsuite-faq__answer"><p>${answer}</p></div></details>`).join('')}</div>${navigation(true)}`);
const headings = $content('h2,h3[id]').toArray();
let toc = '';
for (let index = 0; index < headings.length; index++) {
  const heading = $content(headings[index]);
  if (headings[index].name !== 'h2') continue;
  if (toc) toc += '</li>';
  toc += `<li><a href="#${heading.attr('id')}">${heading.text()}</a>`;
  const children = [];
  while (headings[index + 1]?.name === 'h3') {
    const child = $content(headings[++index]);
    children.push(`<li><a href="#${child.attr('id')}">${child.text()}</a></li>`);
  }
  if (children.length) toc += `<ol>${children.join('')}</ol>`;
}
toc += '</li>';
$content('.entry-content > p').first().after(`<p class="netsuite-scope">適用：NetSuite 網頁版個人介面。語言選項須由管理員先啟用 Multi-Language 功能。</p><details class="netsuite-toc" open><summary>文章目錄</summary><ol>${toc}</ol></details>`);
$content('.entry-content').prepend(`<p class="netsuite-series"><a href="${CATEGORY}">Oracle NetSuite 教學</a> ／ 第 02 篇 · 個人設定</p>`);

const $ = load(await readFile(ORIGINAL_FILE, 'utf8'));
$('title').text(`${TITLE} - Max行銷誌`);
$('link[rel="canonical"]').attr('href', CANONICAL);
description($, DESCRIPTION);
for (const [key, value] of Object.entries({ title: TITLE, url: CANONICAL, image: `https://www.maxlist.xyz${COVER}`, 'image:alt': 'NetSuite 教學 02：切換介面語言' })) meta($, `meta[property="og:${key}"]`, { property: `og:${key}`, content: value });
for (const [key, value] of Object.entries({ title: TITLE, description: DESCRIPTION, image: `https://www.maxlist.xyz${COVER}`, 'image:alt': 'NetSuite 教學 02：切換介面語言' })) meta($, `meta[name="twitter:${key}"]`, { name: `twitter:${key}`, content: value });
for (const key of ['published_time', 'modified_time']) meta($, `meta[property="article:${key}"]`, { property: `article:${key}`, content: DATE });
styles($, '../../');
$('body').removeClass('postid-11003').addClass(`postid-${POST_ID}`);
const article = $('main article').first();
article.attr({ id: `post-${POST_ID}`, class: `post-${POST_ID} post type-post status-publish format-standard has-post-thumbnail hentry category-220 category-netsuite` });
article.find('h1').text('【NetSuite 教學 02】切換介面語言');
article.find('.entry-meta').html(`<span class="byline"><span class="author vcard">By <a class="url fn n" href="/post/author/">Max</a></span></span><span class="cat-links"><a href="${CATEGORY}" rel="category tag">NetSuite 教學</a></span><span class="posted-on"> 最後更新時間 <a href="${PERMALINK}" rel="bookmark"><time class="entry-date updated-time" datetime="${DATE}">2026 年 10 月 15 日</time></a></span>`);
article.find('.entry-thumb').html(`<img src="../..${COVER}?v=${VERSION}" width="1200" height="630" alt="NetSuite 教學 02：切換介面語言，繁體中文與英文設定" decoding="async" fetchpriority="high">`);
article.find('.entry-content').html($content('.entry-content').html());
const graph = [
  { '@type': 'Article', '@id': `${CANONICAL}#article`, headline: TITLE, description: DESCRIPTION, datePublished: DATE, dateModified: DATE, author: { '@id': AUTHOR_ID, name: 'Max' }, publisher: { '@id': AUTHOR_ID }, mainEntityOfPage: { '@id': CANONICAL }, image: `https://www.maxlist.xyz${COVER}`, articleSection: ['NetSuite 教學'], inLanguage: 'zh-TW' },
  { '@type': 'WebPage', '@id': CANONICAL, url: CANONICAL, name: `${TITLE} - Max行銷誌`, description: DESCRIPTION, datePublished: DATE, dateModified: DATE, breadcrumb: { '@id': `${CANONICAL}#breadcrumb` }, inLanguage: 'zh-TW' },
  { '@type': 'BreadcrumbList', '@id': `${CANONICAL}#breadcrumb`, itemListElement: [{ '@type': 'ListItem', position: 1, name: '首頁', item: 'https://www.maxlist.xyz/' }, { '@type': 'ListItem', position: 2, name: 'NetSuite 教學', item: `https://www.maxlist.xyz${CATEGORY}` }, { '@type': 'ListItem', position: 3, name: TITLE }] },
  { '@type': 'Person', '@id': AUTHOR_ID, name: 'Max', url: 'https://www.maxlist.xyz/post/author/' }
];
$('script[type="application/ld+json"]').html(JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }));
await save(path.join(DOCS, 'post', SLUG, 'index.html'), $);

function archiveCard($archive) {
  const card = $archive('.posts-layout article').first().clone();
  card.attr({ id: `post-${POST_ID}`, class: `post-${POST_ID} post type-post status-publish format-standard has-post-thumbnail hentry category-220 category-netsuite netsuite-card post-align-center post-vertical-align-middle col-lg-4 col-md-4` });
  card.find('.entry-thumb').html(`<a href="${PERMALINK}" title="${TITLE}"><img src="${COVER}?v=${VERSION}" width="1200" height="630" alt="NetSuite 教學 02：切換介面語言" loading="lazy" decoding="async"></a>`);
  card.find('h2.entry-title').html(`<a href="${PERMALINK}" rel="bookmark">${TITLE}</a>`);
  card.find('time.entry-date').attr('datetime', DATE).text('2026 年 10 月 15 日').closest('a').attr('href', PERMALINK);
  return card.prop('outerHTML');
}
for (const [relative, summary] of [
  ['2026/index.html', '2026 年 Max行銷誌文章彙整，共 5 篇。'],
  ['category/所有文章/index.html', 'Max行銷誌全部 182 篇文章，涵蓋行銷、數據分析、Python、資料工程、咖啡地圖與 NetSuite 教學。'],
  ['category/netsuite/index.html', 'Oracle NetSuite 操作指南與設定教學，從報表分享與角色權限，到繁體中文、英文介面的語言偏好設定。']
]) {
  const file = path.join(DOCS, relative);
  const $archive = load(await readFile(file, 'utf8'));
  $archive(`#post-${POST_ID}`).remove();
  $archive('.posts-layout > .row').prepend(archiveCard($archive));
  description($archive, summary);
  styles($archive, relative.startsWith('2026/') ? '../' : '../../');
  if (relative === 'category/netsuite/index.html') {
    $archive('.netsuite-category-intro').text('從日常操作開始，一次釐清一個 NetSuite 設定。依序閱讀報表權限與介面語言教學，或直接選擇需要的主題。');
    const items = $archive('.posts-layout h2 a').toArray().map((el, index) => ({ '@type': 'ListItem', position: index + 1, url: new URL($archive(el).attr('href'), 'https://www.maxlist.xyz').href, name: $archive(el).text() }));
    $archive('script[type="application/ld+json"]').html(JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'NetSuite 教學', url: `https://www.maxlist.xyz${CATEGORY}`, inLanguage: 'zh-TW', mainEntity: { '@type': 'ItemList', itemListElement: items } }));
  }
  await save(file, $archive);
}

const $original = load(await readFile(ORIGINAL_FILE, 'utf8'));
$original('.entry-content > .netsuite-series-end').remove();
$original('.entry-content').append(navigation(false));
styles($original, '../../');
await save(ORIGINAL_FILE, $original);

const sidebarFile = path.join(ROOT, 'components/sidebar.html');
const $sidebar = load(await readFile(sidebarFile, 'utf8'));
$sidebar('#categories-2 .cat-item-220').contents().last().replaceWith(' (182)\n');
$sidebar('#categories-2 .cat-item-netsuite').html(`<a href="${CATEGORY}">NetSuite 教學</a> (2)`);
await writeFile(sidebarFile, `${$sidebar('body').html().trim()}\n`);

const homepageFile = path.join(DOCS, 'index.html');
const $homepage = load(await readFile(homepageFile, 'utf8'));
$homepage(`#netsuite-guides [data-netsuite-post="${POST_ID}"]`).remove();
const homeCard = `<div class="maxlist-netsuite-home__card" data-netsuite-post="${POST_ID}"><a href="${PERMALINK}"><img src="${COVER}?v=${VERSION}" width="1200" height="630" alt="NetSuite 教學 02：切換介面語言" loading="lazy" decoding="async"></a><div><small>第 02 篇 ／ 個人設定</small><h3><a href="${PERMALINK}">切換介面語言：繁體中文與英文設定</a></h3><p>${DESCRIPTION}</p><a href="${CATEGORY}">瀏覽 NetSuite 教學系列 →</a></div></div>`;
$homepage('#netsuite-guides .maxlist-netsuite-home__card').first().before(homeCard);
styles($homepage, '');
await save(homepageFile, $homepage);
console.log('Prepared tutorial 02 with HTML-rendered illustrations, FAQ, series navigation, and local listings. Not published.');
