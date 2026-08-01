# Max行銷誌靜態備份

這個 repository 將 `https://www.maxlist.xyz` 保存為不需要框架、模板引擎、資料庫或 WordPress 後台的純 HTML/CSS/JavaScript 網站。

## 結構

- `docs/`：GitHub Pages 的完整網站根目錄
- `components/`：Header、Sidebar、Footer 的可讀 HTML 原稿
- `docs/assets/js/components/`：所有頁面同步引入的共用元件
- `scripts/migrate.mjs`：公開頁面、REST 內容、媒體與版型快照
- `scripts/components.mjs`：抽出共用 Sydney 元件
- `scripts/validate.mjs`：檢查連結、檔案、元件、GA4/GTM 與 canonical
- `reports/`：可提交的移轉與驗證摘要（不含私密內容）

WordPress WXR、UpdraftPlus、SQL、原始 REST JSON 與未處理頁面會放在 repository 外的 `blog-migration-backup/YYYY-MM-DD/`，避免留言者 email、IP 或其他私密資料被提交到 GitHub。

## 重建快照

```bash
npm install
npm run migrate
npm run comments
npm run components
npm run finalize
npm run validate
npm run serve
```

本機預覽：`http://localhost:8080/`

## 新增文章

未來可直接複製既有文章目錄中的 `index.html`，保留共用元件的三個 `<script>`，再修改 `<head>` SEO 資訊與 `<article>` 內容。網站不需要建置步驟；提交 `docs/` 後就是可部署內容。

目前 repository 保持 private。確認內容、網址、圖片、核准留言與視覺比對完成後，才會另行切換 public、啟用 GitHub Pages 與設定正式網域。
