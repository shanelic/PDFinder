# iCloud 原檔觀察與可重現合成郵件

由 Jarvis 建立，2026-11-12。本輪只讀既有已授權合成測試信，不寄新信、不建立遠端草稿、不使用真實文件／密碼或部署服務。

## 已取得真正 iCloud 原檔

先前查詢仍有 cursor，不能當成無信。本輪把列出的 23 個資料夾按相同條件續查到末頁：日期＋唯一主旨標記、以及不含日期的唯一標記兩輪都沒有匹配。這只描述查詢結果，**不是信件不存在的證明**。

接著從已核對的 Gmail 寄件副本讀取原始 RFC `Message-ID`，使用 iCloud `HEADER Message-ID` 精確搜尋，在收件匣第一頁找到同一封測試信。主旨查詢與 header 查詢結果不一致的原因未確認，不歸因於寄送失敗或擅自推測供應商行為。

只讀該信的 metadata 後，傳入工具實際回傳的完整附件 ID 選取唯一 PDF。觀察到：

```js
{
  id: messageId,
  attachments: [{
    id: attachmentId,
    filename, mime_type: 'application/pdf', size, is_inline: false,
    file: { download_url, file_id, mime_type: 'application/pdf', file_name }
  }]
}
```

這是本次實際 `structuredContent` 的窄契約，不是所有 iCloud／File Service 版本都保證的通用 schema。真實帳號、message ID、attachment ID、Message-ID header、下載網址與 token 均未提交。

`decodeIcloudAttachmentEnvelope` 驗證同訊息與精確附件 ID、檔名、長度、MIME、file descriptor，以及目前已觀察的 HTTPS 原始檔 URL host／path 與 file ID 對應。未知 URL 形狀拒絕，不能當成任意 URL downloader。`body_truncated` 是 HTML body 狀態，不拿來推論 PDF 完整性。

實際原檔使用工具回傳的下載連結取得，**不跟隨轉址**，讀取時限制長度。驗證結果：2,476 bytes、PDF header 相符，SHA-256 `b35a86b6e77b509874766a0f1e0a4a10f956d015b9a53ff52a7b9cf79572de98`，與 Gmail raw 選出的同一份 PDF 完全一致。新 decoder 也已套用到該實際回應並與已下載 bytes 核對。

這證明本次原檔運送與內容一致性，不證明所有帳號、附件、下載保存期限、平台隔離或郵件授權都已完成驗收。Repo 中的檔案讀取仍是 host-injected；線上 Worker 不會自動取得這些連接器或檔案存取權。

## 未宣稱解密端到端成功

該歷史測試附件以當次隨機假密碼加密。目前可恢復的合成 fixture、生成器及封存沒有能對應上述雜湊的假密碼紀錄。未猜測、破解或嘗試不明密碼，也沒有重新解密這份歷史檔案。

因此目前可說：**Gmail 與 iCloud 的同一份合成附件 bytes 已一致，真實取件接線已有證據；這份歷史附件的 live 取件到解密／引用仍未完成。**

## 避免重蹈覆轍：可重現郵件 fixture

```sh
npm run prepare:synthetic-mail
npm run test:mail-fixture
```

產生器只使用 repo 既有的 `AES-256.pdf`，不接受收件人、密碼或其他設定。輸出在忽略追蹤的 `dist/synthetic-mail/`：

- PDF：1,825 bytes，SHA-256 `88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c`。
- EML：3,311 bytes，SHA-256 `76a0155d9a49c06dc0aca243ab9adccc75a032f1c9637b3ef36eaf99ecae6581`。
- Manifest 固定記錄 PDF／EML 雜湊、公開假密碼、profile、來源及 `not_sent`。

公開假密碼是 `SYNTHETIC-ONLY-DO-NOT-USE`，不是新秘密或使用者密碼。生成兩次結果相同；不覆寫不一致的既有輸出，也不建立遠端草稿。EML 的寄件人／收件人都是 `example.invalid` 佔位，日期及 RFC Message-ID 為可重現測試值；不能不經確認直接拿去寄送。

新 fixture 的本機 EML → MIME → 真正 AES-256 解密 → 查詢／引用已通過，並驗證錯誤／移除 profile、篡改及來源錯配。它**不是舊 2,476-byte 附件**，不會拿新 fixture 的通過結果冒充舊附件成功。

## 下一個最小決定

要補 live 端到端，可恢復與舊雜湊相符的假密碼紀錄；或另經同意，用可重現 fixture 寄一封新合成測試信，再從 Gmail 寄件副本及 iCloud 收件各驗證一次。後者須明確的寄信授權與實際收件人核對；本輪沒有執行，也不需要提供真實文件或密碼。

雲端 HTTP 通道／Cloudflare Free CPU、安全隔離及正式密碼保管仍是獨立未完成項目。完整驗證摘要：[icloud-observation-20261112.json](verification/icloud-observation-20261112.json)。
