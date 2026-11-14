# 合成 profile 的逐工作 revision guard

2026-11-14，由 Jarvis 記錄。這是未發布的本機候選，只處理既有固定合成 fixture 與公開假值，**不是正式 vault，也沒有連接或保管真實密碼**。

## 本輪不同於已完成的測試

既有 profile 已驗證 CAS 不覆蓋、重啟保留、來源範圍、撤銷及解析期間丟棄 revoked 結果。本輪發現另一個窄缺口：host 會在邊界重查 profile 是否仍有效，但沒有綁定同一工作的 revision。

已用真 PDF.js 與假 provider 重現：一份工作解析後、回傳前，profile 從公開假值 A 換成 B，再換回 A（revision 1→2→3），原 host 仍回 `matches_found`。這不表示密碼解錯，而是工作跨越了替換事件，最後只看值相同或仍 active 無法辨認。此為本機合成觀察，不是正式服務漏洞或真實資料暴露的證據。

## 最小候選

`createSyntheticProfileRevisionGuard({profiles})` 產生與既有 host 相容的 `resolvePassword(connection, profile, source)`。**每個查詢建立一個 guard**，不可將它當全域密碼快取或多工作共用 resolver。它重用既有 profile 服務，不新增秘密輸入、metadata 後端或雲端 binding。

- 綁定精確 profile／connection／來源 scope，輸入先快照，不讓等待中的呼叫者改選另一來源。
- 首次觀察到 active metadata 時固定 revision。查值前、查值後及 host 的後續查值邊界，都須維持同一 revision。
- 替換、換回原值或同值新 revision 都視為這份工作的衝突，不偷偷換成新值繼續。新工作可另建 guard 使用新 revision。
- 撤銷、儲存錯誤、畸形 metadata 或不受支援的值拒絕；失敗後同一 guard 不自動重試／恢復。
- 同一 guard 的重疊呼叫拒絕，不新造鎖或重試框架。獨立工作各自持有 guard，可以並行。
- 管理和失敗輸出只使用既有固定錯誤，不回傳假值或底層例外；resolver 將必要的公開假值交給 parser 仍是明確例外。

用法的關鍵是建立位置，不是新增對外 endpoint：

```js
async function querySelected(input, trustedContext) {
  const resolvePassword = createSyntheticProfileRevisionGuard({ profiles });
  const host = createSyntheticHostQuery({ ...trustedHost, resolvePassword });
  return host.query(input, trustedContext);
}
```

這是可選的本機接線，未自動改寫所有既有 host、MCP、私人服務或 Worker。是否採用此「工作不得跨 profile revision」語意屬產品選擇，不是使用者原始指示或平台硬性規則。

## 不能保證的事情

- describe／resolve／再次 describe 不是跨服務交易，也不是持有租約。最後一次檢查之後、結果送達之前仍有競爭窗口。
- 依賴可信且能反映當前 revision 的 storage。惡意 adapter、舊副本、回滾成相同 revision 或分散式一致性問題不在保證內。
- 已交給 parser 的字串不能收回或保證抹除；拒絕交付不等於停止底層 CPU、取消外部讀取或收回已讀原檔。
- 固定去敏錯誤與本模組無日誌，不證明 dependency、作業系統或平台日誌不洩漏。不得拿本機 console 攔截當正式日誌政策。
- 尚未接上真正 Secret 版本與 metadata revision 的發布／替換順序；正式初次輸入、保管、身份、存取、歷史版本與撤銷傳播仍需各自授權和驗收。

本輪不重做已完成的檔案持久化、不部署、不讀取信箱或呼叫雲端解析器。#3 的正式 vault／上線項目與 #1 的 Cloudflare CPU 維持未完成。

## 本輪驗證與安裝限制

18/18 新 focused cases 與既有 profile 51、host 44 合併回歸共 **113/113** 通過，零失敗／跳過／取消。包括真 PDF.js 的無guard ABA對照、兩個provider加guard拒絕、新工作可正常使用revision3、等待查值時替換／撤銷、同值新revision、重疊呼叫與錯誤去敏。這些僅用fake provider與公開合成值，不是信箱或正式vault驗收。

本輪嘗試離線乾淨安裝時，既有npm快取缺少lockfile指定的 `zod@4.6.7`，`npm ci --offline` 回 `ENOTCACHED`；沒有改鎖版、下載套件或繞過限制。該命令清掉本機已安裝依賴後失敗，現有MCP SDK匯入為 `ERR_MODULE_NOT_FOUND`，因此**本輪未執行完整 `npm run verify` 或重新建置**，不沿用前輪全套成功成績。guard／profile／host檢查使用repo內的vendored PDF.js與Node內建模組，可獨立重現：

```sh
node --test tests/synthetic-profile-revision-guard.test.mjs tests/synthetic-password-profiles.test.mjs tests/synthetic-host-query.test.mjs
```

`npm run test:profile-revision` 已加入驗證指令清單；完整回歸須先經允許的安裝流程恢復相同lockfile依賴。既有Worker產物hash未變，但不是本輪重新建置的證據。[本輪機器紀錄](verification/synthetic-profile-revision-20261114.json)。

獨立覆核同版18/18與3個額外反例通過：metadata等待期間重疊、未增revision但scope_count改變，以及source_ref僅作correlation。沒有增加外部依賴或真實資料範圍。離線安裝錯誤是快取不足，並非本輪觀察到的網路政策拒絕。
