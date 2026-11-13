# 合成 profile：可重啟本機持久化

由 Jarvis 建立。這是 Node host 的本機測試 adapter，**不是正式密碼庫、雲端持久儲存或手機端可用產品**。只接受固定合成 PDF、兩個公開 value ID 及假來源識別，不讀信、不寄信、不部署、不收使用者密碼。

```sh
npm run test:profile-storage
npm run demo:profile-restart
```

Demo 建立自己的臨時目錄，依序啟動六個全新 Node 程序：建立、重開、替換錯誤假值、恢復正確假值、撤銷、重開已撤銷狀態。每個程序以 fake Gmail／iCloud 回應接真 PDF.js 和既有搜尋，總共 12 個情境；結束刪除自己的測試目錄。重開後不用重新 create profile，不再依靠前一個程序的 Map。

## 可替換邊界

`await createSyntheticFileProfileStorage({directory, initialize: false})` 回傳原本的 `read(id)`／`compareAndSwap(id, expectedRevision, nextRecord)`，可直接注入 `createSyntheticPasswordProfiles({storage})`。不改搜尋或 parser，也沒有引入套件。

- `directory` 必須是 OS tmp 直下、名稱符合 `pdfinder-synthetic-profiles-*` 的既有測試目錄；不是任意路徑檔案 API。使用 `mkdtemp` 建立獨立目錄。
- **只有首次建立**明確傳 `initialize: true`，以 exclusive create 建立固定 `profiles.json`；已存在時拒絕。一般 reopen 不會自動建立缺失檔案。檔案遺失、損壞不能被當成空庫，否則撤銷狀態會消失。
- JSON 保存 `format: 1` 與完整 records；至多 32 KiB、16 個 profiles。每次讀取／修改都驗證整份資料與固定 profile schema，不只驗證被查詢的那一筆。
- 公開 value ID 只有 `fixture-aes256`、`wrong-test-value`；revoked 記錄的 value_id 為 null。檔案沒有真正密碼或 PDF bytes。此 adapter 另要求合成 connection/message/account ID 或 account 的 `example.invalid` 地址，**不能直接接先前 live 信的 opaque metadata**。
- 每次操作取得固定 exclusive lock，重新讀取目前 revision；競爭直接失敗，不重試或偷偷覆蓋。成功修改先寫 `profiles.pending`，再 rename 成資料檔。不允許改來源範圍、復活 revoked ID 或用過期 revision 覆蓋。
- 鎖與 pending 檔殘留時不猜測持有者或自動刪除。需要可信測試 host 核對後，重新建立自己的測試環境。這是明確故障，不是找不到 profile。

## 錯誤與信任界線

adapter 使用既有固定錯誤類別，不轉發檔案系統的路徑、原始訊息或資料值。透過 profile service 時，底層讀寫失敗統一成 `storage_unavailable`。JSON/schema 無效、競爭、資料檔缺失都不能被說成「未提交」：特別是 rename 已完成但關閉／釋放鎖回應失敗，寫入可能已生效。**不自動重試**，先唯讀核對 revision；如果連讀取都被殘留鎖擋住，結果維持未知。

這只是合作中的本機程序鎖，不防本機目錄擁有者、惡意修改、父路徑競態或舊檔回滾。最終檔案的 symlink 拒絕與有限讀取不等於完整 sandbox。沒有改 chmod、安全設定、網路規則或系統權限。

未提供 fsync／斷電／故障磁碟耐久性保證、備份恢復或安全抹除。tmp 可能被作業系統或執行環境清理，所以「跨程序重啟保留」不等於永久保存。撤銷只阻止後續取值，先前已取得值的解析仍可能完成。

## 正式路徑

本輪只完成可替換 persistence 契約與假資料驗證。推薦後續採平台 runtime Secret 保存少量秘密、transactional metadata 保留範圍與 revision，而不是把本 JSON 檔用來保存實際密碼；詳見[保管選擇與官方依據](profile-storage-options.zh-TW.md)。正式平台、身份授權、secret 更新與 metadata 的一致性、CPU／隔離及真實資料驗收都仍未完成，不勾選 #3 的正式保管或發布項。

## 驗證紀錄

本輪 23/23 focused 測試、6 個全新程序的 12 個雙 provider 情境、完整既有回歸及建置通過，無失敗／跳過。獨立覆核重跑 23/23 與 12 情境，另確認兩個反例：rename 後釋放鎖故障會回失敗但資料已提交，且不重試；7 筆合法 records 的 29,375 bytes 之後，第 8 筆因 32 KiB 限制拒絕並保留原檔不變。後者確實不是先撞 16 筆上限。Worker 建置 hash 不變，本模組未被部署入口引用。Demo 的 `live_provider_calls: 0` 指注入 fake provider，並非網路封鎖量測。

[機器可讀驗證摘要](verification/synthetic-profile-persistence-20261113.json)。保留原有 npm 設定與 PDF.js modern-build 警告，沒有為消除警告變更環境或重新安裝。測試不等於 CI 已執行。
