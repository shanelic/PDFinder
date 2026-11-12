# 本機合成附件搜尋 API

由 Jarvis 建立。這是產品流程的最小可執行切片，不是正式服務或新的雲端部署。

## 已串起來的步驟

測試用信箱回傳正規化的附件原始 bytes → 建立 HTTP `Request` → 核對固定來源／SHA-256 → 解析假密碼 profile → 真正 PDF.js 解密與文字擷取 → 字面查詢 → 頁碼、引用及來源資料。

```sh
npm run demo:synthetic
npm run test:attachments
```

示範直接呼叫本機 handler，不啟動伺服器、不傳送 HTTP 網路請求，也不讀取信箱。來源與既有 7 份 PDF 全是合成資料，示範使用 AES-256。既有 `src/worker.mjs` 的 benchmark 未新增路由或改變行為。

## 真正的 Request 輸入契約

`createSyntheticAttachmentApi` 回傳本機 `fetch(Request)` 介面；路由為 `POST /v1/synthetic/search`，Content-Type 必須是 `application/json`，不接受 Content-Encoding。六個欄位皆必須出現，不接受其他欄位：

| 欄位 | 意義 |
| --- | --- |
| `source_ref` | 呼叫端持有的合成來源參照，必須在主機預先選定的來源表中 |
| `filename` | 與來源表及固定 fixture 相同的檔名 |
| `data_base64` | 原始 PDF bytes 的標準、含必要 padding 的 Base64，不是擷取預覽或下載網址 |
| `sha256` | 與來源表、固定 fixture 及實際傳入 bytes 三者一致的 SHA-256 |
| `password_profile` | 加密文件只接受 `synthetic-fixture`；未加密文件必須為 `null` |
| `query` | 1–80 個 Unicode codepoint 的非空白字面查詢，不接受控制字元或未成對 surrogate |

只接受 repo 中已釘選的 7 個檔名／長度／雜湊組合。不能藉這個入口傳入任意 PDF、真實密碼、檔案路徑或 URL。JSON body 上限 32 KiB；解析沿用兩頁／2,000 個 UTF-16 code unit 的測試上限。這些是合成測試上限，不是已決定的產品規格。

## 來源與密碼如何銜接

主機建立 handler 時提供 `sources`：包含 `source_ref`、`provider`、`account_ref`、`message_id`、`attachment_id`、`filename`、`sha256`。provider 為 `gmail` 或 `icloud`；識別字必須是 `synthetic-` 前綴。主機設定會複製，後續修改原物件不會改寫引用。

若經唯一檔名取件但沒有完整附件 ID，`attachment_id` 可為 `null`，引用也保留 `null`，不捏造 ID。對應的 [provider adapter](provider-adapters.zh-TW.md) 負責已選附件的計畫與原始 bytes 邊界。另有實測的 Gmail raw envelope 與保守 [MIME 附件選取](mime-and-icloud-handoff.zh-TW.md)，但 iCloud 真實原始檔交接仍待完成，不等於此 API 已完成 live 端到端流程。

此來源表是**受信任主機的選取宣告**，不是使用者登入驗證。知道一個已選 `source_ref` 並不等於正式產品應授權該使用者。來源雜湊能證明 bytes 一致，**不能單獨證明附件來自某一封信**。真正 provider 回應、檔案運送及帳號身份仍需另外驗證。

`resolvePassword(profile, source)` 是主機注入的測試函式，每個加密請求重新呼叫；Request 不包含明文密碼。測試用公開假密碼證明重用、改錯、移除及恢復可被觀察。不保存 profile 或密碼，不等於已實作安全首次輸入、持久保管或全域即時撤銷。清除函式變數與輸入陣列也不保證 JavaScript 記憶體中的副本已被抹除。

## 結果與引用

- 查詢是區分大小寫的字面比對，不是正則表達式、語意檢索或模糊搜尋。
- 每筆引用包含來源識別、附件 SHA-256、1 起算頁碼、`quote`、周邊文字及範圍。
- 範圍使用 Unicode codepoint；`start` 含起點，`end` 不含終點。測試包含 supplementary-plane 字元，避免與 JavaScript UTF-16 索引混淆。
- 最多 20 筆；有更多結果時 `search.truncated: true`，不是默默截斷。
- 沒找到字面查詢回傳 `no_match`；不能解讀為整封信沒有相關內容。
- 不合成郵件超連結，避免把推測的網址當成可信來源。
- 固定 fixture 的頁面文字須與已知 oracle 完全相同，否則拒絕產生引用。這只適用已知合成資料，不是一般文件完整性證明；結果保留 `not_a_completeness_proof`。

## 錯誤與目前限制

來源未選、來源／檔名／雜湊不符、篡改 bytes、非法 profile、密碼錯誤、缺失資源及不完整 oracle 結果均回傳固定錯誤碼，不回傳原始例外、密碼或任意輸入。一次只處理一個請求，重疊請求回傳 429；取消後會丟棄結果。

**不可直接部署此 handler：** 它沒有正式驗證身分、遠端期限／慢速 body 防護、硬 CPU／記憶體限制、完整故障隔離或 cleanup 失敗後的隔離恢復機制。取消訊號不是硬性終止保證；等待中的 body read 需來源結束才會回覆，結束後會重核取消而回傳 499，不保證立即中止來源。這些產品級要求留在雲端功能與限制確認後處理，不以本機成功代替驗收。

測試信箱是假物件的內部正規化格式，不是 Gmail／iCloud 現行工具的回傳 schema。未新增 live connector、讀取真實郵件、外部檔案下載、手機端驗證或持久儲存。保留這個窄介面，是為了日後接正式運送層時不必再改搜尋及引用語意。
