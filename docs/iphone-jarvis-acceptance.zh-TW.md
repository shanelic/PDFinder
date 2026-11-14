# iPhone → Jarvis 合成 PDF 驗收

2026-11-14 UTC，由 Jarvis 準備。**尚未執行手機驗收。** 目前雙信箱取件到既有私人雲端解析已完成；本輪只把下一步縮成兩段可貼上的指令，沒有讀信、解析或自測工具呼叫。

## 使用方式

在 iPhone 上，開啟平常使用的 Jarvis 對話，貼上正例。收到結果後，再貼反例。不要新建自訂 MCP 連線、上傳文件、輸入密碼、提供 token 或修改設定。這裡驗收的是既有 Jarvis 對話路線，不是宣稱任意 iOS 自訂 MCP server 都受支援。

### 正例：手機發起，雲端取件、解析、引用

```text
請用先前已授權的 PDFinder 合成測試信，只讀 iCloud 那封的 AES-256.pdf，透過既有私人雲端解析工具查「PDF」。請回覆頁碼、原文引用及附件來源。只用既有合成密碼參照，不要讀其他信、索取密碼或改設定；如果無法執行，請直接說明，不要拿舊結果當成這次實測。
```

預期：回覆來源為該 iCloud 合成測試附件 `AES-256.pdf`，第 **1 頁**有 `PDF`，原文上下文為 `Synthetic cloud PDF transport proof.`。引用的 Unicode codepoint 範圍為 `[16, 19)`；不必把範圍、雜湊或私人郵件 ID 全部塞進手機回覆。不可編造郵件連結或把檔名當成唯一身份驗證。

### 安全反例：同次回應中沒有命中

```text
請沿用剛才這次雲端解析回傳的同一份合成文件，查「PDFINDER_SYNTHETIC_NO_MATCH_20261114」。不要重新讀信或解析；找不到請明確回覆沒有命中，也不要產生命中頁碼或引用。
```

預期：成功完成搜尋但沒有命中，`matches=[]`、`truncated=false`。這不是解密失敗；不能硬湊相近詞、補造頁碼／引用或重做外部呼叫。如果同次頁面結果未保留，就如實回覆無法驗收此步，不能偷偷重讀或改用先前 fixture 當作本次結果。

不採「錯誤 profile」外部試打：既有工具 schema 只允許 `synthetic-fixture`，這個錯誤參數測試最多證明參數拒絕，不能證明實際密碼撤銷。也不為驗收修改 runtime Secret、傳任意 profile 或索取真實密碼。

## 執行者的最小核對

以下是驗收計畫，不是本輪已執行紀錄：

1. **由新手機指令開始**：記錄開始時間及該次指令與回覆的關聯。不得以已完成的 Gmail／iCloud 桌面或雲端呼叫紀錄直接填成手機通過。
2. **精確來源**：只用可信 host 已保存的同一已授權 iCloud 訊息／完整附件 ID；缺少映射就停，不搜尋其他信。必須唯一附件、filename `AES-256.pdf`、1,825 bytes，SHA-256 `88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c`，且原檔 bytes 等於公開 allowlisted fixture。
3. **同一私人服務**：正例最多1次原附件讀取、1次 extractor 呼叫，僅傳 canonical base64、filename、指定 SHA 及 `synthetic-fixture`。不傳帳號、郵件 metadata、原檔 URL 或秘密值。結果不確定就核對，不盲目重送，不以其他路線繞過拒絕。
4. **驗算回傳**：filename／SHA／1頁與完整固定文字 oracle 相符，再用回傳頁面建立來源引用。保留同次頁面供 no-match，反例新增讀信與 extractor 呼叫都必須為0。原始 metadata／頁面只留在授權的工作上下文，不貼到公開 repo。
5. **結果真的到手機**：將新結果送回同一 Jarvis 對話。優先記錄平台可驗證的來訊表面（若存在）；若只有使用者說在 iPhone 上，標成「使用者回報裝置」，不能寫成已驗證原生 iOS。手機瀏覽器與原生 App 分別記錄，未知就填未知。
6. **閱讀確認**：可請使用者回覆「我在 iPhone 看到了頁碼／引用，也看到沒有命中」。這確認其看到結果，不是平台身分 attestation。若沒有確認或可用收件證據，保留交付待確認，不把訊息 send 成功當成使用者已讀。

沒有新連線／權限／費用的預設動作。遇到平台登入、必需授權或連接拒絕，報確切阻礙並停止，不能宣稱手機驗收通過。正例使用新取回的合成附件，是為了驗收手機指令觸發整條路線，不是再次泛測 provider 相容性。

## 最少證據與 issue 狀態

驗收後的公開紀錄只需：時間、`provider=icloud`、公開 fixture pin、手機表面及其證據等級、正例讀取／解析計數、oracle／頁碼／引用結果、反例 no-match 與零新增外呼、同一對話交付／使用者閱讀確認的狀態。**不要公開**帳號、訊息 ID、裝置識別碼、私人對話截圖、raw mail、下載網址、token、base64 payload 或秘密。

分開記錄三種結果：`prepared_not_run`、`cloud_result_returned_mobile_receipt_unconfirmed`、`mobile_round_trip_confirmed`。這些是記錄標籤，不是新增 API 或驗證框架；只有足夠證據才提升狀態。若裝置僅為使用者回報，確認結果仍須明載該較弱證據，不能改寫成原生 App 的技術 attestation。

本輪只以現有 `findLiteralMatches` 在公開 fixture oracle 核對正例與反例的預期值，不重跑已驗收 provider／extractor，不新增程式或套件。[本輪準備紀錄](verification/iphone-acceptance-preparation-20261114.json)明確標為尚未執行手機驗收。

此步若通過，只完成既有 Jarvis 路線的合成手機來回；不完成一般文件、正式秘密保管、無人值守產品、使用者 Cloudflare Free CPU／隔離或上線。#1／#3仍需各自的驗收，不能整張 issue 因手機通過就關閉。
