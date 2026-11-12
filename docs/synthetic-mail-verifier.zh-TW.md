# 同一合成附件的雙信箱驗收入口

由 Jarvis 建立。這是可重跑的本機功能驗收，不寄信、不部署，也不承諾正式安全隔離。

```sh
npm run test:mail-verifier
npm run verify:synthetic-mail
```

第二個命令本機生成固定 EML、模擬已觀察的 Gmail raw 與 iCloud 原檔 envelope，兩者都接真正 PDF.js AES-256 解析，再核對相同 SHA、頁碼、Unicode 字元範圍與引用文字。輸出明寫 `live_provider_verification: false`，不會呼叫信箱或網路。

## 可在未來原檔實測重用的部分

`createSyntheticMailVerifier({connection, loadParser, readOriginal})` 提供 `verify({source, payload}, {signal})`：

- 只允許 repo 的 `AES-256.pdf`，1,825 bytes，SHA-256 `88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c`。
- 解密只用已公開假密碼，不提供真實密碼輸入或持久保管功能。
- Gmail 使用明確提供的 raw envelope，再唯一選取 MIME 附件；沒有從失敗工具自動改讀其他信。未知 Gmail 附件 ID 保持 null。
- iCloud 使用已觀察的原檔 descriptor，透過明確注入的 host reader 取得 bytes，重核 ID、長度與 SHA；模組沒有預設下載器。
- `source` 保留 host 實際選取的 opaque message／attachment ID，不改成假的 provider ID。它不受舊 normalized demo API 僅允許 `synthetic-*` ID 的限制。
- 解析結果必須與固定 fixture 的完整已知文字 oracle 相符，才產生查詢 `PDF` 的來源引用。

完整回傳含私人來源 ID，只供可信 host 在記憶體使用。`summary` 刻意不含帳號、郵件 ID、下載連結或密碼，可用於去識別化紀錄。呼叫者仍須檢查實際輸出後才能公開，不應將完整回應直接寫入 repo。

## 證據界線

本輪兩路徑是合成回應，不是新寄信／新下載的 live E2E。先前歷史 2,476-byte 附件的原檔交接證據仍成立，但其假密碼無可恢復紀錄，未用本 fixture 的成功冒充舊附件解密。

`connection` 與原始回應綁定仍由可信 host 負責，這個 helper 不是登入、郵件權限或帳號歸屬證明。注入 parser 是可信程式依賴；`expected_parser_version` 只是預期版本標籤，不是遠端版本查驗。測試使用 repo 的真正 parser。

取消會在 await 邊界複核並丟棄已取消結果，不保證中止卡住的 reader 或 parser。自有 PDF buffer 在結束時使用預先取得的 TypedArray fill 原語清零；若 parser detach buffer 導致清理無法完成，回傳固定清理失敗，不放行成功結果。這不保證 JavaScript 字串、parser、外部 reader 副本或執行環境安全抹除。錯誤訊息使用固定允許代碼，不轉發工具／下載器的原始錯誤。

待使用者另行同意寄送可重現合成信後，才能以同一驗收邏輯核對真正 Gmail／iCloud 取件、解密與引用。目前沒有寄送。Cloudflare Free CPU、正式雲端呼叫與產品級安全仍未完成。

本輪 28/28 新回歸及完整既有回歸通過；獨立覆核 28/28 與 3 個反例符合預期。[機器可讀紀錄](verification/synthetic-mail-verifier-20261112.json)。
