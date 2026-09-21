# 技能樹配點 Dialog — 計畫書

狀態：**規則已確認，尚未開始實作**。以下規劃基於閱讀 `data/grf/zero/` 四個 lua 檔、`data/skill_i18n.csv`，以及 `index.html` 現有的 dialog / 元件 / i18n / dark-mode 慣例（沿用 `js/ai_equip_parser.js` 的做法：獨立 Vue 元件檔 + `<script src="js/xxx.js?v=N">` + `UIPanel['XDialog']`）。

## 一、資料現況（已確認的結構）

| 檔案 | 內容 | 關鍵欄位 |
|---|---|---|
| `skilltreeview.lua` | `SKILL_TREEVIEW_FOR_JOB[JOBID.JT_X][col] = SKID.Y`，每 7 格一行換行 | 排版來源，col 從 0 開始 |
| `skillinfolist.lua` | `SKILL_INFO_LIST[SKID.Y] = {name, MaxLv, SpAmount[], AttackRange[], _NeedSkillList, NeedSkillList[JOBID]=...}` | SP 消耗、前置需求 |
| `skilldescript.lua` | `SKILL_DESCRIPT[SKID.Y] = {技能名(中英), "MAX Lv:N", "消費:SP", 說明文字含 `^RRGGBB` 色碼與 `[Lv N]` 分級敘述}` | 技能描述（需去除色碼、依 `[Lv N]` 切段） |
| `skilldelaylist.lua` | `SKILL_DELAY_LIST[SKID.Y] = {SkillCastFixedDelay[], SkillCastStatDelay[], ...}` | 各等級詠唱延遲 |
| `skill_i18n.csv` | `key,zh-TW,en,...`（key = `SM_BASH` 這種不含 `SKID.` 前綴的字串） | 技能名稱多語言 |

重要發現：**前置需求有兩層**
- `_NeedSkillList`：該技能的「預設」前置（給主要學習該技能的職業頁用）
- `NeedSkillList = { [JOBID.X] = {...} }`：當「另一個職業頁」也能學到同一個 SKID、但前置條件不同時的覆寫（例：超能力者學 `SM_MAGNUM` 只要 `SM_BASH` Lv3，一般是 Lv5）

判斷某個技能方塊的前置：先看目前這頁 JOBID 在不在 `NeedSkillList` 裡，有就用那個，否則退回 `_NeedSkillList`。

技能等級的儲存也必須是 **`(JOBID頁, SKID)` 複合鍵**，不是全域 SKID —— 因為同一個 SKID（如 `SM_SWORD`）會出現在多個職業頁（劍士頁／盜賊頁／超能力者頁），彼此點數池是分開的 50/70 上限，互不共用。

## 二、JOBID ↔ 目前計算機職業對照表（已用 classes.json 實際 label 核對）

計算機現有 `data/classes.json` 有 21 個「最終職業」代碼（RK/GX/AB/RA/WL/ME/RG/SC/SU/MI/WA/SO/GE/KO/OB/RE/SE/SL/SUM/SN/DR）。用其中文 `label`（例如 RK="騎士/盧恩騎士/盧恩龍爵"）核對後，對照表（1轉頁 → 2轉頁 → 對應最終代碼）：

| 1轉頁 JOBID | 2轉頁 JOBID | 最終代碼 | classes.json label |
|---|---|---|---|
| JT_SWORDMAN | JT_KNIGHT | RK | 騎士/盧恩騎士/盧恩龍爵 |
| JT_SWORDMAN | JT_CRUSADER | RG | 十字軍/皇家禁衛軍/帝國聖衛軍 |
| JT_MAGICIAN | JT_WIZARD | WL | 巫師/咒術士/禁咒魔導士 |
| JT_MAGICIAN | JT_SAGE | SO | 賢者/妖術師/元素支配者 |
| JT_ARCHER | JT_HUNTER | RA | 獵人/遊俠/風鷹狩獵者 |
| JT_ARCHER | JT_BARD | MI | 詩人/宮廷樂師/天籟頌者 |
| JT_ARCHER | JT_DANCER | WA | 舞孃/浪跡舞者/樂之舞靈 |
| JT_ACOLYTE | JT_PRIEST | AB | 祭司/大主教/樞機主教 |
| JT_ACOLYTE | JT_MONK | SU | 武僧/修羅/聖裁者 |
| JT_MERCHANT | JT_BLACKSMITH | ME | 鐵匠/機械工匠/機甲神匠 |
| JT_MERCHANT | JT_ALCHEMIST | GE | 煉金/基因學者/生命締造者 |
| JT_THIEF | JT_ASSASSIN | GX | 刺客/十字斬首者/十字影武 |
| JT_THIEF | JT_ROGUE | SC | 流氓/魅影追蹤者/深淵追跡者 |
| JT_GUNSLINGER（本身即獨立起始職） | JT_REBELLION | RE | 反叛者/夜行使 |
| JT_NINJA（本身即獨立起始職） | JT_KAGEROU | KO | 影狼/流浪忍者 |
| JT_NINJA | JT_OBORO | OB | 朧/疾風忍者 |
| JT_SUPERNOVICE | JT_SUPERNOVICE2 | SN | 超級初心者/終極初學者 |
| （無對應資料） | — | SE / SL / SUM / DR | 拳皇/天帝、獵靈士/契靈士、喵族召喚師/魂靈師、Druid/Karnos/Alitea — 太極/召喚師/特殊職系，目前 lua 檔沒有資料，先標記「無法對應」 |

## 三、一轉 / 二轉 點數上限分級（已確認）

以 JOBID 頁本身分級（整頁共用一個點數池，不管頁內混了幾轉的技能）：

- **50 點**：JT_SWORDMAN, JT_MAGICIAN, JT_ARCHER, JT_ACOLYTE, JT_MERCHANT, JT_THIEF
- **70 點**：JT_KNIGHT, JT_PRIEST, JT_WIZARD, JT_BLACKSMITH, JT_HUNTER, JT_ASSASSIN, JT_CRUSADER, JT_MONK, JT_SAGE, JT_ROGUE, JT_ALCHEMIST, JT_BARD, JT_DANCER, JT_REBELLION, JT_KAGEROU, JT_OBORO, JT_NINJA, JT_GUNSLINGER
- **99 點**：JT_SUPERNOVICE
- **70 點**：JT_SUPERNOVICE2

超過上限時該 JOBID 頁的已用點數字樣變紅，不鎖定、可繼續加點。

SE/SL/SUM/DR/SN（classes.json 裡對不到 JOBID 的那幾個最終職業）：目前 lua 檔沒有對應資料，是四轉服才有的資料，先在對照表留空、UI 上不列出這幾個職業選項，等之後補上四轉 lua 檔再補對照與分級。

## 四、資料讀取方式（已確認：不做離線轉換，直接在前端解析 lua 原檔）

因為官方之後會改版增加技能、你會直接替換 `data/grf/zero/*.lua`，所以**不**做一次性 Node 轉換腳本、**不**產生要手動維護的靜態 JSON。改成：

- App 執行期用 `fetch()` 取回 lua 檔的原始 bytes，用 `new TextDecoder('big5')` 解碼成文字（瀏覽器原生支援 big5 標籤，不需額外函式庫）。
- 寫一個通用的**小型 Lua table 字面量解析器**（`js/lua_table_parser.js`），只處理這四個檔案共通的固定樣式：
  - 去除 `--[[ ... ]]` 區塊註解與 `--` 單行註解
  - 解析 `NAME = { ... }` 頂層賦值、巢狀 `{ }`
  - key 可以是 `[SKID.XXX]` / `[JOBID.XXX]`（轉成字串 `"SKID.XXX"` / `"JT_XXX"`）、bareword（`MaxLv = ...`）、或省略（純陣列項目）
  - value 可以是數字、字串、巢狀表、或 `SKID.XXX` / `JOBID.XXX` 這種當作值使用的識別字（一樣轉字串保留）
  - 遇到表後面接的其他語句（例如 `JobSkillTab.ChangeSkillTabName(...)`）直接忽略，只取用得到的表
  - 單一項目解析失敗時只跳過該項目並在 console 警告，不讓整份資料解析中斷
- 四個檔案各自用這個解析器轉成： `{jobKey: {col: skidName}}`（skilltreeview）、`{skidName: {maxLv, spAmount[], needSkillList:{default, overrides}}}`（skillinfolist）、`{skidName: {rawLines[]}}`（skilldescript，解析色碼/`[Lv N]`在上層另外處理）、`{skidName: {...delay欄位}}`（skilldelaylist）。
- 之後你直接覆蓋 `data/grf/zero/*.lua`（或未來新增 `data/grf/4th/*.lua`）重新整理頁面即可生效，不需要再跑任何轉換指令。

## 五、UI / 元件設計

- 新增獨立元件 `js/skill_tree_view.js`（仿 `ai_equip_parser.js` 模式），在 `index.html` 加 `<skill-tree-dialog :visible.sync="UIPanel['SkillTreeDialog']" ...>`，並在選單加開啟按鈕。
- 版面依 `skilltreeview.lua` 的 col 座標排成 7 欄網格（col % 7 = 欄, col / 7 = 列），一次顯示「1轉頁 + 對應2轉頁」兩塊（依第二節對照表用選定職業決定要顯示哪兩頁）。
- 每個技能方塊：技能名（文字；圖示見下）、**目前等級／MaxLv**（例如 `3/10`，永遠顯示）、右上角小圈點數。
- **操作方式**：
  - 滑鼠滾輪在方塊上：往上 +1 級（觸發前置自動配點）、往下 -1 級（觸發減點連鎖，見第六節），下限 0、上限 MaxLv。
  - 滑鼠點住（mousedown 持續按住）＋／－：短暫延遲後開始連續步進（每格約 100~150ms），放開或碰到上下限才停止，藉此達到「連點就滿等/歸零」的效果。
  - 單次點擊 ＋／－：跟滾輪一格一樣，只變動 1 級。
  - 超過該頁點數上限：已用點數文字變紅，不阻擋操作。
- Hover 或點擊觸發 `detailview`（`el-popover` 或側欄），顯示：技能名稱（`t()` 查 `skill_i18n.csv`）、`skilldescript` 整理後的說明、逐級 SP、逐級詠唱延遲、前置需求清單（顯示「XX Lv5」，可點擊跳轉高亮該前置方塊）。
- **技能圖示**：新增 `data/skill_icon.csv`（欄位 `key,iconUrl`，key 對應 `skill_i18n.csv` 同一套技能代碼），沒有對應列或空值時顯示文字佔位（例如技能名前兩字），之後你可以直接編輯這個 csv 加圖片連結，不用改程式。

## 六、配點邏輯（已確認）

- **加點**：點/滾輪 B 的 +1 時，先看目前 JOBID 頁在不在該技能的 `NeedSkillList` override 裡，有就用該 override，沒有用 `_NeedSkillList`；遞迴地把等級不足的前置（含前置的前置）先補到需求等級，最後才把 B 加 1 級。
- **點數池**：每個 JOBID 頁一個計數器，達到第三節的上限後只變紅字警示，不阻擋繼續加點。
- **減點（已確認：直接連鎖歸零，不是降級到剛好符合）**：調降 A 的等級後，遍歷「以 A 為前置」的技能，只要其需求（依同樣的 override/default 判斷規則）未被滿足，該技能**直接歸零**（不是降到符合前置的最大值）；再遞迴檢查因此被歸零的技能是否又是其他技能的前置，一路連鎖處理到穩定為止。例：B 需要 A≥5，A 被扣到 3 → B 立刻變 0；若還有 C 需要 B≥1，C 也跟著變 0。

## 七、其他已確認事項

- 這個技能樹 dialog 是**純規劃/模擬工具**，不影響現有傷害計算、屬性計算，也不寫回 `skills.json`。
- 配點結果**不儲存**（不做 localStorage／不做匯出分享），關閉或重新整理就重置。

---

規則已確認，接下來按此計畫開始實作。
