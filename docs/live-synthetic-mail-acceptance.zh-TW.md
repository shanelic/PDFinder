# 一封合成信的 Gmail → iCloud 端到端驗收

2026-11-13 UTC，由 Jarvis 記錄。**真正取件、解密、搜尋與來源引用已通過；Cloudflare 託管解析與 CPU 尚未驗收。**

## 實際完成

取得本次明確寄信授權後，先核對已連接帳號、既有寄達資料及未寄出的準備狀態，再由 Gmail 寄至已核對的 iCloud 收件地址。全程只寄一封，沒有 CC/BCC，唯一附件是 repo 既有的公開合成 `AES-256.pdf`。寄件結果回傳 SENT；之後完整的精確寄件搜尋只有一筆。

- 附件：1,825 bytes，SHA-256 `88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c`。
- 只使用 repo 已公開假密碼，沒有輸入、保存或猜測使用者密碼。
- Gmail 寄件副本使用明確的 `read_email(format=raw)`，經現有 MIME selector 唯一選取附件，沒有依失敗結果自動改讀其他信。
- iCloud 收件端先核對同一 RFC Message-ID、收件人及唯一附件，再以完整附件 ID 的 `get_message` 取得原檔參照，經官方檔案交接下載。實際 bytes、長度、雜湊都與來源 fixture 及 Gmail 相符。所讀回應仍為未讀狀態；沒有執行標記、移動或刪信。
- 本輪未重新嘗試 Gmail 的直接 `read_attachment` 端點，不能把 raw 路徑成功當成該端點已修復。

## 同一套程式的驗收

將本輪**真正連接器回應與原檔**交給既有 `createSyntheticMailVerifier` 與 `createSelectedMailSearch`；沒有為了測試放寬 hash、ID 或大小檢查，也沒有改產品程式。

| 檢查 | Gmail | iCloud |
| --- | --- | --- |
| 固定 fixture 的完整文字 oracle | 通過 | 通過 |
| 單文件搜尋橋接 | 通過 | 通過 |
| 錯誤公開假密碼 | `incorrect_password` | `incorrect_password` |
| 缺少假 profile | `profile_unavailable` | `profile_unavailable` |

共 8 項驗收通過。失敗情境重用已取得的合成原檔／回應，沒有再寄信或讀其他郵件。真正執行的是 repo 的 PDF.js **6.2.108**，在既有雲端 Node 工作區解析，不是測試者電腦，也不是 Cloudflare Worker。

兩路結果都是 1 頁、1 筆命中：第 1 頁 `PDF`，Unicode codepoint 範圍 `[16, 19)`。原文上下文為 `Synthetic cloud PDF transport proof.`。來源保留真正 opaque message／attachment ID；Gmail raw 無法提供該欄位時明確為 null，不把 MIME 路徑冒充附件 ID。公開紀錄移除私人來源 ID、帳號、郵件標頭、下載連結及 token。

[去識別化機器紀錄](verification/live-synthetic-mail-20261113.json)。獨立覆核另以標準 MIME parser 比對三份 bytes，並重跑兩路統一驗收器 2/2 通過；公開紀錄的私人識別掃描通過。既有建置檔 SHA 不變；本輪沒有變更功能來源，未重跑整套既有回歸或宣稱 CI 通過。獨立驗收腳本起初在 geometry 初始化前匯入 PDF.js，修正為呼叫既有 lazy loader 後通過；這是證據腳本的啟動順序問題，不是取件或產品來源修補。

## 不應混淆的界線

- 這是一次由可信 host 協調的 live 合成驗收，工具讀取後將回應注入既有橋接；**尚未部署自動化郵件服務**。程式本身沒有因此取得信箱權限。
- 同一內容的 SHA 是內容關聯，不是帳號歸屬、郵件真實性或獨立身份證明。
- 固定 fixture 有已知完整文字 oracle；不代表任意文件擷取完整，也未處理真實文件、OCR 或一般使用者密碼。
- 本輪沒有雲端部署、開入口、改設定或費用。Cloudflare Free 的正式呼叫、每請求 CPU 與容量仍在 [#1](https://github.com/shanelic/PDFinder/issues/1) 待解。
- 正式 profile 的安全首次輸入／保管／重用／撤銷、無人值守執行、產品級解析與網路隔離及發布驗收仍未完成。
- 舊 2,476-byte 附件的隨機假密碼仍未恢復；這次只驗收上述不同的可重現 fixture，不改寫舊結果。

`npm run verify:synthetic-mail` 與 demo 命令仍然**只產生本機假回應、絕不寄信**。`prepare:synthetic-mail` 的可重現 EML 仍用 `example.invalid` 佔位並標記 `not_sent`，它不是本輪實際送出的 MIME；請勿把示範 manifest 改成 live 寄件紀錄。沒有自動重寄功能。
