# PDFinder 目前進度

更新：2026-11-13 UTC。由 Jarvis 記錄；本頁區分已驗證成果、歷史證據與待完成事項。

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

## 階段 2：尚未完成新的 Cloudflare 試跑

### 獨立推進：本機附件輸入與引用

已新增 [合成附件 API](synthetic-attachment-api.zh-TW.md)：實際 Request 傳入原始 PDF bytes，再由真正 PDF.js 解密、查詢並產生頁碼／來源引用。7 個 fixture × 2 個 provider 標記共 14 條正規化假信箱路徑通過；另驗證錯誤／移除／恢復 profile、篡改、來源核對、Unicode 範圍與取消。這不是 Gmail／iCloud 真實回傳 schema 或正式帳號授權，未讀取真實郵件。

這項工作不依賴被擋的雲端通道，也未改變既有 benchmark 部署入口。詳細本輪數量及產物見 [本機 API 驗證紀錄](verification/attachment-api-20261112.json)。

接續新增 [provider adapter](provider-adapters.zh-TW.md)：依現行工具契約產生 Gmail／iCloud 精確取件參數，注入 fake invoker、decoder 與原始檔串流，接回真實解析及引用。可拒絕錯誤 echo、預覽檔、大小及雜湊不符；未知附件 ID 保留 null。另唯讀核對一封既有合成測試信的 Gmail raw envelope 與唯一 PDF bytes，驗證摘要見 [provider 紀錄](verification/provider-adapters-20261112.json)。

已補 [JS MIME 唯一附件選取及 iCloud host 交接契約](mime-and-icloud-handoff.zh-TW.md)。Gmail 7 份合成 MIME 路徑接真實解析與引用；重用官方 raw 回應也選出同一份 2,476 bytes PDF。

最新 [iCloud 原檔觀察](icloud-observation-and-mail-fixture.zh-TW.md) 已透過精確 Message-ID header 找回原合成測試信，取得原始 PDF，與 Gmail bytes／SHA 一致；新增的窄 envelope decoder 也用該回應核對。舊附件的當次隨機假密碼紀錄無法恢復，該歷史附件仍未解密。另備的可重現公開假密碼 fixture 已在 2026-11-13 獲授權寄送並完成新一封信的 live 驗收，不替代或改寫舊附件結果。

已另補[同一合成附件的雙信箱驗收入口](synthetic-mail-verifier.zh-TW.md)，保留 host 實際 opaque ID 並統一核對解密、頁碼與引用。最初僅有本機合成 envelope；2026-11-13 同一驗收入口已套用真正 Gmail raw 與 iCloud 原附件，兩路解密與來源引用通過。

另已提供[本機單份文件搜尋候選](document-processing-contract.zh-TW.md)，以新生成合成 PDF 驗證大小／頁數／文字限制及失敗分類。一般文件不使用固定 fixture oracle，因此仍明示擷取完整性未知；未發布或處理真實附件。

單文件功能已接上[精確取件到引用的 host 橋接](selected-mail-search.zh-TW.md)，包含首次取件未知 SHA 的明確語意。本機端到端可重跑；另已完成[新合成信 live 驗收](live-synthetic-mail-acceptance.zh-TW.md)：一封、單一 1,825-byte AES-256 附件，兩路原檔 SHA 一致，1 頁／1 筆命中，真實來源 ID 保留。兩路固定 oracle、橋接成功及錯／缺假密碼 profile 共 8 項通過，未改產品來源或重新計算既有回歸成績。當時雲端解析與 CPU 仍待驗收；後續已有下方記錄的私人雲端解析橋接成功，使用者 Cloudflare Free CPU 仍未驗收，也不是無人值守產品。

### 合成 profile 生命週期已接上搜尋

[新候選](synthetic-profile-lifecycle.zh-TW.md)已提供可重用 profile、精確來源／連線範圍、revision 控制的替換及撤銷，僅支持固定公開合成值與 fixture。51 項新測試、雙 provider 10 個 demo 通過；重用本輪已取得的真正合成信回應／原檔，保留 opaque 來源，10 個生命週期情境亦通過，沒有新讀信或寄信。完整回歸及建置通過，Worker 產物不變。

原始 Map 實作重啟失去狀態；後續已新增[本機臨時 JSON adapter](synthetic-profile-persistence.zh-TW.md)，透過新程序重開驗證公開假值的重用／替換／撤銷，沒有把它當正式秘密持久保管。已取得密碼的在途解析仍可能完成。來源授權檢查在原檔 hash 後，不替代讀信前的帳號／附件授權。詳見該契約與[驗證紀錄](verification/synthetic-profile-lifecycle-20261113.json)。

### 合成 profile 已可跨程序重開

[本機持久化 adapter](synthetic-profile-persistence.zh-TW.md)沿用 read/CAS 契約，只保存公開 value ID 與假 metadata。23/23 新測試、6 個新程序的 12 個雙 provider 情境與完整回歸通過；獨立覆核確認寫入已生效但回報失敗時不重試，以及 32 KiB 門檻不破壞原檔。撤銷 tombstone 重開後仍有效。沒有新增讀信或部署，Worker hash 不變。這是臨時本機狀態保留，不是正式秘密庫、雲端永久儲存或全域撤銷。

[正式保管選擇](profile-storage-options.zh-TW.md)先以平台 runtime Secret 為少量秘密候選，metadata 另保留交易／revision 邊界；沒有先開新資料庫或自行造加密金鑰。

### 前端只選附件與查詢，身分由可信 host 提供

[新的合成 host 入口](synthetic-host-query.zh-TW.md)只接受 selection_ref/query，先用 host 的驗證 callback 與精確 grant／profile 核對，通過才取件；重要界線再核對，撤銷後丟棄結果。44/44 新測試、8 個雙 provider demo、完整回歸通過；獨立覆核 6 個安全反例及 2 個鍵序相容案例通過。來源快照凍結，不能由 callback 改讀另一封信。

這是已完成的本機整合功能，不是真正登入、手機裝置或已部署工具驗收。仍須正式 host 實作 session 驗證、connector 歸屬與授權選項清單；Gmail raw 的許可範圍是整封精確指定信。沒有讀信、部署、新秘密或費用。

### 使用者 Cloudflare Free 的正式呼叫仍待確認

已知阻礙是呼叫通道，不是已證明的 PDF 缺陷或 CPU 超限。先前 MCP 主機拒絕直接呼叫測試 Worker，沒有取得可採用的解析回應或每請求 CPU。缺少量測不能寫成 CPU 為 0。

Cloudflare MCP 官方契約限制 execute 的外連目標為 Cloudflare API；可管理 Worker 不代表可透過同一工具任意呼叫 Worker 網址。切換工具模式不會授予新的目的地權限。不可用代理、換域名或另一執行器規避拒絕。

正式可行路徑仍待確認：

1. 平台提供並明確授權可呼叫該測試 Worker 的正式通道；或
2. 經使用者同意，由使用者自己的裝置執行一次手動合成測試，保留可驗證回應，再以管理 API 讀取平台彙總。

官方雲端環境文件支援擁有者設定指定允許網域，但尚未證明該設定介面適用於目前受管理的執行環境。這不是多索取一個 Cloudflare token 就能解決的問題。也尚未驗證手機可用的完整手動流程，因此不能把它寫成現成產品功能。

通道確認後，先只測 1 份固定 AES-256 合成 PDF；成功才選 3–4 個代表案例。保留短效入口保護、免費邊界、前後狀態核對與清理；不增加通用控制框架。本輪沒有雲端上傳、部署、入口啟用或 PDF HTTP 請求。

### Named Preview 驗收材料已備妥，尚未執行

[最小 runbook](named-preview-smoke-runbook.zh-TW.md)已對照現有 benchmark，包含固定 JSON、一次手動 POST 收集範本、所需權限與清理。新增純離線 evidence validator，不新增部署／管理框架。54/54 新測試（含真實本機 candidate＋PDF.js AES-256 回應）、5 個離線 demo、6 個獨立覆核反例與完整回歸通過；Worker 產物 hash 不變。Ray ID 不保證唯一，Preview deployment ID 也不能當 Worker script version；功能結果與 CPU 證據分開，缺值或映射未知不報 0。官方支援及本機合成驗證不等於正式通道已打通，#1／#3 維持 open。

### 合成查詢已有 Request／Response 入口

[新 adapter](synthetic-host-http.zh-TW.md)將固定同來源 POST 的兩欄 JSON 接到既有可信 host，保留真 PDF.js 搜尋與來源引用；提供串流大小限制、去敏錯誤及取消結果處理。32/32 新測試、10 個雙 provider demo、完整回歸通過；獨立 6 個反例與 4 個內部錯誤分類通過，Worker hash 不變。僅以本機 Request／Response 物件驗證，沒有 socket/server、登入或手機部署。Cloudflare POST／CPU 狀態沒有因此改變，正式授權與發布仍未完成。

### 已補原始工具使用方向的 MCP 訊息接線

[新的 MCP 候選](synthetic-mcp-query.zh-TW.md)讓序列化 tools 訊息穿過現有 HTTP／可信 host／合成 Gmail、iCloud／真正 PDF.js，再回到序列化工具引用。42/42 新測試、10 個雙 provider demo 與完整回歸通過，獨立覆核同版結果並修復 3 個異常 HTTP 輸出反例；Worker hash 不變。來源、頁碼及範圍保留，無命中屬成功，假身分、撤銷與失敗不外洩原始例外。

這是已解碼訊息子集合，並非完整 MCP server 或實際 ChatGPT／手機註冊。成功輸出僅對固定 AES-256 oracle 核對，不能推廣成任意 PDF 的來源授權或完整性證明。未增加服務、依賴、真憑證或雲端操作；#1／#3 的平台與正式驗收仍未完成。詳見[本輪驗證紀錄](verification/synthetic-mcp-query-20261113.json)。

### 官方 MCP client 已可呼叫本機 stdio server

[本輪候選](synthetic-mcp-stdio.zh-TW.md)沿用原工具 handler，透過官方 SDK 2.4.0 的 stdio server 與真正 client 子程序完成 discovery、modern 版本協商及查詢。11/11 新測試、4 個雙 provider demo、鎖版重新安裝後完整回歸與建置通過；獨立覆核11/11、4/4及3項raw-pipe檢查。舊版 initialize 安全拒絕，取消後原ID沒有回應且後續list正常，EOF及client.close能結束子程序。

這次已超越程式內直接呼叫，但仍只在本機固定合成資料中互通，不是ChatGPT手機、遠端服務或真實身份驗收。只新增必要官方server／client依賴，沒有新工具權限、服務、憑證或雲端變更；Worker hash不變，#1／#3正式缺口保留。[本輪證據](verification/synthetic-mcp-stdio-20261113.json)。

### 官方 HTTP client 已可完成合成本機傳輸

[Streamable HTTP 候選](synthetic-mcp-http.zh-TW.md)沿用同一工具與 host 邊界，官方 SDK client 在無 socket 的注入 fetch 中通過 modern JSON／SSE 與 legacy stateless。12/12 新測試、8 個雙 provider demo 與完整回歸通過；獨立覆核同版 12/12、8/8 及 3 個反例。沒有新增依賴，Worker hash 不變。新版 wire 不會因錯誤 metadata 偷換為 legacy，HTTP headers／body 也不能冒充可信 host 身分。

這不是遠端連線或 ChatGPT 相容性實測。當前官方 Help Center 的自建 MCP 連線 FAQ 為 web-only，未區分手機瀏覽器與原生 App；帳號資格、目標手機使用方式仍需另行核實。未建立 endpoint、tunnel、OAuth 或新憑證，#1／#3 維持 open；取消與 close 不保證已開始 parser 的硬停止。[本輪證據](verification/synthetic-mcp-http-20261113.json)。

### 真正 Gmail 合成附件已交給私人雲端解析器

[本輪 live 橋接](live-synthetic-cloud-bridge.zh-TW.md)精確讀取已授權測試信一次，唯一取出已驗證的 1,825-byte AES-256 fixture，僅將 allowlisted bytes、filename、hash 與假 profile 參照交給既有私人解析工具。一次呼叫成功回傳 1 頁，完整文字 oracle 與第 1 頁 `PDF` 引用 `[16,19)` 均通過；沒有將郵件 metadata 或秘密傳給解析服務。

這是本次授權雲端工具測試的真正取件→雲端解析，不是 iOS／手機、無人值守或使用者 Cloudflare Free CPU 驗收。本輪沒有重新驗收 iCloud、寄信、改設定或部署，沒有更動功能程式。正式 host／保管／效能與發布缺口保留，#1／#3 不提前結案。[去識別紀錄](verification/live-synthetic-cloud-bridge-20261113.json)。

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
