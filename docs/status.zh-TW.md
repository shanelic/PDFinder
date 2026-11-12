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

接續新增 [provider adapter](provider-adapters.zh-TW.md)：依現行工具契約產生 Gmail／iCloud 精確取件參數，注入 fake invoker、decoder 與原始檔串流，接回真實解析及引用。可拒絕錯誤 echo、預覽檔、大小及雜湊不符；未知附件 ID 保留 null。另唯讀核對一封既有合成測試信的 Gmail raw envelope 與唯一 PDF bytes，驗證摘要見 [provider 紀錄](verification/provider-adapters-20261112.json)。

已補 [JS MIME 唯一附件選取及 iCloud host 交接契約](mime-and-icloud-handoff.zh-TW.md)。Gmail 7 份合成 MIME 路徑接真實解析與引用；重用官方 raw 回應也選出同一份 2,476 bytes PDF。

最新 [iCloud 原檔觀察](icloud-observation-and-mail-fixture.zh-TW.md) 已透過精確 Message-ID header 找回原合成測試信，取得原始 PDF，與 Gmail bytes／SHA 一致；新增的窄 envelope decoder 也用該回應核對。舊附件的當次隨機假密碼紀錄無法恢復，因此 live 解密／引用仍未完成。已另備可重現 EML 與公開假密碼 manifest，本機端到端通過但未寄送，不能替代舊附件驗收。

已另補[同一合成附件的雙信箱驗收入口](synthetic-mail-verifier.zh-TW.md)，保留 host 實際 opaque ID 並統一核對解密、頁碼與引用。雙路徑真 PDF.js 本機解析成功，仍未寄送新信；只有合成 envelope，尚非 live 端到端。

另已提供[本機單份文件搜尋候選](document-processing-contract.zh-TW.md)，以新生成合成 PDF 驗證大小／頁數／文字限制及失敗分類。一般文件不使用固定 fixture oracle，因此仍明示擷取完整性未知；未發布或處理真實附件。

單文件功能已接上[精確取件到引用的 host 橋接](selected-mail-search.zh-TW.md)，包含首次取件未知 SHA 的明確語意。本機端到端可重跑；目前下一個關鍵進度仍需寄信許可及正式雲端通道，不以更多重複測試代替 live 驗收。

### 正式雲端呼叫仍待確認

已知阻礙是呼叫通道，不是已證明的 PDF 缺陷或 CPU 超限。先前 MCP 主機拒絕直接呼叫測試 Worker，沒有取得可採用的解析回應或每請求 CPU。缺少量測不能寫成 CPU 為 0。

Cloudflare MCP 官方契約限制 execute 的外連目標為 Cloudflare API；可管理 Worker 不代表可透過同一工具任意呼叫 Worker 網址。切換工具模式不會授予新的目的地權限。不可用代理、換域名或另一執行器規避拒絕。

正式可行路徑仍待確認：

1. 平台提供並明確授權可呼叫該測試 Worker 的正式通道；或
2. 經使用者同意，由使用者自己的裝置執行一次手動合成測試，保留可驗證回應，再以管理 API 讀取平台彙總。

官方雲端環境文件支援擁有者設定指定允許網域，但尚未證明該設定介面適用於目前受管理的執行環境。這不是多索取一個 Cloudflare token 就能解決的問題。也尚未驗證手機可用的完整手動流程，因此不能把它寫成現成產品功能。

通道確認後，先只測 1 份固定 AES-256 合成 PDF；成功才選 3–4 個代表案例。保留短效入口保護、免費邊界、前後狀態核對與清理；不增加通用控制框架。本輪沒有雲端上傳、部署、入口啟用或 PDF HTTP 請求。

## 尚未驗收

- 真正 Cloudflare Free 環境的冷啟動、每請求 CPU、記憶體與錯誤結果。
- 任意真實附件、郵件來源授權、密碼安全首次輸入／重用與撤銷、完整引用鏈。
- 正式部署的網路／解析隔離；本機 fetch 攔截與 PDF.js 設定不是防火牆。
- 文件完整性只能偵測已知缺失資源與部分錯誤，不能保證所有文件擷取完整。
- 發布、合併到 `develop`／`main`、正式服務可用性。此輪只在 feature 分支記錄進度。

## 官方參考

- [Cloudflare MCP 安全邊界](https://github.com/cloudflare/mcp/blob/main/AGENTS.md#security-considerations)
- [Cloudflare MCP 官方伺服器](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
- [雲端環境的服務連線設定](https://learn.chatgpt.com/docs/environments/cloud-environments#connect-to-services)
- [ChatGPT 執行權限](https://learn.chatgpt.com/docs/permissions)

以上文件支持產品能力及限制的說明，不代表目前帳號／執行環境已取得額外權限。
