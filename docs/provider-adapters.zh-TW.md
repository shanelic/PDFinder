# 選定附件的 provider adapter

由 Jarvis 建立，2026-11-12 核對當時可用工具的描述及參數 schema。本輪僅使用合成資料，後續也唯讀重新檢查既有合成測試信；沒有新增信件、讀取真實文件或取得憑證。

## 本輪能確認的官方工具契約

| Provider | 取件規則 |
| --- | --- |
| Gmail `read_attachment` | 必須先由父郵件選定附件，且 `read_attachment_supported` 為 true。優先傳完整 `attachment_id` 與父 `message_id`；ID 缺失／截斷才使用原樣、在該信內唯一的 `filename`。不得同時傳兩種選擇器或猜 ID。工具描述說原始附件位於 `file_uri`。 |
| Gmail `read_email` | `full` 可能回文字、非文字的 `base64_url_content` 或需另取的 `attachment_id`；`raw` 回 base64url 的 RFC 2822 訊息。本輪補實測及 envelope 解碼，尚未實作 JS MIME 附件選取，也不在 adapter 取件失敗後自動讀整封信。 |
| iCloud `get_message` | 用父 `message_id` 及該信實際回傳的 `attachment_ids` 取選定檔案。本 adapter 一次傳一個完整 ID；工具描述說讀取不標記已讀，也不載入 HTML 的外部資源。 |

以上表格記錄**現行工具參數／敘述**。歷史研究曾記錄 Gmail raw 與 iCloud 合成取件成功，但目前可恢復的舊 prototype 副本沒有足以重建那些 observed-envelope decoders 的證據，因此另外做下列有限度唯讀核對，而不直接套用歷史成功。

## 本輪實際連接器觀察

- 重新定位兩封先前建立的合成測試信，只選其中一封的唯一合成 PDF。所讀的是 iCloud 測試信在 Gmail 的寄件副本，不是新的測試信。
- 該附件的 `read_attachment_supported` 為 true，但單次 `read_attachment` 回 `INVALID_ARGUMENT`。這是所選附件的實測，不推論全部 Gmail 附件都失敗；沒有反覆重送。
- 明確對同一封信呼叫官方 `read_email(format="raw")` 成功。`structuredContent.id` 與指定訊息相符；`structuredContent.raw` 是 canonical base64url，解碼為 4,703 bytes RFC 2822。
- 本機標準函式庫 MIME 檢查得到唯一 PDF，2,476 bytes，SHA-256 `b35a86b6e77b509874766a0f1e0a4a10f956d015b9a53ff52a7b9cf79572de98`。本輪未重新解密該歷史附件，也未將它加入現有 7 個 allowlist fixture。
- 新增 `decodeGmailRawEnvelope`，以實際回應核對 id／raw bytes，並用 5 個合成測試驗證 identity、canonical encoding 與 byte budget。此函式只回 RFC bytes，不假稱完成 MIME 選取或來源引用。原信、帳號、訊息 ID 及 raw bytes 均未寫入 repo。
- iCloud 收件匣以唯一合成測試標記做有限度搜尋，21 頁後仍有 cursor 且未定位；已停止擴大搜尋。這不是不存在的證明，也不替代 iCloud envelope 實測。

## 最小可測流程

`planAttachmentRead(selection)` 產生精確工具名稱與參數，不執行工具。`createSelectedAttachmentAdapter` 需由主機明確提供：

1. `connection`：已核對的 provider、account_ref、connection_ref。
2. `invoke(plan, context)`：在該連線執行已規劃的單次讀取；本輪是 fake invoker。
3. `decodeOriginal(raw, context)`：解包原始檔回應的主機函式；**目前沒有可用的 production 實作**。上述獨立 Gmail raw envelope helper 不會冒充 file_uri／iCloud decoder。
4. `readOriginal(reference, context)`：經受支援檔案交接讀取原始 bytes，提供 `AsyncIterable<Uint8Array>`；本輪只用記憶體串流。

adapter 自己不呼叫 `fetch`、不解讀下載 URL、不跟隨重導、不搜尋其他信、不建立檔案或寫入信箱。沒有 decoder／原始檔讀取函式時，建立 adapter 直接失敗，不自行猜測或降級。

### Selection

`selection` 包含既有 API 的 `source`，加上 `size_bytes`、`attachment_id_complete`、`filename_unique_in_message`、`read_attachment_supported`。必須由已讀取父郵件的可信主機提供，不能把使用者文字或郵件內文當成授權。

本輪仍只接受現有 7 份合成 PDF 的檔名、大小與雜湊。連線的 provider／account_ref 須與來源相同；selection 會在非同步呼叫前複製。`connection_ref` 是交給主機選連線的上下文，不能靠這個字串證明外部工具實際使用了哪個帳號。

Gmail 的截斷 ID 不會被傳給工具，也不會保留為有效引用 ID。使用唯一檔名 fallback 時，未知 `attachment_id` 明確回 `null`；來源仍保留父郵件、檔名與 host 的 source_ref。若回應聲稱一個無法與選取資料比對的 ID，採拒絕而非默默替換來源。

### 內部 decoder 契約，不是 provider schema

```js
{
  kind: 'gmail_original_file', // 或 icloud_original_file
  reference: originalFileReference, // 原回應中的 opaque file reference
  identity: { message_id, attachment_id, filename, size_bytes },
  original_truncated: false
}
```

`identity` 只放實際可核對的 echo 欄位，可為空物件；有提供就必須符合原 selection。**不能補造缺失 echo 來宣稱來源已被 provider 證明。** 實際 envelope decoder 必須拒絕錯誤／模糊的回應，並將 reference 綁定這次原始回應。

原始檔與文字預覽不同；`extraction_file_uri`、錯誤 provider 類型、截斷內容或不一致的 echo 在讀檔前拒絕。串流每段複製，精確檢查預期長度、型別及最終 SHA-256；進入搜尋 API 時再核對一次 bytes，避免兩階段之間被改寫。

## 驗證與下一步

```sh
npm run test:providers
npm run verify
```

測試涵蓋工具計畫、帳號／來源隔離、7 份 × 2 provider 的 fake transport → 真解析 → 引用、唯一檔名及 null ID、缺失／錯誤 echo、超量／不足／篡改 bytes、錯誤去敏、取消與不得自動 fallback。這是 synthetic normalized transport，不是連接器驗收。

正式接線仍需：

- 完成可取得原始檔的回應 envelope 及受支援檔案交接驗證；iCloud 尚未重新定位測試信，Gmail read_attachment 在本次所選附件失敗。
- 確認工具實際的帳號／連線綁定；檔案雜湊不能證明郵件歸屬。
- 接續已驗證 Gmail raw envelope，匯入或重建嚴格的 MIME 附件選取；不為此自動擴大郵件讀取範圍。
- 實作部署所需的身份、取消期限、cleanup 隔離與資源控制。當上游 pending 時，這個本機 adapter 仍依賴上游合作；它不是平台沙箱。

本輪沒有新增權限、部署、服務或費用，也未讀取真實文件或密碼。
