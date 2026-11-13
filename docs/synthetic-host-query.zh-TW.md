# 手機請求與可信 Host：單文件搜尋候選

由 Jarvis 建立。這是未部署的合成整合介面，不是登入系統、手機 App 或正式郵件權限服務。本輪只用 fake 身分／connector、公開假密碼 profile 與固定 AES-256 PDF；沒有讀信、寄信、部署或真實憑證。

```sh
npm run test:host-query
npm run demo:host-query
```

## 使用流程

1. **可信 host** 先以所選平台的正式機制驗證登入身分及 connector 歸屬，再提供此人可用的精確附件選項。本候選沒有提供列信、搜尋信箱或任意帳號存取。
2. 手機／前端只送兩欄，例如 `{"selection_ref":"synthetic-choice-gmail","query":"PDF"}`。不接受帳號、provider、message ID、附件 ID、密碼、profile、grant、`verified` 或登入聲明。
3. Host 由自己的驗證結果查出指定選項的精確 connection、來源、固定 hash、公開假值 profile 及 revision，先授權才取件。`selection_ref` 只是選項索引，不是 bearer 憑證，也不單獨授予權限。
4. 既有 Gmail／iCloud 橋接取得原檔，重新核對雜湊，使用已選定 profile 解密搜尋。成功回頁碼、文字範圍與原始來源引用；失敗不改讀其他信件或猜密碼。
5. Host 在重要非同步邊界再核對授權／grant；若身分或 grant 已改變／撤銷，拒絕繼續或丟棄結果，而不是把舊授權快取當永久有效。

## 身分與取件權限的界線

`createSyntheticHostQuery({authenticate, readGrant, invoke, readOriginal, loadParser, resolvePassword})` 回傳 `query({selection_ref, query}, trustedContext)`。這是程式內 API，沒有 HTTP server 或公開 MCP route。

- `authenticate(trustedContext)` 回傳 `{principal_id, connection_ref}`。可信 host 必須以自身 session 與已綁定 connector 取得這些值；不能讓用戶選擇其未擁有的 connection。
- `readGrant(principal_id, selection_ref)` 回傳 `{principal_id, selection_ref, revision, active, connection, route, selection}`；`selection` 僅有 `{source, size_bytes, password_profile}`。其中 source 與 connection 沿用既有橋接的精確欄位，查詢字串才由前端提供。
- `resolvePassword(connection, profile, source)` 接既有 profile service。取得原檔前先檢查 profile 是否可用，真正解密前及回傳前再核對；不接受任何未知字串當密碼，也不把密碼回傳給前端。
- 所有身分／grant 先 clone，再驗證並凍結巢狀來源與連線，避免 callback 改變已授權的讀取目標。未知選項、身份失效、grant 撤銷／變動、profile 不可用皆固定錯誤，無自動 retry。

候選只接受 synthetic 前綴的 principal／connection／source／selection／profile ID，以及固定 `AES-256.pdf`、1,825 bytes 與既有 SHA；不是支援任意真實識別資訊的正式授權 adapter。讀取整合仍由 `invoke` 和 `readOriginal` 注入，沒有預設網路呼叫。

`trustedContext` 是由 server 注入的執行脈絡，**不能直接把前端 body、帳號字串或 `verified: true` 當作它**。`authenticate` 是可信 host 的必要依賴，必須接實際驗證 session 的機制；本輪注入合成 callback 只能驗證整合流程，不能證明 OAuth、cookie、MCP gateway 或 connector 身分安全。

授權綁定精確 principal、connection、provider、message、附件、檔名、SHA、profile 與 revision，不以相同檔名、寄件網域或使用者自稱帳號放行。Gmail 的 `gmail_raw` route **讀整封指定信的 raw**；可信 host 必須明確允許這個範圍，不能稱只讀 PDF。iCloud 使用精確附件 ID，原檔下載仍由可信 host 注入。

來源與引用延用既有橋接，不把合成選項 ID 當成 provider message ID，也不把 MIME 路徑冒充 Gmail attachment ID。完整引用可能包含私人內容，正式整合不能將它寫入公開 repo 或共用日誌。

## 尚未交付的正式產品

- 沒有可從手機使用的已部署查詢工具、登入 UI、session 驗證、帳號綁定或授權選項清單。
- 沒有新建憑證、正式秘密保管、任意真實 PDF 入口或信箱掃描；profile 仍只限公開假值與固定 fixture。
- 撤銷後的重核可以拒絕後續步驟或丟棄回應，但不能撤回已讀的郵件 bytes、已交給 parser 的字串，或強制停止同步解析。核對與遠端讀取也不是跨服務原子交易；核對後才變更授權，仍可能已有取件動作，不能保證零競態。
- 本機 callback 授權不是安全 sandbox。雲端 POST／每請求 CPU、正式解析隔離與真實資料驗收仍未完成。
- 每次 query 建立一個橋接，不代表跨請求併發配額或新的隔離工作程序；也尚無手機取消操作／硬中止契約。正式 host 仍須實作工作管理，不能把放棄結果當成解析已被終止。

本輪補的是既有橋接缺少的「不相信前端帳號、讀取前授權」接線與可重跑流程，不以本機測試通過代替正式身份驗收，也不勾選 #3 的整體正式 host／上線項目。

## 驗證

44/44 新測試與 8 個雙 provider demo 通過，完整既有回歸及建置通過，Worker hash 不變。獨立覆核另重跑 44/44、8/8，完成 6 個跨 principal／來源／撤銷／錯誤反例與 2 個 key-order 相容回歸。無失敗或跳過，不等於已執行 CI。

檢查時修正兩個具體問題：resolver 不得修改已授權來源快照；相同身分／grant 僅物件鍵順序不同不得被誤拒。現在逐欄比較兩個身份欄位及 17 個 grant 葉欄位；來源、profile 或 revision 真正變更仍拒絕。

[機器可讀驗證摘要](verification/synthetic-host-query-20261113.json)。原有 npm 與 PDF.js 警告仍保留，未安裝依賴或改環境設定。
