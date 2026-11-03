// Rebuild only the five covers shown in the November 2026 visual review.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const covers = [
  { slug: 'chrome-extension-import', file: 'chrome-extension-import/cover.jpg', topic: '【 Chrome 擴充套件 】', title: '手動匯入教學', size: 84 },
  { slug: 'netsuite-report-permissions', file: 'netsuite-report-permissions/cover.jpg', topic: '【 NetSuite 教學 01 】', title: '報表權限設定', size: 84, background: 'netsuite-report-permissions/audience-settings.jpg', y: -36, height: 795 },
  { slug: 'netsuite-language-settings', file: 'netsuite-language-settings/cover.jpg', topic: '【 NetSuite 教學 02 】', title: '切換介面語言', size: 84, background: 'netsuite-language-settings/language-preferences.jpg', y: -60, height: 1150 },
  { slug: 'bts-thong-lor-station-cafes', file: 'bts-thong-lor-cafes-cover.png', topic: '【 曼谷 Thong Lor 】', title: '咖啡地圖', size: 88, background: 'bts-thong-lor-cafes-hero.jpg' },
  { slug: 'miyako-cafes', file: 'miyako-cafes-cover.jpg', topic: '【 宮古島 】', title: '咖啡地圖', size: 94, background: 'miyako-cafes-hero.jpg' },
];

function chromeBackground() {
  let scene = `<rect width="1200" height="675" fill="#f5f6f7"/>
  <rect width="1200" height="58" fill="#e3e7ec"/>
  <circle cx="28" cy="28" r="8" fill="#e9908a"/><circle cx="54" cy="28" r="8" fill="#e8c270"/><circle cx="80" cy="28" r="8" fill="#a3c3a1"/>
  <rect x="170" y="13" width="780" height="33" rx="16" fill="#ffffff"/>
  <text x="200" y="37" font-size="20" fill="#637080">chrome://extensions/</text>
  <rect y="58" width="1200" height="88" fill="#ffffff"/>
  <text x="48" y="115" font-size="32" font-weight="500" fill="#343a43">擴充功能</text>
  <text x="930" y="111" font-size="23" fill="#465264">開發人員模式</text>
  <rect x="1102" y="84" width="58" height="29" rx="15" fill="#5475ac"/>
  <circle cx="1144" cy="98" r="11" fill="#ffffff"/>
  <rect x="44" y="171" width="200" height="47" rx="7" fill="#ffffff" stroke="#bec8d3"/>
  <text x="144" y="203" font-size="22" text-anchor="middle" fill="#426cb0">載入未封裝項目</text>
  <rect x="266" y="171" width="165" height="47" rx="7" fill="#ffffff" stroke="#bec8d3"/>
  <text x="348" y="203" font-size="22" text-anchor="middle" fill="#426cb0">封裝擴充功能</text>`;
  for (const [x, y] of [[44, 250], [620, 250], [44, 461], [620, 461]]) {
    scene += `<rect x="${x}" y="${y}" width="535" height="182" rx="12" fill="#ffffff" stroke="#ced5df"/>
    <rect x="${x + 24}" y="${y + 24}" width="49" height="49" rx="9" fill="#ccd7e6"/>
    <text x="${x + 95}" y="${y + 49}" font-size="23" font-weight="500" fill="#435369">Chrome 擴充套件</text>
    <rect x="${x + 95}" y="${y + 71}" width="360" height="10" rx="5" fill="#e4e8ec"/>
    <rect x="${x + 95}" y="${y + 94}" width="260" height="10" rx="5" fill="#edf0f3"/>
    <text x="${x + 25}" y="${y + 153}" font-size="19" fill="#758497">詳細資料　　移除</text>
    <rect x="${x + 445}" y="${y + 131}" width="50" height="25" rx="13" fill="#93aaca"/>`;
  }
  return scene;
}

const versions = new Map();
const binary = path.join(root, '.cache/brand-cover-renderer');
await mkdir(path.dirname(binary), { recursive: true });
execFileSync('swiftc', [path.join(root, 'scripts/render-brand-cover.swift'), '-o', binary]);
for (const cover of covers) {
  const directory = path.join(root, 'artwork', cover.slug);
  await mkdir(directory, { recursive: true });
  const background = cover.background
    ? `<image href="../../docs/image/${cover.background}" x="0" y="${cover.y ?? 0}" width="1200" height="${cover.height ?? 675}" preserveAspectRatio="xMidYMid slice"/>`
    : chromeBackground();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-labelledby="title desc">
  <title id="title">${escape(cover.topic + ' ' + cover.title)}</title>
  <desc id="desc">沿用 Max行銷誌既有封面：主題背景、紅色遮罩、置中白字與右下角 M 品牌標記。</desc>
  ${background}
  <rect width="1200" height="675" fill="#934f4c" opacity="0.86"/>
  <text x="600" y="278" font-family="PingFang TC, sans-serif" font-size="${cover.size}" font-weight="500" fill="#ffffff" text-anchor="middle">${escape(cover.topic)}</text>
  <text x="600" y="391" font-family="PingFang TC, sans-serif" font-size="94" font-weight="500" fill="#ffffff" text-anchor="middle">${escape(cover.title)}</text>
  <text x="600" y="455" font-family="PingFang TC, sans-serif" font-size="32" fill="#ff8580" text-anchor="middle">Max行銷誌</text>
  <rect x="1134" y="609" width="46" height="46" fill="#ff8580"/>
  <text x="1157" y="645" font-family="PingFang TC, sans-serif" font-size="34" font-weight="600" fill="#934f4c" text-anchor="middle">M</text>
</svg>
`;
  await writeFile(path.join(directory, 'cover.svg'), svg);
  await writeFile(path.join(directory, 'cover.html'), `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(cover.topic + ' ' + cover.title)} · 封面圖稿</title><style>html,body{margin:0;background:#fff}img{display:block;width:1200px;height:675px;max-width:100%;object-fit:contain;object-position:top left}@media(max-width:1200px){img{height:auto}}</style></head><body><img src="cover.svg" width="1200" height="675" alt="${escape(cover.topic + ' ' + cover.title)}"></body></html>\n`);
  if (cover.slug === 'netsuite-report-permissions') {
    const gallery = path.join(directory, 'index.html');
    const html = await readFile(gallery, 'utf8');
    await writeFile(gallery, html.replace(/(<section\b[^>]*id="cover"[^>]*>)[\s\S]*?(<\/section>)/,
      `$1<img src="cover.svg" width="1200" height="675" alt="${escape(cover.topic + ' ' + cover.title)}">$2`));
  }
  execFileSync(binary, [path.join(directory, 'cover.svg'), path.join(root, 'docs/image', cover.file)], { stdio: 'inherit' });
  versions.set(cover.file, `brand-${createHash('sha256').update(await readFile(path.join(root, 'docs/image', cover.file))).digest('hex').slice(0, 12)}`);
  if (cover.slug.startsWith('netsuite-')) {
    const manifestFile = path.join(directory, 'exports.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.cover = { file: 'cover.jpg', width: 1200, height: 675 };
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
}

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(file));
    else if (file.endsWith('.html')) result.push(file);
  }
  return result;
}

let changed = 0;
for (const file of await filesBelow(path.join(root, 'docs'))) {
  const before = await readFile(file, 'utf8');
  let after = before;
  for (const cover of covers) {
    const reference = `image/${cover.file}`;
    if (!after.includes(reference)) continue;
    const pattern = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    after = after.replace(new RegExp(`${pattern}(?:\\?v=[a-zA-Z0-9-]+)?`, 'g'), `${reference}?v=${versions.get(cover.file)}`);
    after = after.replace(/<img\b[^>]*>/gi, (tag) => tag.includes(reference)
      ? tag.replace(/\bwidth="\d+"/, 'width="1200"').replace(/\bheight="\d+"/, 'height="675"') : tag);
    if (file === path.join(root, 'docs/post', cover.slug, 'index.html')) {
      after = after.replace(/(<meta\s+property="og:image:width"\s+content=")\d+("[^>]*>)/g, (_, start, end) => `${start}1200${end}`)
        .replace(/(<meta\s+property="og:image:height"\s+content=")\d+("[^>]*>)/g, (_, start, end) => `${start}675${end}`);
      after = after.replace(/(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, start, json, end) => {
        const schema = JSON.parse(json);
        function update(value) {
          if (!value || typeof value !== 'object') return;
          if ([value.url, value.contentUrl].some((url) => typeof url === 'string' && url.includes(reference))) {
            value.width = 1200; value.height = 675;
          }
          for (const child of Object.values(value)) update(child);
        }
        update(schema);
        return start + JSON.stringify(schema) + end;
      });
    }
  }
  if (after !== before) { await writeFile(file, after); changed += 1; }
}
console.log(`Updated five cover masters and ${changed} pages with image dimensions and cache versions.`);
