# 合成單文件查詢：Request／Response 入口

Jarvis。本候選把既有[可信 host 查詢](synthetic-host-query.zh-TW.md)接成可由前端送 JSON 的介面形狀。**只在本機直接呼叫 Request／Response 物件，沒有 HTTP listener、部署、真實登入、手機操作或新的讀信。** 不繞過雲端 POST 限制。

```sh
npm run test:host-http
npm run demo:host-http
```

## Host 如何接線

```js
const http = createSyntheticHostHttp({
  host, // 已配置 createSyntheticHostQuery 的可信實例
  trustedOrigin: 'https://synthetic.example.invalid'
});
const response = await http.fetch(request, trustedContext);
```

`trustedContext` 必須由服務端根據真正 session／connector 身分注入，不得從 request body、`Authorization`／`x-authenticated` header、URL、Origin 或 `verified: true` 複製。本 adapter 不驗證 cookie、JWT 或 OAuth；它只把脈絡傳給既有 host 的必要驗證 callback。測試使用假的 session 與公開假值 profile。

`host.query` 在建立 adapter 時綁定，沿用既有來源授權、hash、profile、真正 PDF.js 搜尋與引用，不新增郵件客戶端、帳號選擇或密碼輸入。**Origin 相同不是登入證明**，非瀏覽器 client 可以自行填 Origin，仍須通過 host session 驗證。

## 唯一請求

```http
POST /v1/selected-mail/search
Origin: https://synthetic.example.invalid
Content-Type: application/json

{"selection_ref":"synthetic-selection","query":"PDF"}
```

- Request URL 與 Origin header 都必須精確符合設定的 HTTPS origin；Origin 缺失、不同或 `Sec-Fetch-Site: cross-site` 都拒絕。沒有 CORS wildcard 或 preflight 放行。此版本是同來源前端契約，不是已支援原生 App 的驗收。
- 固定 path，不接受 query string／fragment；只有 POST。
- Content-Type 接受 `application/json` 或 UTF-8 charset；不接受壓縮 body。
- 以串流累計最多 **2,048 bytes／128 chunks**，不依賴 Content-Length；若宣告長度，必須與實際一致。UTF-8 解碼失敗拒絕。
- JSON 只允許兩個字串欄位 `selection_ref`、`query`，順序可交換；未知、重複、巢狀或額外身分欄位拒絕。鍵名不接受 escape；字串值支持標準 JSON escape。
- 既有 host 再驗 selection 的 synthetic 範圍，以及非空／80 Unicode codepoints 查詢。前端不能指定帳號、信件、attachment ID、profile 或密碼。

上述傳輸上限是本候選的工程選擇，不是 Cloudflare 平台限制。body 目前沒有獨立時間上限；未來真正 server 需有接收逾時及工作管理。不能把有 bytes 上限當成已處理全部慢速連線攻擊。

## 回應

成功 HTTP 200 直接保留既有 `bounded_document_search_candidate_v1` 結果：`matches_found`／`no_match`／`no_extractable_text`、已核對來源與頁碼／範圍引用。無命中仍是成功查詢，不改讀別封信。實際 demo 只驗固定有文字的 AES-256 合成 PDF，不宣稱 HTTP 路徑已涵蓋任意文件。

失敗固定為 `{"error":"固定代號"}`，不回傳原始例外、headers、token、profile 值或 provider 訊息。錯誤不自動重試。

| HTTP | 代號／含義 |
| --- | --- |
| 400 | `invalid_request`，格式／欄位／查詢不符 |
| 401 | `authentication_failed`，可信 host 驗證失敗 |
| 403 | `origin_rejected`，來源限制不符，不代表使用者身分驗證 |
| 404 | `route_not_found` 或 `selection_unavailable` |
| 405 | `method_not_allowed` |
| 413 | `body_too_large`，bytes／chunks／長度宣告超限 |
| 415 | `unsupported_media_type` |
| 422 | `profile_unavailable` 或文件內容／密碼等 `document_processing_failed` |
| 499 | `request_cancelled`，本候選的取消回應 |
| 500 | `query_failed`，或解析器／清理／結果契約等內部 `document_processing_failed` |
| 502 | `mail_processing_failed`，provider 橋接失敗 |

`cleanup_failed`、`parser_failed`、`invalid_parser_result`、`invalid_limits` 不歸咎為使用者輸入，回 500；回應仍只給固定去敏代號，不洩漏原始錯誤。

所有回應有 `Cache-Control: no-store`、JSON content type、`X-Content-Type-Options: nosniff`、`Vary: Origin`，沒有 `Access-Control-Allow-Origin`。成功引用仍可能包含私密內容，正式 host 不能把它寫入共用日誌。no-store 不是伺服器、瀏覽器或應用程式完全不留資料的保證。

## 取消與未完成事項

取消已發生時不開始 host 查詢；讀 body 期間取消會停止等待並取消 reader；host 工作開始後取消則回 499、丟棄晚到結果。**不代表底層郵件讀取或同步 PDF 解析被硬性停止**，也不撤回已讀 bytes。這個 adapter 沒有背景工作排程、全域並行配額或解析 sandbox。

已選附件與 profile 仍只接受既有 synthetic ID／固定 AES-256 hash，不放寬成任意真實資料。尚未提供正式 server、TLS／session、登入 UI、connector-account 綁定、授權附件清單、正式秘密保管或手機 App。本地 Request 互通不能替代 Cloudflare Free CPU、網路隔離與發布驗收；#1／#3 不因此完成。

## 驗證

32/32 新測試、雙 provider 的 10 個 demo 及完整回歸／建置通過，Worker hash 不變。獨立覆核重跑 32/32、10/10，另以 6 個反例與 4 個內部錯誤分類核對；沒有失敗或跳過。既有 npm／PDF.js 警告未隱藏，未安裝套件。這些不是 CI 或雲端驗收。[機器可讀紀錄](verification/synthetic-host-http-20261113.json)
