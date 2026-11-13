# 本機 Streamable HTTP 接線與 ChatGPT 交付門檻

Jarvis。本輪使用已鎖定的官方 MCP SDK 2.4.0，讓官方 HTTP client 經 `Request`／`Response` 與 SDK server 互通。client 的自訂 fetch 只直接交給本機 handler，**不開 socket、沒有 DNS／TLS／遠端網路請求**。這是遠端服務所需傳輸形狀的本機驗證，不是可連線的公開 endpoint，也不是 ChatGPT 相容性實測。

## 官方文件目前能確定什麼

- 一般插件連線需公開 HTTPS、支援 Streamable HTTP 的 MCP endpoint，或已設定的 Secure MCP Tunnel。工具名稱、schema、annotations 與需要帳號的 authentication discovery 都要實際核對；本機 stdio 不能直接當成遠端網址。[官方連線指引](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- Custom MCP 設定頁列 SSE／streaming HTTP，並提供 OAuth、無驗證及混合選項。這些產品選項不代表私人郵件服務可以省略身份驗證。[Custom MCP 說明](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- 涉及使用者私人資料的 server 應驗證使用者；官方 OAuth 2.1 指引要求 resource server 每次驗證 access token，並正確處理 audience／scopes 等授權。Origin、client metadata 或一個可用 tunnel 都不能代替它。[Authentication](https://developers.openai.com/plugins/build/auth)

一般連線文件未承諾每個客戶端都支援同一 MCP revision。官方 **MCP Events** 另外明列 `2026-07-28` HTTP，適用該文所述 Work web、桌面 Cloud 與 dots 事件整合；不能將這個狹義證據當成本專案全部工具／手機已驗收。此輪不增加 Events。[官方 Events 範圍](https://developers.openai.com/plugins/build/mcp-events)

### 手機與帳號是獨立交付門檻

現行 Help Center 的問題是「Can I connect custom MCP servers on mobile?」，答案是「No - web only.」。文中也列 Business／Enterprise/Edu 的角色與 workspace 權限，以及 Pro 的 read/fetch 範圍。它沒有細分手機瀏覽器與原生 App；不能據此承諾手機瀏覽器可用，也不能把舊快取較廣的敘述當成所有已安裝工具都不能在手機使用。本輪未查使用者實際方案、權限或裝置，未試建連線。[現行 Help Center](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)

因此「使用者手機能啟動並取得結果」必須獨立驗收，不因 Cloudflare 通道或本機 MCP 測試成功就自動成立。既有 dots／私人工具的能力也不能不經驗證直接套用到這個自建 remote endpoint。

## 本機執行與邊界

```sh
npm run test:mcp-http
npm run demo:mcp-http
```

同一工具補上 read-only、非破壞、可重複與 closed-world annotations；closed-world 只描述固定合成 fixture，不可直接套用到未來真正取信。這些提示不授予帳號或資料存取權。

SDK 負責 Streamable HTTP framing、標頭、版本與回應形式。modern `2026-07-28` 與 legacy initialize 路徑分開驗收；同一既有工具 handler 與合成雙信箱／PDF.js 路徑重用，不複製解析或權限邏輯。legacy 的 SDK 已分類 request 轉成內部 adapter 契約，不把外部 wire revision 假報為 modern。

入口要求服務端提供身份核對 callback，獨立的 trustedContext 不從 HTTP body、headers、metadata 或 caller 宣稱的 authInfo 推導。示範使用假 context，仍不是 OAuth 或真正帳號驗證；通過後也只能查固定 `synthetic-gmail`／`synthetic-icloud` 假選項。沒有真密碼、任意 PDF／檔案輸入或自動取信。

`https://synthetic.example.invalid/mcp` 只作本機 Request 識別，沒有建立此網域或對它發網路請求。這不是繞過先前被拒的 Cloudflare 外連；測試沒有遠端呼叫的 fallback。SDK 的協定 body 門檻與原有兩欄查詢門檻屬不同層次，不能當成完整生產流量控制。

### 本輪驗證與明確限制

12/12 新測試通過，包含 modern JSON、modern SSE 與 legacy stateless 的真正官方 client 呼叫，以及假身分、錯誤 origin、版本／capabilities、無效 JSON、32 KiB body 門檻、等待驗證期間取消與關閉。兩個 provider 的命中／無命中 demo 共 8 個案例通過；獨立覆核 12/12、8/8 與 3 個額外拒絕反例通過。沒有新增依賴，lockfile 不變，既有 stdio 回歸亦通過。詳見[驗證紀錄](verification/synthetic-mcp-http-20261113.json)。

`responseMode` 只控制 modern：本輪逐一核對工具回應的 JSON／SSE Content-Type；legacy stateless 工具回應使用 SSE，不受該 JSON 選項控制。SDK 的 modern JSON 模式會丟棄 mid-call notifications；這個一次回傳的合成工具不依賴它們，不代表所有互動工具都相容。[官方 SDK 版本說明](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)

取消／close 測試只證明已取消或仍在等待身份驗證的請求不進入 handler、關閉後不再接受新請求。**未證明已開始的 PDF 工作一定立即停止**；SDK 的 legacy 已開始請求也不由 handler.close 保證終止。沒有硬 CPU／記憶體隔離、持久 session 或連線中斷恢復驗收。

## 仍需後續授權與驗收

1. 使用者實際帳號／workspace 的連線與目標手機使用方式；沒有實測前不承諾平台可用。
2. 獲允許的遠端 endpoint 或正式 tunnel、服務端使用者驗證、來源權限與秘密保管。此輪不建立 tunnel、OAuth client、runtime key 或公開入口。
3. 真正網路、TLS、平台握手／工具選擇及安全隔離；本機注入 fetch 不驗證這些能力。
4. #1 的受允許 Cloudflare POST 與每請求 CPU，以及 #3 的一般文件／正式發布條件。沒有因本輪工作而完成或關閉。
