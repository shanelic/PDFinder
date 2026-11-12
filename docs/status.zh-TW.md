# PDFinder 目前進度

更新：2026-11-12 UTC。由 Jarvis 記錄；本頁區分已驗證成果、歷史證據與待完成事項。

## 產品目標與順序

從手機發出請求，由雲端取得指定郵件的文字型 PDF 附件、使用已授權的密碼參照解密搜尋，提供頁碼及郵件／附件來源。希望密碼只需安全輸入一次，不依賴使用者電腦開機。Office、壓縮檔與掃描／圖片 PDF 的 OCR 不在目前範圍。

依序完成：可重建來源基準 → 小規模實際雲端功能與 CPU 驗證 → 針對限制優化 → 正式安全與附件／密碼整合 → 經確認的真實資料驗收與發布。Cloudflare Free 是候選，不是已證明適用的平台；不為測試升級或產生未同意費用。

## 階段 1：已完成本機基準

- GitHub 基準 commit：`74c1b95e29151783a5edaa0172ff17ef10353387`。
- 基準 tree：`9b19150ba35769efea8f237fa4505baea3825415`。與實際測試的本機 tree 相同，30 個 blob 的路徑、mode、SHA 全數逐項一致；不是只比對文件聲明。
- 29 個來源 manifest 項目、7 份合成 PDF 的長度／SHA-256／預期頁面驗證通過。
- `npm run verify`：302/302 介面檢查、32/32 來源解析器檢查，建置成功。
- 同一組 32 項對實際建置檔再次通過。這是封裝驗證，不新增 32 種獨立情境。
- 兩個 parser 執行均觀察到 0 次 global fetch；不代表平台防火牆或任意程式都無法外連。
- Node.js 24.22.1、既有 esbuild 0.28.0。本輪沒有重新執行 `npm ci`，因此不宣稱測過乾淨環境安裝。
- 建置檔：3,740,357 bytes，gzip 800,421 bytes；SHA-256：`6842618014df5b10d24bb618acbfb3b2556066e2074cf076be621f664797bf79`。不得與歷史建置檔 `3a31032a…` 的紀錄混用。

機器可讀摘要：[stage1-20261112.json](verification/stage1-20261112.json)。本輪保留 PDF.js modern-build 與 npm 既有設定警告，沒有為消除警告更改網路設定。

建置產物驗證可在 `npm run build` 後執行：

```sh
node --input-type=module -e 'import worker from "./dist/worker.mjs"; import {runActualWorkerSuite} from "./tests/interface-suite.mjs"; console.log(JSON.stringify(await runActualWorkerSuite(worker), null, 2));'
```

## 階段 2：未開始新雲端試跑

### 獨立推進：本機附件輸入與引用

已新增 [合成附件 API](synthetic-attachment-api.zh-TW.md)：實際 Request 傳入原始 PDF bytes，再由真正 PDF.js 解密、查詢並產生頁碼／來源引用。7 個 fixture × 2 個 provider 標記共 14 條正規化假信箱路徑通過；另驗證錯誤／移除／恢復 profile、篡改、來源核對、Unicode 範圍與取消。這不是 Gmail／iCloud 真實回傳 schema 或正式帳號授權，未讀取真實郵件。

這項工作不依賴被擋的雲端通道，也未改變既有 benchmark 部署入口。詳細本輪數量及產物見 [本機 API 驗證紀錄](verification/attachment-api-20261112.json)。

接續新增 [provider adapter](provider-adapters.zh-TW.md)：依現行工具契約產生 Gmail／iCloud 精確取件參數，注入 fake invoker、decoder 與原…1447 tokens truncated…u9650制的說明，不代表目前帳號／執行環境已取得額外權限。
