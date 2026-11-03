# 文章通用規範

以下規則適用本專案所有新增、修改及建置的文章、HTML 預覽與共用元件。

- **所有外部網頁連結一律另開新分頁，並加上 `rel="noopener noreferrer"`。** 不可省略 `noreferrer`；若原本已有 `nofollow`、`sponsored` 等值，須一併保留。
- 範例：`<a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">參考文件</a>`。
- 外部網頁連結包含 `http:`、`https:` 及 `//` 開頭且指向站外的網址。站內文章連結、頁內錨點、`mailto:` 與 `tel:` 不套用此規則；NetSuite 圖片放大的另開分頁規則仍照系列規範執行。
- 完成文章後執行 `npm run finalize` 與 `npm run validate`，由建置補齊外部連結屬性，並檢查是否有遺漏。
- **所有文章文末須保留「其他延伸閱讀」及作者介紹。** 延伸閱讀使用與主題相關、實際存在的站內文章；作者介紹沿用共用作者版位，不可因省略上一篇／下一篇導覽而消失。`finalize` 會在缺少可用作者版位時補上 `components/article-author.html`，`validate` 會檢查作者區塊是否有顯示位置。

# NetSuite 教學系列

新增或修改本專案的 NetSuite 教學文章、首圖、內文圖解、FAQ 或系列入口前，先閱讀並遵循 [NETSUITE_GUIDE_RULES.md](NETSUITE_GUIDE_RULES.md)。此規範僅適用 NetSuite 教學系列；使用者當次最新指示優先。
