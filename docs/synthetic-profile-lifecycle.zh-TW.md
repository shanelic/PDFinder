# 合成密碼 profile：重用、限定來源、替換與撤銷

由 Jarvis 建立。這是未發布的 host 功能候選，**不是密碼庫或正式密碼保管服務**。只接受兩個硬編碼公開測試值的 ID、固定 AES-256 合成附件及精確來源；沒有明文密碼輸入欄位，不接受使用者密碼，也沒有網路、磁碟或雲端資料庫。

```sh
npm run test:profiles
npm run demo:profiles
```

Demo 透過既有單文件搜尋橋接、fake Gmail／iCloud 回應及真 PDF.js，驗證同一 profile 重複使用、改成錯誤假值後拒絕、換回正確假值後成功，以及撤銷後拒絕。命令不寄信、不讀真正信箱、不部署。

## 最小 API

`createSyntheticPasswordProfiles({storage})` 只依賴注入的 `read(id)` 與 `compareAndSwap(id, expectedRevision, nextRecord)`。本庫唯一實作 `createInMemorySyntheticProfileStorage()`，只在一個 Map 實例內原子修改、回傳資料副本；**重啟就失去全部狀態**。寫入的是公開 value ID，不是經加密保管的秘密。

| 操作 | 行為 |
| --- | --- |
| `create({profile_id, value_id, scopes})` | 新增 revision 1，1–8 個精確範圍；不覆蓋既有 ID |
| `replace({profile_id, expected_revision, value_id})` | 更新公開假值並增 revision，不擴張原有來源範圍 |
| `revoke({profile_id, expected_revision})` | 改為 revoked、清空 value ID、保留 tombstone；相同 ID 不復活 |
| `describe(profile_id)` | 只回 profile ID、revision、狀態與 scope 數，不回假密碼或來源清單 |
| `resolverFor(connection)` | 產生綁定可信 host connection 的 `resolvePassword(profile, source)` callback |

只有 `fixture-aes256` 與 `wrong-test-value` 兩種 value ID；前者對應既有公開 fixture 密碼，後者刻意供錯誤處理測試。不存在任意 value／password 輸入或外部秘密匯入功能。管理操作只回 metadata，resolver 將必要的公開假密碼交給 parser 是明確例外。

## 精確來源與既有搜尋接線

`createSyntheticProfileScope(connection, source)` 產生的範圍綁定 provider、account_ref、connection_ref、message_id、attachment_id、檔名與內容 SHA。沒有寄件者／網域 wildcard 或相同檔名自動放行；`source_ref` 只是這次請求的關聯值，不用作權限。Gmail raw 的 attachment_id 維持 null，iCloud 使用明確 MIME 附件 ID，目前窄子集合要求數字／點分隔且不超過 32 字元，不能宣稱任意 provider ID 格式皆支援。來源／連線 ID 沿用既有橋接的非空、長度與控制字元限制，保留 opaque ID，不要求把真正合成信的來源改名為 synthetic。profile ID 仍使用 synthetic 前綴；固定附件 SHA 與公開 value ID 才是本模組不接受真實文件／密碼的限制。

將 resolver 傳給現有 `createSelectedMailSearch` 的 `resolvePassword`，每次請求都重新讀 storage，沒有密碼快取。解析器收到的來源 SHA 已由原檔重新計算；無預先 hash 的一般搜尋路徑仍須在計算後符合本模組固定 fixture pin。

**這個檢查發生在取得原檔、計算 SHA 後，不是讀信前的授權機制。** 使用哪個連線、是否允許讀這封信／附件，仍是可信 host 的責任。傳入一個 connection 字串不會證明身份或取得權限；管理 API 也不是公開可呼叫的帳號服務。

## 失敗、並行與撤銷邊界

- revision 不一致或並行操作失去 CAS 時拒絕，不覆蓋較新的修改或讓已撤銷 profile 復活。
- storage 例外、畸形紀錄或非 boolean CAS 結果使用固定去敏代碼；不將底層訊息、值或來源回傳。
- 寫入回應不確定時不自動重試，也不宣稱沒有生效。可信 host 可唯讀 `describe` 核對；若無法核對，就保持未知。
- 既有搜尋會把無法取得／不允許的 profile 統一表達為 `profile_unavailable`，不將撤銷誤報成 PDF 沒有命中。
- 撤銷只保證在這個受信任 storage 上的**後續 resolution** 拒絕。先前已交給 parser 的字串或已開始的請求仍可能完成，不能稱即時全域撤銷、安全抹除或強制停止工作。
- 不防惡意或回滾的 storage adapter、不提供跨程序一致性、使用者登入、加密保管、權限管理、審計或正式資料保存政策。若日後接入真實儲存／密碼，需要另外設計、授權及驗收，不能因本機測試通過就替換成正式 vault。

本輪 51 項新增測試與 10 個雙 provider demo 通過；另重用已取得的真正合成信回應／原檔做 10 個生命週期情境，沒有新增郵件外呼。全部既有回歸與建置通過，Worker hash 不變。最終獨立覆核另重跑 51/51 與 10 個 demo，並核對 accessor 與 3 個 opaque 來源錯配反例。[本輪機器紀錄](verification/synthetic-profile-lifecycle-20261113.json)。獨立覆核發現的 storage accessor 改變值問題，已改為先 clone 再驗證同一快照，避免驗證與使用不同紀錄。Cloudflare CPU／正式呼叫仍在 [#1](https://github.com/shanelic/PDFinder/issues/1)，正式 profile 權限、文件與發布驗收仍在 [#3](https://github.com/shanelic/PDFinder/issues/3)。
