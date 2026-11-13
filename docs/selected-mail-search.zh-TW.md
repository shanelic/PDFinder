# 已選附件到文件搜尋的 Host 橋接

由 Jarvis 建立。`createSelectedMailSearch` 把精確取件計畫、既有 provider 解碼器及單文件搜尋候選接成一次呼叫。只以本機合成 connector 回應驗證；沒有新的真實讀信、寄信、公開入口或部署。

```sh
npm run test:mail-search
npm run demo:selected-mail
```

Demo 有 4 條本機路徑：Gmail／iCloud 各跑一份首次取得的生成三頁 PDF 及已知雜湊的 AES-256 fixture。兩者都使用真正 parser，connector 及下載則是 fake。輸出明示 `live_mail_reads: 0`，不能作為 live E2E 證據。

## 接線

```js
const bridge = createSelectedMailSearch({
  connection: {provider, account_ref, connection_ref},
  route, // 必須明選 gmail_raw 或 icloud_original，且與 provider 一致
  invoke, readOriginal, loadParser, resolvePassword, limits
});
const result = await bridge.search({
  source: {source_ref, provider, account_ref, message_id, attachment_id, filename, sha256},
  size_bytes, query, password_profile
}, {signal});
```

輸入規格與預算先經 `prepareSelection` 核對並快照，**通過才會呼叫 invoke**。所有 callback 由可信 host 明確注入，沒有預設外連或 connector client。

- Gmail：僅 `read_email({message_id, format: 'raw'})`，再使用既有保守 MIME selector 選唯一 filename／size。這會讀整封指定信的 raw，必須由 host 明確授權；不是 `read_attachment` 失敗後的自動替代。attachment_id 要明確為 null，不把 MIME 路徑當 Gmail ID。
- iCloud：僅 `get_message({message_id, attachment_ids:[完整選取ID]})`。驗證實際已觀察的 file descriptor，再將原檔交給注入 reader。回應含其他已下載附件、錯誤訊息／附件 ID 或陌生檔案參照都拒絕。
- 只接受工具的 `structuredContent`。MCP `isError: true`、provider `error` 或未知結構不當成文件；不從文字展示或預覽拼回原檔。
- 一個 bridge instance 只容許一個在途工作；失敗不自動重試、不搜尋信箱、不改選其他附件。

帳號與 response 的可信關係依賴 host 的已授權 connector 綁定；工具 envelope 本身沒有獨立證明帳號身份。`connection_ref` 不是新憑證，也沒有因提供它而取得任何權限。

## 首次取件沒有預先 SHA 的處理

實際郵件 metadata 通常不含 PDF 的 SHA-256。現在可將 `source.sha256` **明確設為 null**，表示沒有先前內容 pin；不可省略欄位或以任意字串代替。

- 有預期 SHA：必須完全匹配，回 `integrity.comparison: matched_expected`。
- 沒有預期 SHA：選取身份、檔名、長度仍必須符合，之後計算原檔 SHA，回 `computed_without_prior_hash`，不是「已比對既有 hash」。
- 兩種結果都把實際計算的 SHA 寫入記憶體中的來源引用。若需要 profile，resolver 收到的也是計算後的 frozen source。原輸入不會被修改。

首次計算的 hash 是內容關聯，不是郵件真實性、來源簽章或防篡改的外部證據。沒有先前 pin 時，不能偵測同訊息／檔名／長度下供應者傳回不同 bytes；仍須信任已授權取件通道。一般文件不使用合成 fixture oracle 保證擷取完整。

## 路徑有效上限不同

- 文件處理候選及 iCloud reader 邊界最多 2 MiB 原檔。
- Gmail raw decoder／MIME **整封訊息最多 1 MiB**，包含 base64、MIME headers 及其他內容。因此 Gmail 路徑的 PDF 可用大小更低，不能宣稱 2 MiB 都支持。僅作必要前置判斷，PDF 宣告超過 786,432 bytes 就不呼叫工具；低於此值也可能因 envelope 開銷而被拒絕。
- 其他 MIME 深度、數量、headers、唯一名稱與 encoding 限制沿用[既有契約](mime-and-icloud-handoff.zh-TW.md)，未為了此橋接放寬。未實作 Gmail 一般附件直接下載的新 fallback。

超限、格式、密碼、無文字與引用截斷語意沿用[單文件契約](document-processing-contract.zh-TW.md)。取消不是硬中止；cleanup_failed 後正式 host 不應在同一工作實例自動重試。引用包含私人來源 ID，完整結果不能直接公開紀錄。

## 下一步而非再造框架

已有本機完整功能路徑；2026-11-13 另以已授權的一封已知假密碼合成信，完成[真正 Gmail／iCloud 取件→解密→引用](live-synthetic-mail-acceptance.zh-TW.md)，也把新取得回應接入本橋接成功。這仍由可信 host 注入回應／原檔，不是已部署的自動化 connector。正式雲端功能／CPU仍待可用通道，不擅自擴張公開入口、接受真實資料、建立秘密或產生費用。

驗證：28/28 橋接測試、36/36 文件測試、78/78 MIME／handoff 與全部既有回歸通過，4 個橋接 demo 成功。獨立覆核當時 116 項合併回歸及 6 個反例通過；之後只新增一個直接 MIME null-hash 測試，完整回歸已重跑。[機器可讀紀錄](verification/selected-mail-search-20261112.json)。

後續另補[合成 trusted host query](synthetic-host-query.zh-TW.md)：前端只有 selection_ref/query，先以注入的 host 身分與精確 grant 核對再進入本橋接，並於各階段重核。這填補本機整合的讀取前授權位置，仍需要正式 session／connector 實作，不能因 callback 回傳身分就當作已驗證登入。
