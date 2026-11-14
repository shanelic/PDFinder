# PDFinder

文字型加密 PDF 解析研究工具，包含 Cloudflare Workers 與 MCP 整合的合成測試資料。

**開發中的研究原型，不是正式郵件附件服務。** 已恢復開發並完成階段 1 的來源與建置產物驗證；階段 2 尚待確認使用者 Cloudflare Free 的 HTTP 測試通道與 CPU；既有私人雲端解析器已有下方記錄的合成取件橋接成功。本庫不含真實郵件、文件、密碼、雲端帳號設定或部署憑證。

## 本機使用

Node.js 22 以上；本輪驗證使用 Node.js 24.22.1：

```sh
npm ci
npm run verify
```

`npm test` 執行 302 項使用受控依賴的介面檢查；`npm run test:parser` 執行 32 項實際解析器檢查，測試中攔截 global fetch。`npm run build` 產生忽略追蹤的 `dist/worker.mjs`。這些命令不部署、不呼叫線上 Worker；本庫尚未提供雲端部署自動化。攔截 fetch 不等於平台網路隔離。

`npm run demo:synthetic` 示範附件 bytes → 假密碼 profile → AES-256 解密 → 頁碼與來源引用；`npm run test:attachments` 驗證這個本機流程，已納入 `npm run verify`。[輸入契約與限制](docs/synthetic-attachment-api.zh-TW.md)說明哪些部分仍是 mock，不能直接當成正式 HTTP 服務。

`npm run test:providers` 驗證 [Gmail／iCloud 選定附件 adapter](docs/provider-adapters.zh-TW.md) 的工具計畫、fake 原始檔運送與引用銜接。`npm run test:mime` 驗證 [Gmail 唯一 MIME 附件選取與 iCloud host 契約](docs/mime-and-icloud-handoff.zh-TW.md)；兩者都納入完整驗證。Gmail raw envelope 及保守 MIME 子集合已用既有合成回應核對，本機測試仍不讀信；另已完成一封真正合成信的[雙信箱取件、解密與引用驗收](docs/live-synthetic-mail-acceptance.zh-TW.md)。

先前已[取回歷史 iCloud 原檔並核對與 Gmail 一致](docs/icloud-observation-and-mail-fixture.zh-TW.md)，也加入 observed-envelope decoder；該舊附件假密碼仍未恢復。2026-11-13 另經授權寄出一封已知公開假密碼的合成附件，兩信箱的 live 取件→解密→引用已通過，未改寫歷史結果。`npm run prepare:synthetic-mail` 只在本機產生可重現郵件與公開假密碼 manifest，**不會寄信**；`npm run test:mail-fixture` 驗證其本機解密與引用。

固定合成資料涵蓋未加密、RC4-128、AES-128、AES-256 與內嵌字型的中文 PDF。資料中的密碼是公開假值，不是秘密。Worker 只接受固定 fixture ID，回傳有限度的測試中繼資料，不接受任意文件上傳。現有介面要求驗證與到期設定，本庫不提供可用憑證。

## 證據與限制

- 階段 1：**302 項介面檢查與 32 項實際解析器檢查全數通過**，建置成功；同一組 32 項另對建置產物驗證通過，不重複計為新的情境。
- 最新歷史雲端嘗試遇到 **MCP 外連通道 HTTP 403**，沒有已驗證的解析回應或每請求 CPU 數據。本輪沒有再次部署或呼叫。
- Cloudflare Workers Free 的每請求 CPU 可行性仍然**未知**。本機整個程序 CPU 不是線上每請求 CPU。
- 一次可信 host 協調的真實合成信驗收已完成；無人值守正式信箱整合、真實文件、密碼重用及手機端完整產品流程**尚未完成**。
- 目前測試不涵蓋全部 PDF、加密變體、字型與版面，也不提供 OCR。

請參閱[目前進度與下一步](docs/status.zh-TW.md)、[階段 1 驗證紀錄](docs/verification/stage1-20261112.json)、[歷史交接](docs/historical-handoff.zh-TW.md)、[匯入紀錄](docs/migration.md)、[架構](docs/architecture.md)與 [Gitflow](CONTRIBUTING.md)。歷史交接中的「暫停」描述是當時狀態，不代表目前狀態。

## 授權

專案程式採 Apache-2.0，沿用擁有者建立 repository 時的授權。納入的依賴及字型資料保留各自授權；再散布前請閱讀 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，建置產物也須附上必要聲明。

可重跑的[雙信箱合成驗收入口](docs/synthetic-mail-verifier.zh-TW.md)：`npm run verify:synthetic-mail`，本機比較 Gmail raw／iCloud 原檔到 AES-256 解密與來源引用；不寄信，輸出不冒充 live 驗證。

[單份文件搜尋候選](docs/document-processing-contract.zh-TW.md)提供 bytes／頁數／文字預算與明確失敗分類；`npm run demo:documents` 只使用本機生成的合成 PDF。未公開一般文件入口，未驗收真實文件或 Cloudflare Free 容量。

[已選附件搜尋橋接](docs/selected-mail-search.zh-TW.md)接合 provider 原檔與單文件搜尋，並區分已知 hash 比對和首次計算。`npm run demo:selected-mail` 僅注入合成工具回應，未讀取真實信箱。

[合成 profile 生命週期](docs/synthetic-profile-lifecycle.zh-TW.md)提供固定假值的重用、精確來源範圍、替換及撤銷，接上既有搜尋；`npm run demo:profiles` 只用 fake 信箱與記憶體 storage，不保存真實密碼或提供正式 vault。

[可重啟的本機 profile adapter](docs/synthetic-profile-persistence.zh-TW.md)用臨時 JSON 保存公開假值 ID，`npm run demo:profile-restart` 在六個全新程序驗證重用、替換與撤銷。不是正式 vault 或雲端持久化；[正式保管選擇](docs/profile-storage-options.zh-TW.md)另列官方支援與未驗收邊界。

[可信 host 單文件查詢入口](docs/synthetic-host-query.zh-TW.md)讓前端只提供選項與查詢字串；身分、精確來源與 profile 由 host 注入。`npm run demo:host-query` 可重跑合成流程，尚非手機可用的已部署服務或真正登入驗收。

[Named Preview 單份 smoke runbook](docs/named-preview-smoke-runbook.zh-TW.md)固定材料、一次手動 POST 與清理步驟；`npm run demo:preview-evidence` 只示範離線 CPU／請求／版本對應，未建立 Preview 或量得雲端 CPU。正式 POST 通道仍待確認。

[合成 Request／Response 查詢入口](docs/synthetic-host-http.zh-TW.md)把前端兩欄 JSON 接到可信 host、雙信箱橋接與引用；`npm run demo:host-http` 只在本機直接呼叫，不開 server 或部署，也不把 Origin／headers 當身分。

[MCP 工具訊息整合候選](docs/synthetic-mcp-query.zh-TW.md)把已解碼的 `tools/list`／`tools/call` 接到 HTTP／可信 host 與雙信箱搜尋；`npm run demo:mcp-query` 驗證序列化引用與去敏失敗。僅固定合成本機資料，還不是完整 MCP server、已註冊工具或 ChatGPT 手機 live 驗收。

[本機官方 MCP stdio server／client](docs/synthetic-mcp-stdio.zh-TW.md)可透過真正子程序協商、發現工具及呼叫合成搜尋；`npm run demo:mcp-stdio` 可重跑兩個 provider 的命中／無命中。官方 SDK 已鎖版，沒有外部工具註冊、網路 listener、真實身份或手機 live 驗收。

[本機 Streamable HTTP MCP 接線](docs/synthetic-mcp-http.zh-TW.md)讓官方 client 經注入的 fetch 驗證 modern JSON／SSE 與 legacy stateless；`npm run demo:mcp-http` 可重跑 8 個合成雙 provider 案例。沒有 socket、遠端註冊或 OAuth，亦未驗證 ChatGPT／手機使用資格；手機交付門檻與 Cloudflare CPU 量測分開保留。

[真正 Gmail 合成附件到私人雲端解析器](docs/live-synthetic-cloud-bridge.zh-TW.md)已完成一次取件、嚴格原檔比對與既有工具呼叫，回傳 1 頁完整合成文字及引用。僅傳 allowlisted bytes 與假 profile，未傳郵件 metadata 或密碼；不等於手機／無人值守產品或 Cloudflare Free CPU 已驗收。

2026-11-14 另完成同一已授權合成信的 [iCloud → 私人雲端解析 parity](docs/live-synthetic-cloud-bridge.zh-TW.md#1114-icloud-parity-驗收)：原檔 hash／bytes、雲端完整文字及頁碼引用與 Gmail 一致。本輪一個原附件讀取、一個 extractor 呼叫，未寄信或部署；手機使用與 Cloudflare Free CPU 仍未驗收。
