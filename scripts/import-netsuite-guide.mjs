import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';

// Run once to import the supplied tutorial. Later editorial changes live in docs/.
const ROOT = path.resolve(import.meta.dirname, '..');
const DOCS = path.join(ROOT, 'docs');
if (!process.env.NETSUITE_GUIDE_SOURCE) throw new Error('Set NETSUITE_GUIDE_SOURCE to the original guide directory.');
const SOURCE = path.resolve(process.env.NETSUITE_GUIDE_SOURCE);
const SLUG = 'netsuite-report-permissions';
const POST_ID = '11003';
const TITLE = '【NetSuite 教學 01】報表權限設定：搞懂「對象」與「存取」';
const DESCRIPTION = 'NetSuite 自訂報表怎麼分享？用圖解與五個步驟，分清楚「對象」與「存取」的差別，學會依角色、部門、員工或群組設定報表權限。';
const DATE = '2026-10-15T14:00:00+08:00';
const PERMALINK = `/post/${SLUG}/`;
const CATEGORY = '/category/netsuite/';
const CANONICAL = `https://www.maxlist.xyz${PERMALINK}`;
const COVER = `/image/${SLUG}/cover.jpg`;
const exports = JSON.parse(await readFile(path.join(ROOT, 'artwork', SLUG, 'exports.json'), 'utf8'));
const AUTHOR_ID = 'https://www.maxlist.xyz/#/schema/person/e66635bb66154fb8e67d40281a5de5aa';

function meta($, selector, attrs) {
  const el = $(selector).first();
  (el.length ? el : $('<meta>').appendTo('head')).attr(attrs);
}
function pageMeta($, title, description, url, type) {
  $('title').text(`${title} - Max行銷誌`);
  $('link[rel="canonical"]').attr('href', url);
  meta($, 'meta[name="description"]', { name: 'description', content: description });
  meta($, 'meta[name="robots"]', { name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' });
  for (const [key, value] of Object.entries({ title, description, url, type, image: `https://www.maxlist.xyz${COVER}`, 'image:width': '1200', 'image:height': '630', 'image:alt': 'NetSuite 教學 01：報表權限設定', 'site_name': 'Max行銷誌', locale: 'zh_TW' })) {
    meta($, `meta[property="og:${key}"]`, { property: `og:${key}`, content: value });
  }
  for (const [key, value] of Object.entries({ card: 'summary_large_image', title, description, image: `https://www.maxlist.xyz${COVER}`, 'image:alt': 'NetSuite 教學 01：報表權限設定' })) {
    meta($, `meta[name="twitter:${key}"]`, { name: `twitter:${key}`, content: value });
  }
  $('html').attr('lang', 'zh-TW');
}
function attachStyles($, relative) {
  $('link[href*="posts/netsuite.css"]').remove();
  $('head').append(`<link rel="stylesheet" href="${relative}assets/css/posts/netsuite.css?v=20261015-4">`);
}
async function save(file, $) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, $.html());
}

const $source = load(await readFile(path.join(SOURCE, 'index.html'), 'utf8'));
const $content = load(`<div class="entry-content">${$source('article').html()}</div>`, null, false);
$content('a[href="../index.html"]').closest('p').remove();
const illustrationMap = new Map([
  ['01-對象設定-已遮蔽.png', 'audience-settings'],
  ['02-角色與部門示意.svg', 'roles-and-departments'],
  ['03-存取設定-已遮蔽.png', 'access-settings'],
  ['05-對象與存取白話圖.svg', 'audience-vs-access'],
  ['06-名單設定範例.svg', 'audience-access-example']
]);
$content('.figure-link').each((_i, el) => {
  const link = $content(el);
  const sourceImage = link.find('img');
  const original = path.basename(sourceImage.attr('src'));
  const key = illustrationMap.get(original);
  const asset = exports[key];
  if (!asset) throw new Error(`Missing exported illustration: ${original}`);
  const visual = `<a href="/image/${SLUG}/${asset.file}?v=20261015-4" aria-label="放大圖解：${sourceImage.attr('alt')}"><img src="../../image/${SLUG}/${asset.file}?v=20261015-4" width="${asset.width}" height="${asset.height}" alt="${sourceImage.attr('alt')}" loading="lazy" decoding="async"></a>`;
  const p = link.parent('p');
  const caption = p.next('.caption');
  p.replaceWith(`<figure class="netsuite-figure">${visual}<figcaption>${caption.html()}${original.endsWith('.png') ? '（介面示意）' : ''}<span>點圖放大 ↗</span></figcaption></figure>`);
  caption.remove();
});
$content('p').filter((_i, el) => $content(el).text().includes('以下截圖以其中一種介面')).text('不同報表的產生器外觀可能略有差異；以下整理操作位置與設定欄位，實際畫面請以系統為準。');
$content('h3').each((_i, el) => {
  $content(el).text($content(el).text().replace(/^(步驟[一二三四五]) /, '$1：'));
});
const faqStart = $content('#section-9');
const faqItems = [];
faqStart.nextAll('p').each((_i, el) => {
  const p = $content(el);
  if (p.children().length === 1 && p.children('strong').length) {
    const question = p.text().replace('對象 為什麼', '對象，為什麼').replace('B 是不是', 'B，是不是').replace('搜尋 Workbook 或 Suitelet', '搜尋、Workbook 或 Suitelet');
    const answer = p.next('p');
    faqItems.push(`<details><summary>${question}</summary><div class="netsuite-faq__answer">${answer.prop('outerHTML')}</div></details>`);
    p.remove();
    answer.remove();
  }
});
faqStart.after(`<div class="netsuite-faq">${faqItems.join('')}</div>`);
$content('p').filter((_i, el) => $content(el).text().startsWith('所以，')).addClass('netsuite-key-point');
const headings = $content('h2,h3[id]').toArray();
let toc = '';
for (let i = 0; i < headings.length; i++) {
  const heading = $content(headings[i]);
  if (headings[i].name === 'h2') {
    if (toc) toc += '</li>';
    toc += `<li><a href="#${heading.attr('id')}">${heading.text()}</a>`;
    const children = [];
    while (headings[i + 1]?.name === 'h3') {
      const child = $content(headings[++i]);
      children.push(`<li><a href="#${child.attr('id')}">${child.text()}</a></li>`);
    }
    if (children.length) toc += `<ol>${children.join('')}</ol>`;
  }
}
toc += '</li>';
const scope = $content('.entry-content > p').eq(1);
scope.addClass('netsuite-scope');
scope.after(`<details class="netsuite-toc" open><summary>文章目錄</summary><ol>${toc}</ol></details>`);
$content('.entry-content').prepend(`<p class="netsuite-series"><a href="${CATEGORY}">Oracle NetSuite 教學</a> ／ 第 01 篇 · 報表與權限</p>`);
$content('.entry-content').append(`<p class="netsuite-series-end">這是 Oracle NetSuite 教學系列的第一篇。<br><a href="${CATEGORY}">瀏覽 NetSuite 教學系列 →</a></p>`);

const $ = load(await readFile(path.join(DOCS, 'post/shopee-crawler/index.html'), 'utf8'));
pageMeta($, TITLE, DESCRIPTION, CANONICAL, 'article');
attachStyles($, '../../');
for (const key of ['published_time', 'modified_time']) meta($, `meta[property="article:${key}"]`, { property: `article:${key}`, content: DATE });
meta($, 'meta[property="article:section"]', { property: 'article:section', content: 'NetSuite 教學' });
$('meta[property="article:tag"]').remove();
$('body').removeClass('postid-4411').addClass(`postid-${POST_ID} netsuite-post`);
const article = $('main article').first();
article.attr({ id: `post-${POST_ID}`, class: `post-${POST_ID} post type-post status-publish format-standard has-post-thumbnail hentry category-220 category-netsuite` });
article.find('h1.entry-title').text(TITLE);
article.find('.entry-meta').html(`<span class="byline"><span class="author vcard">By <a class="url fn n" href="/post/author/">Max</a></span></span><span class="cat-links"><a href="${CATEGORY}" rel="category tag">NetSuite 教學</a></span><span class="posted-on"> 最後更新時間 <a href="${PERMALINK}" rel="bookmark"><time class="entry-date updated-time" datetime="${DATE}">2026 年 10 月 15 日</time></a></span>`);
article.find('.entry-thumb').remove();
article.find('.entry-header').after(`<div class="entry-thumb"><img src="../..${COVER}?v=20261015-5" width="1200" height="630" alt="NetSuite 教學 01：報表權限設定，分清楚對象與存取" decoding="async" fetchpriority="high"></div>`);
article.find('.entry-content').html($content('.entry-content').html());
article.find('.entry-footer').html(`<span class="cat-links"><a href="${CATEGORY}" rel="category tag">NetSuite 教學</a></span>`);
$('#comments, .post-navigation').remove();
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
  card.find('.entry-thumb').remove();
  card.find('.content-inner').prepend(`<div class="entry-thumb"><a href="${PERMALINK}" title="${TITLE}"><img src="${COVER}?v=20261015-5" width="1200" height="630" alt="NetSuite 教學 01：報表權限設定" loading="lazy" decoding="async"></a></div>`);
  card.find('h2.entry-title').html(`<a href="${PERMALINK}" rel="bookmark">${TITLE}</a>`);
  card.find('time.entry-date').attr('datetime', DATE).text('2026 年 10 月 15 日').closest('a').attr('href', PERMALINK);
  return card.prop('outerHTML');
}
for (const [relative, description] of [
  ['2026/index.html', '2026 年 Max行銷誌文章彙整，共 4 篇。'],
  ['category/所有文章/index.html', 'Max行銷誌全部 181 篇文章，涵蓋行銷、數據分析、Python、資料工程、咖啡地圖與 NetSuite 教學。']
]) {
  const file = path.join(DOCS, relative);
  const $archive = load(await readFile(file, 'utf8'));
  attachStyles($archive, relative.startsWith('2026/') ? '../' : '../../');
  $archive(`#post-${POST_ID}`).remove();
  $archive('.posts-layout > .row').prepend(archiveCard($archive));
  meta($archive, 'meta[name="description"]', { name: 'description', content: description });
  meta($archive, 'meta[property="og:description"]', { property: 'og:description', content: description });
  await save(file, $archive);
}
const $category = load(await readFile(path.join(DOCS, 'category/所有文章/index.html'), 'utf8'));
pageMeta($category, 'NetSuite 教學', 'Oracle NetSuite 操作指南與設定教學。從報表分享與角色權限開始，透過圖解與實際操作步驟逐篇學習。', `https://www.maxlist.xyz${CATEGORY}`, 'website');
$category('body').removeClass().addClass('archive category category-netsuite');
attachStyles($category, '../../');
$category('h1.archive-title').text('NetSuite 教學');
$category('.page-header').append('<p class="netsuite-category-intro">從日常操作開始，一次釐清一個 NetSuite 設定。第一篇先談自訂報表的分享對象與存取權限。</p>');
$category('.posts-layout > .row').html(archiveCard($category));
$category('nav.navigation.pagination').remove();
$category('script[type="application/ld+json"]').html(JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'NetSuite 教學', url: `https://www.maxlist.xyz${CATEGORY}`, inLanguage: 'zh-TW', mainEntity: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, url: CANONICAL, name: TITLE }] } }));
await save(path.join(DOCS, 'category/netsuite/index.html'), $category);

const sidebarFile = path.join(ROOT, 'components/sidebar.html');
const $sidebar = load(await readFile(sidebarFile, 'utf8'));
$sidebar('.menu-item-netsuite, .cat-item-netsuite').remove();
$sidebar('#menu-side-bar').append(`<li class="menu-item menu-item-type-custom menu-item-object-custom menu-item-netsuite"><a href="${CATEGORY}">Oracle NetSuite 教學</a></li>`);
const allPosts = $sidebar('#categories-2 .cat-item-220');
allPosts.contents().last().replaceWith(' (181)\n');
allPosts.after(`<li class="cat-item cat-item-netsuite"><a href="${CATEGORY}">NetSuite 教學</a> (1)</li>`);
await writeFile(sidebarFile, `${$sidebar('body').html().trim()}\n`);

const homepageFile = path.join(DOCS, 'index.html');
const $homepage = load(await readFile(homepageFile, 'utf8'));
$homepage('#netsuite-guides').remove();
attachStyles($homepage, '');
const section = `<section id="netsuite-guides" class="maxlist-netsuite-home" aria-labelledby="netsuite-guides-title"><div class="maxlist-netsuite-home__inner"><h2 id="netsuite-guides-title">Oracle NetSuite 教學</h2><p>從日常操作開始，一次釐清一個設定。</p><div class="maxlist-netsuite-home__card"><a href="${PERMALINK}"><img src="${COVER}?v=20261015-5" width="1200" height="630" alt="NetSuite 教學 01：報表權限設定" loading="lazy" decoding="async"></a><div><small>第 01 篇 ／ 報表與權限</small><h3><a href="${PERMALINK}">報表權限設定：搞懂「對象」與「存取」</a></h3><p>${DESCRIPTION}</p><a href="${CATEGORY}">瀏覽 NetSuite 教學系列 →</a></div></div></div></section>`;
$homepage('#coffee-guides').before(section);
await save(homepageFile, $homepage);
console.log('Prepared the NetSuite guide with exported HTML artwork, collapsible FAQs, and matching series entries. Nothing has been published.');
