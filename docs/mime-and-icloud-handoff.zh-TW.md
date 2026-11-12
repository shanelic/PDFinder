# Gmail MIME 選取與 iCloud 主機交接

由 Jarvis 建立，2026-11-12。這是可獨立於雲端部署推進的功能切片；不代表正式郵件產品已完成。

## Gmail：已補唯一 PDF 選取

`selectGmailRawAttachment(payload, selection)` 接受先前已核對的 Gmail raw envelope，先比對訊息 ID，再由 `selectUniquePdfAttachment` 選取 MIME 附件。`selection` 包含已選訊息 ID、精確檔名、預期 bytes 與 SHA-256（首次取件可明確 null，不能省略）；在非同步處理前複製，避免稍後修改改變來源敘述。

選取須同時符合：

1. 在本訊息支援的 MIME 結構中，精確檔名只出現一次。即使同名另一份不是 PDF，也拒絕猜測。
2. 選中的 leaf 是 `Content-Type: application/pdf`、`Content-Disposition: attachment`、base64 傳輸。
3. base64 canonical encoding、解碼長度與 `%PDF-` 開頭符合；若有預期 SHA-256，必須匹配。明確 null 則只計算，不宣稱與既有 hash 比對。

回傳原始 bytes、檔名、計算後 SHA、MIME part path。有預期 hash 的 `matched_by` 是 `unique_filename_size_sha256`；明確 null 時是 `unique_filename_size`。Gmail 的 opaque attachment ID 無法從 raw MIME 推得，因此 `attachment_id` 固定為 `null`，不拿 part path、Content-ID 或檔名冒充 ID。

### 支援與有意保留的限制

- 總 RFC 訊息最大 1 MiB，最多 32 個 MIME entity（含 root）、巢狀深度最多 4。這些是本機候選上限，不是已決定的產品規格。
- 單一 header 區段以 CRLF 等效 wire bytes（含分隔空行）保守計算，最多 16 KiB；最多 100 個展開後 header，實體 header 行最多 998 字元。LF 格式也用這個較嚴上限，不能靠大量短折行規避限制。
- 支援 CRLF、LF 及混合換行。只對 MIME 語法正規化換行，PDF bytes 由 base64 解碼，未改寫。
- 支援 single-part PDF 及 `multipart/mixed`、`alternative`、`related`；關閉 boundary 必須存在，深度與數量全程限制。
- 支援 ASCII quoted filename，以及單段 `filename*=UTF-8'language'percent-encoded` 的 RFC 2231 檔名。Unicode 比對不移除 BOM、不做 NFC／NFD 正規化。
- 同時存在 filename/name 或 extended/plain 參數時，解碼結果必須相同，否則拒絕含糊來源。
- 尚不支援 RFC 2047 encoded-word 檔名、RFC 2231 continuation、多字元集、非 base64 PDF、附加郵件內再搜尋、signed/encrypted multipart 等格式，會明確拒絕，不默默降級。遇到 `message/*` 容器即拒絕，避免忽略其中附件後誤稱檔名唯一。
- 不載入 HTML 圖片／外部資源、不開檔案路徑、不自動讀其他信、不在 `read_attachment` 失敗後自行擴大為 raw 取件。

這是保守子集合，不是完整 RFC 郵件解析器。已有 pin 時雜湊比對證明內容相符，首次計算僅是內容關聯；郵件歸屬仍須依靠已驗證的 Gmail 訊息 ID 與主機帳號連線；它不是額外的身份授權系統。

### 驗證證據

合成測試包含 7 個既有 fixture，從 raw MIME → 唯一附件 → 真正 PDF.js 解密 → 查詢及頁碼／來源引用。另涵蓋多附件、同名、UTF-8／astral 檔名、缺失 boundary、錯誤編碼、截斷、大小／SHA 不符及限制。

本輪重用前一輪已取得的官方 raw 合成訊息回應，**沒有再呼叫信箱**。新的 JS selector 找到 MIME path `[2]` 的唯一 PDF，2,476 bytes、SHA-256 `b35a86b6e77b509874766a0f1e0a4a10f956d015b9a53ff52a7b9cf79572de98`，與前輪 Python 標準函式庫結果一致。沒有重新解密該歷史附件，也沒有把它加入 7 份 allowlist、上傳原信或提交帳號識別資訊。

## iCloud：明確的同次主機交接契約

`decodeIcloudHostHandoff(receipt, context)` 是**內部主機 receipt**，不是觀察到的 iCloud 工具 JSON。後續另新增[實際觀察的 envelope decoder](icloud-observation-and-mail-fixture.zh-TW.md)；主機仍不得把下面的 receipt 結構說成官方輸出。

```js
{
  received_for: context, // 同一次 invoke 的原物件，不是字串或 JSON 複本
  originals: [{
    kind: 'original_attachment',
    reference: originalFileReference,
    identity: { message_id, attachment_id, filename, size_bytes },
    complete: true
  }]
}
```

- context 必須是 iCloud、同帳號來源及完整附件 ID，計畫只能含父 message_id 與單一 attachment_ids。
- 主機拿到原始工具回應後，必須先驗證／解包，再把 receipt 關聯回**同一次** context。相同內容但不同物件的 context 也拒絕，避免兩個非同步取件結果對調。
- 只接受一份完整原始檔，不接受 preview、檔案清單缺失／多份或錯誤來源 echo。檔案 reference 保持 opaque，由原主機在同次範圍內交給受支援的讀檔機制。
- `identity` 只能含實際可核對欄位，缺失 echo 可以保留缺失，不能補造；既有 adapter 隨後仍核對 bytes 長度及 SHA。
- 這個 object-identity 檢查只防止主機內誤配，**不防止惡意主機，也不構成跨程序／遠端身份驗證**。目前不提供 live decoder、file downloader、憑證或服務端權限設定。

測試用 fake receipt 已接回真實 AES-256 解析與來源引用；跨 context、錯帳號／訊息／附件、preview、多檔與不完整檔都在讀檔前拒絕。

## 重現與剩餘差距

```sh
npm run test:mime
npm run verify
```

機器可讀紀錄：[mime-handoff-20261112.json](verification/mime-handoff-20261112.json)。

後續已核對 iCloud 真實原始檔交接，但舊合成附件的假密碼紀錄未恢復。仍未完成：live 取件到解密／引用、更多合法 MIME 變體的相容性、真正手機到雲端的完整流程、正式密碼持久保管，以及受支援通道上的 Cloudflare Free CPU／隔離驗收。沒有部署、費用、真實文件或密碼。
