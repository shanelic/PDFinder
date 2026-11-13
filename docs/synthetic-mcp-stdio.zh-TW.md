# 本機 MCP stdio：官方 client／server 互通

Jarvis。本輪把既有合成查詢 adapter 接到官方 TypeScript SDK 的 stdio server，讓真正的 MCP client 透過子程序 stdin／stdout 呼叫，而不是直接呼叫 JavaScript 函式。只供本機固定合成資料使用，**不是 ChatGPT 手機註冊、遠端 MCP、正式身份或雲端 CPU 驗收**。

## 為什麼使用官方 SDK

原有 [MCP 訊息 adapter](synthetic-mcp-query.zh-TW.md)只有 tools 訊息處理，不負責 discovery、版本協商及傳輸。為避免另造協定，本輪使用 npm 官方 `@modelcontextprotocol/server` **2.4.0**，並以官方 `@modelcontextprotocol/client` **2.4.0** 作開發驗收；版本、傳遞依賴與 integrity 已寫入 lockfile。沒有新增 HTTP framework、schema 套件的直接依賴、服務或憑證。[官方 SDK 與套件](https://github.com/modelcontextprotocol/typescript-sdk)

採 `serveStdio(factory, {legacy: 'reject'})`，client 明確 pin `2026-07-28`。不是把舊 `initialize` 流程改版本字串；官方 SDK 的預設 client 與直接 `Server.connect(StdioServerTransport)` 仍屬舊協定，不能當成新版本驗收。[官方版本遷移](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

只註冊既有兩個 tools handlers，委派原有查詢 adapter；SDK 負責 discovery、訊息 framing、版本及取消傳遞。沒有新增取信、列信箱、讀檔或秘密管理工具。[官方低階 Server](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/docs/advanced/low-level-server.md)

## 本機使用與資料範圍

```sh
npm ci
npm run test:mcp-stdio
npm run demo:mcp-stdio
```

Demo 由官方 client 啟動 server 子程序，完成後關閉。若由其他本機 MCP client 啟動，使用 `node scripts/serve-synthetic-mcp.mjs`，不要以會在 stdout 印 npm banner 的命令當作協定入口。client 須支援並明確選用本候選的協定版本。這不是外部平台註冊指令。

固定假選項由 server 內部建立，只對應 Gmail／iCloud 的既有 AES-256 fixture 及公開假 profile。呼叫者不能提供真實帳號、原檔路徑、URL、密碼或任意附件。這些 session／來源授權是合成替身，不是登入驗證。任何可啟動本機程序的人都能使用此合成示範；沒有用本機 stdio 冒充遠端 access control。

唯一工具是 `search_synthetic_selected_pdf`。選項固定為 `synthetic-gmail` 或 `synthetic-icloud`，例如傳入 `{"selection_ref":"synthetic-gmail","query":"PDF"}`。CLI 不接受額外參數，原檔只來自 repo 已有 fixture，不讀取呼叫者指定的檔案。

## 邊界與驗收判準

- 官方 client 成功協商 modern era、發現工具並取得雙 provider 的正確來源／頁碼引用；沒有命中屬正常成功。
- 錯誤與冒稱身份不會放寬固定選項；stdout 僅協定訊息，不混入 PDF.js 警告。
- 取消與 EOF 的子程序行為另驗收。取消是丟棄結果與盡力停止，不代表已讀 bytes 可收回或同步解析立即終止。
- stdio 的規範要求 stdin／stdout 使用逐行 JSON-RPC，diagnostic 走 stderr；本候選不另實作第二套 framing。[官方 stdio 規範](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)

官方 client 的版本 probe 可能啟動一個短暫 sibling 子程序，再啟動正式連線；因此不能把子程序數量直接當作 PDF 解析次數。[官方 client 協商語意](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)

## 尚未完成

此路徑沒有 network listener、外部工具註冊、OAuth、真信箱連接或秘密保管。沒有驗收 ChatGPT／手機客戶端是否支援這個本機 stdio 版本，也沒有替遠端部署提供身份／工作配額／程序隔離。既有固定 fixture oracle 仍不是一般文件完整性或獨立來源證明。

Cloudflare POST 通道與每請求 CPU 仍受 #1 的既有阻礙限制；本機官方 client 互通不會解除外連限制，也不完成 #3 的正式發布條件。Worker 的部署入口不因這項本機功能而改變。

## 本輪實測結果

鎖版後以 `npm ci --ignore-scripts --no-audit --no-fund` 重新安裝，再跑完整 `npm run verify`：11/11 新 stdio 測試、4 個官方 client demo、全部既有回歸及建置通過。獨立覆核重跑 11/11 與 4/4，另以 raw pipe 完成 3 項 metadata 不擴權／來源引用／stdout 與 EOF 檢查。

實際舊版 initialize 由 server 回 `-32022`；取消案例原工具 ID 沒有收到回應，後續 list 及 EOF 正常。這不證明解析在取消前已開始，也不保證 CPU 硬停止。既有 Worker 產物 3,740,357 bytes 及 SHA-256 不變。詳見[機器可讀紀錄](verification/synthetic-mcp-stdio-20261113.json)，未將官方 SDK 互通擴大宣稱為所有 client 或全部協定認證。
