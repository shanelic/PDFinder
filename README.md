# PDFinder

文字型加密 PDF 解析研究工具，包含 Cloudflare Workers 與 MCP 整合的合成測試資料。

**開發中的研究原型，不是正式郵件附件服務。** 已恢復開發並完成階段 1 的來源與建置產物驗證；階段 2 尚待確認受支援的雲端 HTTP 測試通道。本庫不含真實郵件、文件、密碼、雲端帳號設定或部署憑證。

## 本機使用

Node.js 22 以上；本輪驗證使用 Node.js 24.22.1：

```sh
npm ci
npm run verify
```

`npm test` 執行 302 項使用受控依賴的介面檢查；`npm run test:parser` 執行 32 項實際解析器檢查，測試中攔截 global fetch。`npm run build` 產生忽略追蹤的 `dist/worker.mjs`。這些命令不部署、不呼叫線上 Worker；本庫尚未提供雲端部署自動化。攔截 fetch 不等於平台網路隔離。

`npm run demo:synthetic` 示範附件 bytes → 假密碼 profile → AES-256 解密 → 頁碼與來源引用；`npm run test:attachments` 驗證這個本機流程，已納入 `npm run verify`。[輸入契約與限制](docs/synthetic-attachment-api.zh-TW.md)說明哪些部分仍是 mock，不能直接當成正式 HTTP 服務。

固定合成資料涵蓋未加密、RC4-128、AES-128、AES-256 與內嵌字型的中文 PDF。資料中的密碼是公開假值，不是秘密。Worker 只接受固定 fixture ID，回傳有限度的測試中繼資料，不接受任意文件上傳。現有介面要求驗證與到期設定，本庫不提供可用憑證。

## 證據與限制

- 階段 1：**302 項介面檢查與 32 項實際解析器檢查全數通過**，建置成功；同一組 32 項另對建置產物驗證通過，不重複計為新的情境。
- 最新歷史雲端嘗試遇到 **MCP 外連通道 HTTP 403**，沒有已驗證的解析回應或每請求 CPU 數據。本輪沒有再次部署或呼叫。
- Cloudflare Workers Free 的每請求 CPU 可行性仍然**未知**。本機整個程序 CPU 不是線上每請求 CPU。
- 正式信箱整合、真實文件驗收、密碼重用及手機到附件解析的完整流程**尚未完成**。
- 目前測試不涵蓋全部 PDF、加密變體、字型與版面，也不提供 OCR。

請參閱[目前進度與下一步](docs/status.zh-TW.md)、[階段 1 驗證紀錄](docs/verification/stage1-20261112.json)、[歷史交接](docs/historical-handoff.zh-TW.md)、[匯入紀錄](docs/migration.md)、[架構](docs/architecture.md)與 [Gitflow](CONTRIBUTING.md)。歷史交接中的「暫停」描述是當時狀態，不代表目前狀態。

## 授權

專案程式採 Apache-2.0，沿用擁有者建立 repository 時的授權。納入的依賴及字型資料保留各自授權；再散布前請閱讀 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，建置產物也須附上必要聲明。
