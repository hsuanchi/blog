import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { cover, comparison, example, sharingOptions, reportBuilder } from './netsuite-visuals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const directory = path.join(ROOT, 'artwork/netsuite-report-permissions');
const artboards = [
  ['cover', '文章封面', cover()],
  ['audience-vs-access', '對象與存取', comparison],
  ['audience-access-example', 'A、B 設定範例', example],
  ['audience-settings', '對象分頁', reportBuilder('audience')],
  ['roles-and-departments', '三種分享方式', sharingOptions],
  ['access-settings', '存取分頁', reportBuilder('access')]
];
await mkdir(directory, { recursive: true });
for (const [id, label, html] of artboards) {
  await writeFile(path.join(directory, `${id}.html`), `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${label} · NetSuite 教學圖稿</title><link rel="stylesheet" href="../../docs/assets/css/posts/netsuite.css?v=20261015-4"><link rel="stylesheet" href="artwork.css?v=20261015-5"></head><body class="artwork-solo"><section id="${id}" class="artboard" aria-label="${label}">${html}</section></body></html>\n`);
}
await writeFile(path.join(directory, 'index.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>NetSuite 教學 01 · HTML 圖稿</title><link rel="stylesheet" href="../../docs/assets/css/posts/netsuite.css?v=20261015-4"><link rel="stylesheet" href="artwork.css?v=20261015-5"></head>
<body><header class="artwork-intro"><h1>NetSuite 教學 01 · HTML 圖稿</h1><p>1200 px 圖稿，用於文章插圖與分享封面。</p><nav>${artboards.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}</nav></header>
${artboards.map(([id, label, html]) => `<section id="${id}" class="artboard" aria-label="${label}">${html}</section>`).join('\n')}
</body></html>\n`);
console.log('Prepared six editable HTML artboards in artwork/netsuite-report-permissions/.');
