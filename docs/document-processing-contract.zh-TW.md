# 單份文件搜尋：本機產品契約候選

由 Jarvis 建立。本模組把文字型 PDF 的大小、頁數、搜尋結果與失敗分類變成可執行功能。**只在本機以合成 PDF 驗證，未發布，尚不接受真實文件。** 現有 Worker 與私人合成介面的固定 fixture 範圍沒有放寬。

```sh
npm run test:documents
npm run demo:documents
```

Demo 不讀取檔案或信箱、不接受網址／密碼，而是生成四份合成 PDF，展示第 1／3 頁命中、文字無命中、無可擷取文字，以及超頁數整份拒絕。

## 目前可執行限制

| 項目 | 預設值與語意 |
| --- | --- |
| 每次文件 | 1 個由可信 host 明確選取的原檔，無自動改讀其他附件 |
| 原始 PDF | 最多 2 MiB，即 2,097,152 bytes，非 base64 長度 |
| 頁數 | 20 頁，超過即整份失敗，不能把前幾頁當完整結果 |
| 擷取文字 | 50,000 個 UTF-16 code units；計算 PDF.js item 文字及加入的空白／換行、trim 前，不等於畫面字數 |
| 原檔串流 | 非空 Uint8Array chunks，最多 4,096 段；精確核對宣告長度及 SHA-256 |
| 查詢 | 1–80 Unicode codepoints，非空、無控制字元；區分大小寫的字面搜尋 |
| 引用 | 最多 20 筆；另有命中時明確標 `search.truncated: true` |
| 同時處理 | 每個 processor instance 僅 1 件；另一件立即回 `busy`，不隱藏排隊 |

可信 host 可調低或改變 bytes／頁數／文字預算，但不超過現有 parser 的 2 MiB／64 頁／100,000 UTF-16 units 上限。頁數 20、文字量 50,000、chunk 4,096 是本候選的產品選擇，**不是使用者原先要求、Cloudflare 的限制或安全政策**，仍可依用途調整。這些上限不證明 Free CPU、128 MiB runtime 記憶體或任何硬執行期限足夠。

2 MiB 邊界測試使用 fake parser，證明傳輸大小閘門，不代表已完整解析 2 MiB 文件。真正 PDF.js 已測三頁、20 頁成功／21 頁拒絕、低文字預算拒絕、空白 PDF、格式損壞、已知 AES-256 假密碼正確／缺失／錯誤。資源失敗分類由既有 parser 回歸及本機注入錯誤覆蓋，沒有推稱已測所有中文字型。

## Host API

`createBoundedDocumentSearch({loadParser, resolvePassword, limits})` 回傳 `search(input, {signal})`。`input` 只有：

```js
{
  source: {source_ref, provider, account_ref, message_id, attachment_id, filename, sha256},
  size_bytes,
  stream,             // async iterable of ORIGINAL bytes; not a URL
  query,
  password_profile    // null for no password; otherwise an opaque host profile
}
```

來源 ID 保留原樣；Gmail 未知附件 ID 可為 null，iCloud 要求已選取的完整非空 ID。每個 ID／檔名最多 512 字元，檔名必須 `.pdf`（大小寫不拘），不得含路徑；原檔從 `%PDF-` 開頭。前置垃圾或不符合此窄子集合的合法 PDF 也可能拒絕，不能稱為全部 PDF 相容。

`source.sha256` 由可信 host 的原檔交接提供，helper 會重新計算比對。雜湊只證明 bytes 一致，不證明信件歸屬；連線身份、選取授權與實際 provider 回應綁定仍是 host 的責任。本 helper 本身不讀信或下載。

密碼只由 `resolvePassword(profile, frozenSource)` 在需要時傳回，沒有 request 的明文密碼欄位、持久儲存或快取。未指定 profile 不猜測密碼；已加密文件回 `password_required`。本輪 resolver 只用了公開假密碼，尚無正式秘密存取控制。呼叫者不得在未授權前接入真實密碼或文件。

## 結果與失敗不可混淆

- `matches_found`：文字搜尋有命中，回頁碼、Unicode codepoint 範圍、來源及有界上下文。
- `no_match`：有擷取文字，但查詢未命中。**不保證原 PDF 的全部可見內容都已擷取。**
- `no_extractable_text`：全部頁面沒有可擷取文字。空白／掃描文件可能出現此狀態，不會假裝查詢成功，也不會自動啟動 OCR。
- `page_limit`／`text_limit`：整份失敗，不回部分頁面的 citations。可先由使用者選擇較小文件；不能擅自拆檔、提高上限或付費。
- `input_too_large`／`stream_limit`／`size_mismatch`／`integrity_failed`：取件或傳輸邊界失敗，不進行解密或猜測修復。
- `password_required`／`incorrect_password`／`profile_unavailable`：分別表示缺少密碼、parser 判定不正確、host 無法取得所選 profile，不互相冒充。
- `resource_failure`：已偵測字型／CMap 等擷取風險，不回可誤認完整的結果。
- `malformed_pdf`／`parser_failed`／`invalid_parser_result`：格式或解析問題，不當成「找不到關鍵字」。
- `request_cancelled`／`cleanup_failed`：丟棄結果。清理未完成不放行成功；沒有自動重新讀信或重試。

所有錯誤使用固定代碼及訊息，不轉發 reader、resolver 或 parser 的原始錯誤。來源引用仍是私人內容，不應直接公開至 repo。

## 明確尚未完成

本機 buffer 清零不是安全抹除保證，無法涵蓋 parser／轉移副本／字串。取消只在 async 邊界檢查，不能保證立即中斷同步 CPU 或卡住的 stream。單一 processor 的 busy 不是跨 instance／全帳號配額。cleanup timeout 後釋放 busy 不證明底層工作已停止；正式 host 遇 `cleanup_failed` 應丟棄該工作實例，不在同一實例自動重試。記憶體、CPU、網路外洩防護及多租戶隔離未驗證。

尚無公開一般文件入口、真實信箱取件到解密驗收、正式 profile 權限／撤銷保管、真實文件授權或上線決定。只有固定已知 fixture 能使用精確文字 oracle；一般文件回傳 `not_a_completeness_proof`，絕不承諾全部文件擷取完整。後續仍依功能→雲端效能→必要安全→正式驗收的順序，不以新增通用框架取代可用功能。

驗證：35/35 新測試、4 個 demo 案例、完整既有回歸及建置通過；獨立覆核 35/35 與 5 個反例通過。[本輪紀錄](verification/bounded-document-20261112.json)。
