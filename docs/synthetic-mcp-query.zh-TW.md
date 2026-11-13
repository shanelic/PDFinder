# 選定文件查詢：MCP 工具訊息整合

Jarvis。原始使用方向是在 ChatGPT／手機端呼叫工具，而不只是直接使用程式內 HTTP adapter。本輪補上缺少的 **MCP 工具訊息 → 既有 HTTP Request／Response → 可信 host → 合成 Gmail／iCloud → 真 PDF.js → 引用結果**。

這是本機、已解碼 JSON-RPC 訊息的 adapter。**不是完整 MCP server、已註冊工具、ChatGPT 手機實測或雲端 HTTP 呼叫**。沒有新增 listener、套件、服務、權限或憑證。

```sh
npm run test:mcp-query
npm run demo:mcp-query
```

## 唯一工具與 Host 接線

`search_synthetic_selected_pdf` 只接受 `selection_ref`、`query`。它不能列信箱、指定帳號、提交任意附件或輸入密碼。`selection_ref` 是已授權選項的名稱，不是 bearer 憑證；仍由 host 每次核對身分、connection、來源及 profile。

```js
const mcp = createSyntheticMcpQuery({http, trustedOrigin});
const result = await mcp.handle(decodedMessage, trustedContext, trustedAbortSignal);
```

`http` 是已配置的 `createSyntheticHostHttp` 實例。Origin 由 host 固定，內部 Request 只帶工具的兩個參數；身分來自獨立注入的 `trustedContext`，絕不取自工具參數、clientInfo 或 `_meta`。trustedAbortSignal 也不是 caller JSON 可提供的物件。

## 本輪驗證的訊息子集合

以官方 **MCP 2026-07-28** 的 `tools/list`／`tools/call` 格式為基準，不自行宣稱支援所有版本。每個請求保留 string／integer ID；結果對應同一 ID。無 ID 的通知不執行查詢，也不產生回應。

```json
{
  "jsonrpc": "2.0",
  "id": "synthetic-query-1",
  "method": "tools/call",
  "params": {
    "name": "search_synthetic_selected_pdf",
    "arguments": {"selection_ref": "synthetic-selection", "query": "PDF"},
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": {"name": "synthetic-client", "version": "0.0.0"}
    }
  }
}
```

官方要求 protocolVersion／clientCapabilities；clientInfo 是可選、自述的客戶端資訊，不是身分證明。`tools/list` 回傳單一固定工具的 inputSchema；不用寄出 PDF bytes、帳號或 profile 值。[基本欄位](https://modelcontextprotocol.io/specification/2026-07-28/basic#_meta)

工具執行結果包含 `resultType: "complete"`、`isError`、`structuredContent`，以及內容完全對應的 JSON text block。正常結果保留既有搜尋狀態、SHA、頁碼、文字範圍與原始來源引用；`no_match` 不是工具失敗。[工具與結果格式](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

格式錯誤、缺協定欄位、未知 method／tool 使用固定 JSON-RPC error；明確提供非物件 arguments 也屬協定錯誤。缺少必要工具內容或參數內容不符、失效 session、撤銷 grant／profile、provider／文件錯誤則使用 `isError: true` 的固定去敏結果，不丟回原始例外。版本不支援使用 `-32022`，明列本候選支援的版本；不自動降版或重試。[版本規則](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)

HTTP 回應也不是無條件轉送：非 200 僅接受既有 status／固定錯誤碼及精確 `{error}`；200 必須完全符合固定 AES-256 fixture 的預期文字、引用及結果結構。未知內容一律改為 `query_failed`，不把原始例外或額外欄位傳給客戶端。這是合成 fixture oracle，不是任意 PDF 的通用輸出／完整性驗證，也不獨立驗證來源權限或證明不受信任的 host 真正執行過解析；來源授權仍由可信 host 負責。本機候選使用 Node 內建 `node:util`，未驗證為可直接部署到 Workers 的模組。

取消訊號沿既有 HTTP adapter 處理，晚到結果不交給客戶端。這不保證郵件取件或同步解析已停止，也不撤回已讀 bytes。前端或模型不應把 `selection_ref`、client metadata 或工具 read-only 註記當作授權。

## 實際串接驗收，而非重跑 HTTP 邊界測試

新測試從序列化後的工具請求開始，穿過真正的本機 HTTP／host adapter、注入的 provider 回應與真正 PDF.js，再序列化工具回應；核對來源及引用沒有在包裝時掉失。驗證涵蓋工具 discovery schema、ID 對應、雙 provider 的成功／無命中、錯誤分類與撤銷，而不是再重做上輪的 2 KiB／UTF-8 HTTP 測試。

合成 session 與 provider callback 只是替身。即使整條本機路徑通過，也沒有證明 ChatGPT 實際工具握手、UI 顯示、平台授權或 connector 歸屬。

## 正式宿主仍要負責

- JSON 位元組解析／大小與時間限制、HTTP MCP headers、真正 TLS／登入及 connector-account 驗證。
- 完整 MCP 基本協定，包括 `server/discover`、適用的能力宣告、傳輸語意與版本互通；本 adapter 只處理已解碼 tools 訊息，**不能直接註冊為完整 server**。
- ChatGPT／手機客戶端實際註冊與呼叫驗收、授權附件選項清單、必要的平台確認與 UI。
- 工作配額、取消／回收與正式安全隔離，以及真實密碼保管。現有 adapter 仍只接受 synthetic ID、固定 AES-256 PDF 及公開假值。
- Cloudflare 正式 POST 通道與每請求 CPU 量測。這個本機整合不解除網路拒絕，不觸碰 production，也不完成 #1／#3 的正式驗收。

全文中的官方支援指協定文件，不代表本 repo 已通過完整 MCP 相容性認證。

## 本輪驗證

42/42 專用測試、10 個雙 provider demo、完整回歸及建置通過。獨立覆核重跑同版測試，並確認 3 個未知／畸形 HTTP 回應不再外洩或誤標成功。Worker 建置 bytes／SHA-256 不變。[機器可讀紀錄](verification/synthetic-mcp-query-20261113.json)包含本輪範圍、成績及未驗收項；這些結果都不是正式 MCP／手機／雲端 CPU 驗收。
