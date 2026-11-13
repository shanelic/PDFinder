# Named Preview 單份合成 smoke：待執行 runbook

Jarvis，2026-11-13。**本輪只做官方文件／schema 查核與離線合成驗收，未建立 Preview、呼叫線上 Worker、開日誌或量得雲端 CPU。** #1、#3 維持 open。

## 目標與現在缺什麼

先取得 **1 份 AES-256 合成 PDF 的真實回應**，再把平台 invocation 與該請求對上。只有首份成功後才考慮 3–4 個代表案例，不必跑 52 次。功能成功與 CPU 證據分開驗收，不能因為尚未確認版本映射而阻擋第一份功能 smoke，也不能把未知 CPU 寫成 0。

[官方 named Preview 測試方式](https://developers.cloudflare.com/workers/previews/test-and-debug/)是由 HTTP client 呼叫 Preview URL，觀測與 production 分開；沒有找到現有 Cloudflare MCP 代送這個 POST 的正式 invoke 端點。既有 MCP 外連拒絕仍有效，不能用換網址、代理或另一執行器規避。[MCP 安全限制](https://github.com/cloudflare/mcp/blob/main/AGENTS.md#security-considerations)

**最小剩餘決定：**平台提供正式允許的指定目標 POST 通道；若沒有，由擁有者在自己的裝置操作一次正式 HTTP client。現在只準備材料，不要求批准或執行。手機 Shortcuts 官方支持 POST，但保留本次回應 headers、時間與 named Preview 觀測的整套流程未驗收，不能承諾手機一鍵完成。[Apple POST 文件](https://support.apple.com/en-lamr/guide/shortcuts/apd58d46713f/ios)

## 固定材料，不重建測試框架

以 feature 分支已驗證基準 `6bdb55abe0e64d3d5ea8ffdf6f08496cad034959` 為起點；執行時記錄實際 commit，重建並核對同一產物：

- `npm run build` → `dist/worker.mjs`：**3,740,357 bytes**，SHA-256 `6842618014df5b10d24bb618acbfb3b2556066e2074cf076be621f664797bf79`。
- 產物包含 **7 份固定合成 fixture**，不是只上傳一份。此次只呼叫 `AES-256.pdf`；不改現有 Worker 或 oracle。
- 固定 fixture：1,825 bytes，SHA-256 `88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c`。
- [固定 request body](examples/preview-smoke-request.json)：`{"fixture_id":"AES-256.pdf","password_mode":"correct"}`。
- 既有入口只收 **POST `/benchmark`**，不得有 query/hash；`Content-Type` 必須是 `application/json`，body 上限 128 bytes。不可偷偷加 `run_id` body/query。當需要額外 correlation header 時，必須先確認平台事件真的保留它，不能假設。
- 環境僅本次 `BENCHMARK_ACCESS_TOKEN` 與 `BENCHMARK_EXPIRES_AT`。token 32–512 個可印 ASCII；expiry 是 UTC 秒精度。程式允許最長 30 分鐘，**不代表授權延長既定短效窗口**。排隊／批准／材料準備放在產生有效金鑰之前；人工交接若無法在已同意窗口內完成，先停，不反覆提交必然過期的請求。
- body 1,500 ms、解析 5,000 ms、清理 100 ms 是程式設計預算，不是 Cloudflare CPU 限額或硬性中止保證。客戶端總耗時也不是 CPU。

## 執行時的最小準備與授權

下列是**未執行的操作清單**，不是已取得新權限的聲明：

1. 先確認正式 POST 通道與操作者就位，再做任何雲端寫入。適用授權須涵蓋單一 named Preview、Preview routing、必要 invocation logs、短效金鑰與收尾；不能將舊 production smoke 授權自動擴成任意新服務。
2. 只讀核對正確測試 Worker、production 版本、路由、logs／Issues／Tail 基準，以及完整 Preview inventory。不要讀 secret 值。現有 #1 的 0 Preview 是當時觀察，不是永久狀態。
3. 確認仍在 Free、當日定價與帳號共享用量。現在官方列 Free 100,000 requests/day、10 ms CPU/request、128 MB；Logs 200,000 events/day／3 天保留。**2026-12-01 Observability 改價**，執行當日重核；不升級、不付款，不以免費額度保證永遠零費用。[限額](https://developers.cloudflare.com/workers/platform/limits/)／[Logs 定價](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing)
4. 使用一個新的、可刪除 named Preview；不設儲存、service binding、migration 或 Access 新資源。create/update 的 `ignore_base_config`／`ignore_defaults` 要明確處理並回讀 binding 名稱／類型。**缺少 base config 欄位不等於沒有繼承秘密**；官方說 base secrets 在建立新 Preview 時複製。[配置](https://developers.cloudflare.com/workers/previews/configuration/)
5. 只開必要 invocation logs，取樣 1；不開應用程式 console logs、Issues、traces、Logpush、Tail destinations。短效金鑰不放 URL／repo／自訂日誌。平台是否遮蔽所有敏感 headers 尚未驗收，不能承諾零留痕。
6. 取得 API 實際回傳的 deployment URL，不自行拼網址。路由開關可能暴露該 Worker 其他既有 Preview/deployment URL，須依 inventory 確認影響；`noindex` 不是存取控制。[Preview 存取](https://developers.cloudflare.com/workers/previews/custom-domains/)

管理 API 的 create/read/update/delete 與 telemetry query 是不同權限：schema 明列 update/delete 的 **Workers Scripts Write**、查詢的 **Workers Observability Write**；create 部分 scope 欄位未列出，不可解讀為不需授權。現有帳號能否完成 named Preview 寫入／觀測查詢均未實測。Preview 數量達上限可能自動淘汰舊項目，接近限額時不建立。可用 API 路徑見文末。

## 若必須由擁有者一次操作

提供給操作者的最小材料：**實際 HTTPS deployment URL + `/benchmark`、固定 JSON、已同意期限內的測試金鑰、以下收集步驟**。不需要給 HTTP client Cloudflare API token 或 PDF 密碼。金鑰若需跨工具／私訊交付，須使用允許的安全交接並符合機密資料確認規則；本 repo 不提供有效金鑰或交付管道。

以下僅為 **未執行 Bash 範本**。預設 `.invalid` 會停止；之後只能由已授權操作者填入 API 回傳且核對過的目標。在本 repo 根目錄操作，不使用 `-L`、verbose／trace 或自動重試。curl `-q` 關閉預設 config，防止隱藏 retry/redirect。金鑰經 stdin config，不放 argv、歷史、檔案或 URL。[curl 官方選項](https://curl.se/docs/manpage.html)

```bash
URL='https://example.invalid/benchmark' # 待核對的實際 URL；不是現在可執行目標
case "$URL" in https://example.invalid/*) echo '尚未設定正式授權目標'; exit 1;; esac
umask 077
OUT=$(mktemp -d)
read -r -s -p '短效測試金鑰：' BENCHMARK_TOKEN; printf '\n'
# 未來金鑰採 64 字元 hex，避免 config quoting；現在不產生金鑰。
[[ "$BENCHMARK_TOKEN" =~ ^[a-fA-F0-9]{64}$ ]] || { unset BENCHMARK_TOKEN; exit 1; }
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$OUT/start.private"
printf 'header = "Authorization: Bearer %s"\n' "$BENCHMARK_TOKEN" |
  curl -q --config - --proto '=https' --request POST \
    --header 'Content-Type: application/json' \
    --data-binary @docs/examples/preview-smoke-request.json \
    --retry 0 --max-redirs 0 --connect-timeout 10 --max-time 20 \
    --dump-header "$OUT/headers.private" --output "$OUT/body.private" \
    --write-out '{"http_status":"%{http_code}","wall_seconds":%{time_total}}\n' \
    "$URL" > "$OUT/client.private"
CURL_STATUS=$?
unset BENCHMARK_TOKEN
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$OUT/end.private"
printf '%s\n' "$CURL_STATUS" > "$OUT/exit.private"
printf '僅一次嘗試；不要重送。私人結果目錄：%s\n' "$OUT"
```

20 秒是客戶端等待上限，不是延長金鑰期限或 CPU 限額。timeout 可能已抵達 Worker，不自動再 POST。原始 headers/URL 可能含識別資料，先留私人記錄，公開 repo 只放去識別摘要。HTTP 操作者返回後，由持有既有管理權限的一方立即清理，不要求操作者另外管理 Cloudflare。若無人能負責確定收尾，就不要開啟入口。

## 一次回應如何驗收

**功能：**HTTP 200，既有 `synthetic_protected_candidate_v1` 全部固定成功欄位、parser `6.2.108`、上述 bytes/hash、`exact_fixture_match`、1 頁、`text_found`，以及有效 coverage 診斷。coverage 本身明示 `not_a_completeness_proof`，不能把它當一般文件完整性保證。

**平台對應：**記錄 HTTP response 的 `Cf-Ray`、實際 URL、窄 UTC 時間窗；以 metadata event ID／request ID 保留單一 invocation 身分。Ray ID 可帶 colo suffix，而且[官方不保證唯一](https://developers.cloudflare.com/fundamentals/reference/cloudflare-ray-id/)，不能只憑 Ray 選一筆。

查詢 `POST /accounts/{account_id}/workers/observability/telemetry/query` 時用 `view: "events"`、`dry: true`、毫秒 timeframe 與必要 filters。先從官方 keys/values 或實際 schema 確認 filter key，不猜 dataset。`dry` 只避免保存查詢結果，不刪除已收集日誌。不能採 default calculations 代替 invocation。結果必須 `run.status=COMPLETED`，完整處理 cursor/count；不完整分頁不等於沒有事件。

本輪核對的官方 API envelope 為 `result.events.events[]`：

| 欄位 | 用途／不可混用 |
| --- | --- |
| `$metadata.id` | 事件 ID／分頁 cursor；不是 Ray 或 Worker 版本 |
| `$metadata.rayId` | 與 response Cf-Ray 合併其他 context 比對 |
| `$metadata.requestId`、`$workers.requestId` | invocation 關聯，不能假設等於 Ray |
| `$metadata.url`、`timestamp` | 精確目標與窄時間窗 |
| `$workers.scriptName`、`preview.id` | 精確 Worker／named Preview |
| `$workers.scriptVersion.id` | Worker script 版本；不是 PDF.js parser_version |
| `$workers.cpuTimeMs`、`wallTimeMs` | 單 invocation 毫秒，分開記錄 |
| `statistics.elapsed` | 查詢本身耗時，絕不是 Worker CPU |

**仍未核實的映射：**named Preview deployment GET 回傳 deployment `id`／`number`／`urls`，目前 schema 沒有 `script_version_id` 或 `version_id`。不能將 deployment ID 填成 scriptVersion.id，也不能從待驗事件反過來宣稱「獨立核對過版本」。可先保留實際 deployment URL、bundle hash 與功能結果；CPU 證據標 `version_unverified`，待官方資料完成映射。這是證據缺口，不是解析失敗。

`npm run test:preview-evidence` 與 `npm run demo:preview-evidence` 純離線驗證上述關聯及固定失敗分類，不讀真實帳號、不做 HTTP。驗證器信任 host 提供的資料來源及 expected mapping，不驗證平台簽章、權限或資料真實性。保守支援目前 schema dialect，不靜默猜測其他格式。

| 狀況 | 正確結論 |
| --- | --- |
| 可信 host 明確拒絕傳輸 | transport policy denied；不再換路徑重試 |
| 只有 HTTP 403 | forbidden，層級未知；不是已證明 parser／CPU 失敗 |
| 只有 1102 | resource signal 未歸因，不能單獨證明 CPU 超限 |
| 查詢 STARTED／不完整／缺事件 | unknown；可能延遲、權限、取樣或沒到達，不能推 0 |
| 重複 Ray/context、缺版本／CPU | 不採數值，不挑方便的一筆 |
| 精確對應 `outcome=exceededCpu` | 才可報平台 exceeded CPU 訊號 |
| CPU 欄位真的為 numeric 0 | 才能報平台值 0；仍不是未經量測的保證 |

GraphQL `workersInvocationsAdaptive` 可用 `isPreview: 1`／previewSlug 做彙總，但取樣與 quantile 不能冒充這一次 CPU。`wrangler tail` 尚不能指定 named Preview；也不以客戶端 wall time 替代。

## 收尾：成功、失敗、逾時都要做

1. 停止新請求。關閉本輪開啟的 Preview routing／日誌收集，移除作用中的 token／expiry，不改 production 程式。
2. 刪除精確本輪 Preview，**不用 `force`**。官方刪除會刪除其 deployments；force 可能破壞 service bindings／Durable Object 引用，本方案不使用。[刪除語意](https://developers.cloudflare.com/workers/wrangler/commands/workers/#preview-delete)
3. 回讀確認 Preview 不存在、入口及收集回到先前關閉狀態、無本輪作用中金鑰、production 版本／設定未變。不能只用「過期」代替關入口，也不能只用成功刪除回應代替回讀。
4. 寫入結果不明時先讀狀態，不盲目重送。清理無法確認就報具體未完成項，不能宣稱結束。不可用 force 解決拒絕。
5. 已收集 invocation logs 可能保留到平台 retention 到期；關閉／刪除不等於立即抹除歷史。舊版本中的已失效設定也不能宣稱全部擦除。公開報告只記 hash、固定結果、CPU 證據狀態、清理結果，不含有效金鑰、完整帳號或原始 headers。

## 官方 API 讀／寫界線

以下僅為已查到的 schema 路徑，**本輪沒有呼叫它們**：

- `GET/POST /accounts/{account_id}/workers/workers/{worker_id}/previews`
- `GET/PUT/PATCH/DELETE /accounts/{account_id}/workers/workers/{worker_id}/previews/{preview_id}`
- `GET/POST .../previews/{preview_id}/deployments`
- `GET/DELETE .../previews/{preview_id}/deployments/{deployment_id}`
- `POST /accounts/{account_id}/workers/observability/telemetry/query`

[Previews 官方文件](https://developers.cloudflare.com/workers/previews/)／[Observability API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/)。文件支援不等於此帳號、連線或手機已實測。無需再造通用控制器；等正式通道與適用授權可用，照這一頁做一次 smoke 即可。

本輪驗證：54/54 新測試、5 個 fabricated demo、6 個獨立反例與完整回歸通過，含一次真正本機 candidate＋PDF.js AES-256 回應互通。範本只做 Bash 語法檢查，未執行。[機器可讀紀錄](verification/named-preview-evidence-20261113.json)
