# Profile 保管選擇：先驗證狀態，再選正式後端

由 Jarvis 建立，2026-11-13。這是設計評估，不是已啟用的密碼服務；本輪沒有建立雲端資源、憑證、付費或秘密。

## 目前選擇

先保留既有 `read(id)`／`compareAndSwap(id, expectedRevision, nextRecord)` 邊界，用本機臨時檔案驗證 profile 狀態在程序重啟後仍保留。只保存公開假值 ID 與合成來源，不保存 PDF、解析結果、使用者密碼或真實郵件識別資訊。這一步解決「重啟後是否還能重用／撤銷」，**不解決正式秘密保管、雲端持久磁碟、使用者身份或部署**。

不會把臨時 JSON 換個名稱就稱為 vault，也不新增自行管理的加密金鑰。若金鑰與密文放在同一未受保護的執行環境，並沒有建立所需的秘密存取邊界。

## 最小正式方向

少量、由擁有者管理的固定 profile，優先考慮最終執行平台既有的 **runtime Secret** 存秘密；一般 metadata 只存 secret 參照、精確來源範圍、revision 與 revoked 狀態。此為設計選擇，不是本輪部署或費用承諾。待正式解析通道與平台確定，再接真實後端，避免現在另開服務。

- Cloudflare 的 Worker Secret 是加密文字 binding，可由 Worker 的 `env` 等方式讀取；Dashboard 設定後不顯示值，**不代表執行中的程式看不到值**。新增／刪除 secret 可能需要部署或產生版本，不是一般即時資料庫寫入。[官方 Secrets 文件](https://developers.cloudflare.com/workers/configuration/secrets/)
- Sites 官方說明擁有者可在站點 Settings 新增、更新、移除 hosted variables 與 secrets，並要求不要放入 prompt、附件或站點內容。這提供日後直接輸入的產品入口，但不證明本 repo 已接入，也不替代真實密碼傳輸授權。[官方管理說明](https://learn.chatgpt.com/docs/sites/managing-a-site#configure-runtime-environment-values)
- 需要動態、多程序的 metadata CAS／撤銷時，Cloudflare SQLite-backed Durable Object 的交易與強一致儲存是候選。仍須實作 revision 條件、身份授權、確認實際帳號限制／成本並取得建立資源授權；**強一致資料庫不等於秘密庫**。[官方儲存語意](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- 不選 Workers KV 作要求即時生效的撤銷權威：官方明示 eventual consistency，其他位置可能需 60 秒或更久看到更新，且不適合要求原子讀改寫的情境。[官方一致性說明](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency)

## 還需驗收的正式邊界

1. 使用者直接安全輸入及指定儲存目的地；不要請他把密碼貼在聊天或 repo。
2. 可信 host 在取件前核對帳號／附件授權，再將實際 bytes 的 hash 綁到 profile；字串相同不是身份證明。
3. Secret 版本與 metadata revision 的替換順序、部分失敗及回復，不能先宣稱跨服務交易成立。
4. 撤銷拒絕後續取得；已取得值的在途解析可能完成。舊部署、備份、歷史版本與在途副本的生命週期另行驗收，不宣稱即時全域抹除。
5. 執行程式可讀秘密，能更改部署程式的管理者也可能令程式輸出秘密；runtime Secret 不防惡意發布者，正式解析隔離與去敏仍待驗收。

這些是後續上線條件，不阻擋目前只用假資料的功能開發。#1 的正式雲端呼叫與 CPU 量測、#3 的正式資料與上線驗收仍未完成。
