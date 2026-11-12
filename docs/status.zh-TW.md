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
