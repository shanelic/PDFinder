# Gmail 合成附件 → 既有私人雲端解析器

2026-11-13 UTC，由 Jarvis 記錄。**一份真正從已授權合成測試信取回的附件，已成功交給既有私人雲端解析工具，回傳完整合成文字與頁碼。** 不是只跑內建 fixture 自測，也不是重新寄信或部署服務。

## 實際驗收

1. 精確讀取 11/13 已授權合成測試信的 Gmail raw 寄件副本一次，不搜尋或讀取其他信。沿用現有 MIME selector，必須唯一符合指定附件。
2. 取出的 `AES-256.pdf` 為 **1,825 bytes**，SHA-256 為 `88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c`。實際 bytes 與既有公開 allowlisted fixture 完全一致，canonical base64 長度為 2,436。
3. 呼叫既有私人 `extract_synthetic_pdf` 一次。只傳 `filename`、`data_base64`、`sha256` 與固定 `password_profile=synthetic-fixture`，沒有郵件標頭、帳號、message ID、下載 URL 或密碼。假 profile 由該服務解析，呼叫端不提供秘密值。
4. 服務回傳相同 filename／hash、1 頁及頁面文字；與已知 fixture 的完整文字 oracle 逐字相符。此驗收不以本機解析取代雲端回傳。

第 1 頁引用：`PDF`，Unicode codepoint 範圍 `[16, 19)`。上下文為 `Synthetic cloud PDF transport proof.`。引用範圍由雲端回傳頁面在 host 驗算；郵件來源關聯由 host 保留，解析服務沒有接收或自行驗證信箱身份。

[去識別化驗收紀錄](verification/live-synthetic-cloud-bridge-20261113.json)只保留公開合成 fixture、結果、呼叫次數與界線，不包含原始郵件、私人識別資料、base64 payload、access token 或 secret。

## 證據的精確界線

- 這是 本次授權的**雲端工具測試**完成的單次橋接，不是 iOS 原生或手機裝置驗收，也不是無人值守產品。
- 本輪只重新讀 Gmail。先前 iCloud 合成取件成功的證據仍屬[另一輪雙信箱驗收](live-synthetic-mail-acceptance.zh-TW.md)，不能合計成此次 iCloud → 雲端解析也已測過。
- 使用既有私人服務，**不是使用者 Cloudflare Workers Free 帳號的 CPU 測試**。沒有每請求 CPU、記憶體或效能配額證據；#1 仍開啟。
- 本次 extractor 回應未包含 parser version。不能把另一個自測工具回傳的 PDF.js 版本，當成這一次 extractor 回應中實際包含的欄位。
- 固定 hash／文字 oracle 證明此次合成內容一致，不是一般文件完整性、信箱真實身份、正式密碼保管或解析／網路隔離的證明。
- 沒有寄信、修改信件、建立憑證、改設定或部署。此紀錄工作沒有第二次 extractor 呼叫，也沒有重跑既有程式完整回歸，因為沒有變更功能來源或依賴；不宣稱新增 CI 驗收。

#3 的正式 host、真實資料／秘密與上線條件仍未完成，保持開啟。這個新成果縮短了「取件後只能本機解析」的差距，沒有改寫其他路線的歷史限制。
