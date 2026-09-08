# 核心算式後端化計畫（Cloudflare Workers）

## 目的

目前所有傷害/攻速/防禦公式都在 `index.html` 的前端 JS 裡，任何人開 devtools 或 view-source 就能拿到完整邏輯與技能資料。這份計畫要把「核心算式」逐步搬到 Cloudflare Workers（伺服器端），前端改成呼叫 API 取得計算結果，公式邏輯不再下發到瀏覽器。

搭配授權（GPL-3.0）主張，技術面 + 法律面雙管齊下，而不是只靠其中一種手段。

## 為什麼選 Cloudflare Workers

- 免費額度：每天 10 萬次請求，估計用量（400 人/天 × 高估 100 次/人重算 ≈ 4 萬次/天）綽綽有餘
- 沒有額外流量計費（傳輸的都是小 JSON，不是問題但 Workers 免費額度也不另計流量費）
- 跑 JS/TS（V8 isolate），現有的公式邏輯可以直接搬過去，不用重寫成 Rust/AssemblyScript
- 全球邊緣節點，不用自己顧伺服器開機/當機

## 分階段步驟

### 階段 0：環境確認（已完成）
- [x] 申請 Cloudflare 帳號
- [x] 安裝 `wrangler` CLI（`npm install -g wrangler`，node/npm 版本警告可忽略，功能正常）

### 階段 1：Pilot — 驗證工具鏈（已完成 ✓）
- [x] 在 repo 裡建立獨立的 `worker/` 資料夾，不動現有 `index.html`
- [x] 移植第一個公式當試驗品：**基礎素質ATK（StatusATK）**
  - 來源：`index.html` 第 9573-9586 行
  - 公式：
    ```
    TransSTR = STR_total（若武器是 Bows/Instruments/Whips 或槍系武器，改用 DEX_total）
    TempDEX  = DEX_total（上述武器類型時改用 STR_total）
    StatusATK = floor(Level/4 + TransSTR + TempDEX/5 + LUK_total/3) + POW_total*5
    ```
  - 武器是否算「槍系」判定：`Pistol/Rifle/Gatling/Shotgun/Grenade`
- [x] 用 `wrangler dev` 在本機啟動，寫一支獨立測試頁面/腳本打本機 API，比對跟現在前端算出來的 `attritube['StatusATK']` 數值是否一致
  - 三組測試案例（近戰/遠程觸發STR↔DEX互換/高等級POW加成）數值完全一致（143/143、315/315、711/711）
  - 過程中發現兩條容易漏掉的隱藏規則，已正確移植：POW/STA/WIS/SPL/CON/CRT 只有 Lv≥200 才生效；未選職業（`classid` 為空）整個計算會跳過
- [x] 這階段沒有 deploy、沒有動正式 index.html

### 階段 2：擴大遷移範圍（進行中）

#### 2-1　API 合約設計（決定）
不採用「每個公式一個 endpoint」（太多來回請求），改成**單一端點、傳完整角色快照**，模仿現在前端「任何輸入變動就整包重算」的模式，只是把計算的地方換到伺服器：

```
POST /compute
Request body（大致對應現在 Vue data 的形狀）：
{
  status, status_add, status_job,       // 素質
  equipmentEffects,                     // 裝備效果彙總後的清單（前端先聚合，不用整包裝備原始資料）
  skill: { id, level, formula, hitnumber, FCT, VCT, CD, GCD, DamageTypeIdx, ... },
  skilloption, option,
  weapon, subweapon,
  enemyattribute,
  activeSupportSkills: [ { id, lv, arg1, arg2 }, ... ]   // 上限 20 筆，見下方說明
}

Response：
{ attritube: {...}, computeattribute: {...} }  // 前端目前顯示用得到的欄位子集
```

前端還是要做 debounce（停止輸入 300ms 後才送），不然每個按鍵都打一次 API。

**輔助技能介面設計（決定）**：不同計算函式（ATK/MATK/DEF/詠唱延遲...）各自用到的輔助技能 id 不會剛好重疊，如果每個函式各自列一份 id 清單會很難維護。改成統一介面：前端把目前**啟用中**的輔助技能篩選成陣列傳過去（照 `DefaultDB_SupportSkill` 篩 `active`，格式 `{id, lv, arg1, arg2}`），**上限 20 筆**。Worker 端寫 `isSupportActive(id)` / `getSupportSkill(id)` 兩個小 helper 查這個陣列，邏輯照搬現在前端 `IsSupportActive`/`GetSupportSkill` 的寫法，之後不管搬哪個計算函式都共用同一套介面，不用每次重新設計。

#### 2-2　技能公式 eval() 問題（已完成 ✓）
現有 `SkillFormulaReplace` 是「關鍵字字串取代 → 組出一段 JS 程式碼字串 → `eval()`」，這招搬到後端不安全也不必要。改用**自製安全算式直譯器**：

- 已從 `KeywordReplaceList`（`index.html` 第 14298 行起）盤點出完整的關鍵字清單，共 29 個關鍵字（`STR/AGI/VIT/INT/DEX/LUK/POW/STA/WIS/SPL/CON/CRT/PATK/BLV/JLV/CHP/CSP/Mhp/Msp/SLV/AEI/WLV/WGT/SRL/SHW/CRW/ELV/ESIZE/EVit`）+ 4 個函式（`DOWN`、`UP`、`MUL(a,b)`、`IS_GUN(X)`、`WPT(武器類型)`）
- 實作：`worker/src/formula-interpreter.js`，手寫 tokenizer + 遞迴下降 parser，支援三元運算子（含巢狀）、`||`/`&&`、比較運算子、四則運算、括號、上述函式呼叫。`WPT(X)` 的參數是裸識別字（武器類型 id 字面值），不會被當成一般運算式解析
- 好處：技能資料（`skills.json`）維持現在的資料驅動設計，新增/改技能公式不用重新部署 Worker，只要改 JSON
- **驗證**：從 `skills.json` + `skills_zero.json` 撈出全部 498 條真實技能公式字串（含 formula/hitnumber/FCT/VCT/CD/GCD），用 8 組隨機素質/技能等級/武器類型組合（涵蓋各種 `WPT()` 分支、巢狀三元運算子）分別餵給直譯器跟正式頁面的 `SkillFormulaReplace()+eval()`，總共 3984 次計算比對，**數值 0 誤差**。有 128 筆兩邊都正確地拋出語法錯誤——追查後發現是我自己早期用來撈公式清單的腳本把幾筆 CSV 資料誤切斷（不是技能資料或直譯器本身的問題），不影響驗證結論

#### 2-3　公式遷移優先順序（已修正：DEF/MDEF 內嵌在 ATK/MATK 公式裡，不是獨立函式）
1. 算式直譯器（2-2，已完成）
2. **普攻+技能傷害整條 ATK 計算鏈（含 DEF/MDEF 減傷、RES 減傷）（已完成 ✓，見下）**
3. **ASPD 懲罰計算（已完成 ✓，見下）**
4. **MATK 魔法傷害計算鏈（已完成 ✓，見下）**
5. **龍息（DragonBreath）/ 陷阱（Trap）傷害（已完成 ✓，見下）**

**不遷移的部分（已討論，刻意不做）**：
- **DPS 換算**（`ComputeATKDPS`/`ComputeMATKDPS`，以及 DragonBreath 內建的 `_DPS` 那一步）：純粹是「已算好的傷害 × 攻擊次數/秒」，沒有分支邏輯、沒有技能特例，依賴的都是已經受保護的傷害結果，搬過去沒有保護效益，只多一次網路來回，故意留在前端
- **屬性相剋倍率查表**：已在 ATK/MATK 設計階段處理掉，`skilloption.ElementalPercent` 由前端算好以純數字傳入，Worker 不需要內嵌屬性表；查表本身是公開資料，放前端或後端都沒有保護意義上的差別（實測顯示放後端反而流量更省，因為不用額外傳 10 格陣列，故維持現狀不動）

##### `aspd_calculator.js` 移植（已完成 ✓）
- 這份檔案本來就寫得跟 Vue 完全脫鉤（純函式，沒有 `this.xxx`），index.html 只負責組 input 呼叫 `AspdCalculator.calcAspd(input)`，所以不是「重新轉譯」，而是**逐行複製**成 `worker/src/aspd-formula.js`，只在檔尾加一段 `module.exports`（瀏覽器沒有 `module`，這段不會執行，不影響 `index.html` 原本用法）
- 用 `diff` 比對複製結果跟根目錄原檔，兩份檔案的公式邏輯本體（懲罰表、`calcAspdOfficial`、`calcAspdParadise`）逐行完全一致，排除人工轉譯手誤
- **驗證**：Node 直接 `require` 兩份檔案（原檔 + Worker 複製版），對 13 個職業 × 4 種 JobMaxPointType × 24 種武器類型 × 3 種副手狀態（含未知職業 fallback 分支）跑隨機素質/百分比組合，`calcAspdOfficial`/`calcAspdParadise` 各自比對，共 11520 次計算，**逐欄位 0 誤差**
- Worker 端點 `/compute-aspd`：接收 `{ formula: 'official'|'paradise', ...calcAspdOfficial/calcAspdParadise 需要的欄位 }`，本機 `wrangler dev` 測試跟直接呼叫原始公式結果一致，驗證錯誤路徑（formula 值不對、缺 classid/mainWeaponTypeId）正確回 400
- 前端 `?verifyapi` 共存驗證：在 `onOption()` 組出 `_aspdInput` 後同時呼叫 `VerifyComputeASPDAgainstAPI(formula, _aspdInput)`（debounce 300ms），比對 `finalAspd`。用 Playwright 實際跑一次 RK/4th/雙手劍情境，console 印出「[verifyapi] ASPD 計算一致 ✓ 172.28」，管線跟數值都確認正常

##### `ComputeMATKAtttibute` 移植（已完成 ✓）
- 來源：`index.html` 第 10539-10739 行（`ComputeMATKAtttibute(mflag=0)`），逐行搬到 `worker/src/matk-formula.js` 的 `computeMATK(input, mflag=0)`，跟 ATK 共用同一份 `formula-interpreter.js`（`mulOper`/`evaluateFormula`）
- 支援技能：`WL_RECOGNIZEDSPELL`、`HW_MAGICPOWER`、`PF_MINDBREAKER`、`RG_RAID_SUPPORT`/`RG_RAID_SUPPORT(boss)`、`HN_RULEBREAK`（+ 6 個技能ID分支）、`PR_LEXAETERNA`；技能特例：`SO_SPELLFIST`（兩處）
- **驗證**：21 組情境（baseline、6 個支援技能、7 個技能ID特例、IgnoreMDEF/ignoreRES/mflag正負值/負數與公式化hitnumber等邊界）對照正式頁面 `ComputeMATKAtttibute()`，**0 誤差**
- Worker 端點 `/compute-matk`：沿用 `/compute-atk` 的輸入驗證（子物件形狀相同），本機測試跟直接呼叫結果一致
- 前端 `?verifyapi` 共存驗證：**過程中抓到一個真的的 bug**——`BuildComputeMATKInput()` 一開始直接沿用 `BuildComputeATKInput()` 產出的 `weapon`/`subweapon` 子物件，但 ATK 用不到 `weapon.refinematk`/`weapon.MATK`/`subweapon.MATK`，導致這幾個欄位缺漏、傳到 Worker 端變成 `undefined` 一路 NaN 下去（JSON 序列化後變成 `null`）。這個問題只有透過瀏覽器端到端測試才抓得到（Node 端純函式測試不會用到 `BuildComputeMATKInput()`），修正後 Playwright 實測 MG_FIREBOLT 情境，console 印出「[verifyapi] MATK 計算一致 ✓」

##### `ComputeDRAGONBREATH()` / `ComputeTRAPAttibute()` 移植（已完成 ✓）
- 來源：`index.html`（龍息、陷阱兩個獨立技能傷害公式），搬到 `worker/src/misc-formula.js` 的 `computeDragonBreath(input)` / `computeTrap(input)`
- 兩者都不含各自的 DPS 換算最後一步（理由同上，DPS 不搬），只回傳傷害本體數值
- **`ComputeDRAGONBREATH()` 有個既有的副作用**：原函式會直接把 `this.option.SkillPercent` 覆寫成 `floor(x)*100`（影響其他共用同一份 `option.SkillPercent` 的計算）。Worker 版本改成純函式、不修改輸入，數值結果不變；前端呼叫驗證時要在覆寫發生「之前」先存一份原始值，傳給驗證函式，不能在函式執行完後才去讀 `this.option.SkillPercent`（那時已經被覆寫過了）
- **驗證**：11 組情境（DragonBreath 5 種：baseline/transWeaponDEF/IgnoreDEF/ranged/天怒；Trap 5 種：baseline/陷阱研究/天怒/素質全0邊界/兩者疊加）對照正式頁面，**0 誤差**
- Worker 端點 `/compute-dragonbreath`、`/compute-trap` 本機測試通過；前端 `?verifyapi` 共存驗證 Playwright 實測，console 印出「DragonBreath 計算一致 ✓ -447」「Trap 計算一致 ✓ {...}」

##### `ComputeATKAtttibute` 移植（已完成 ✓）
- 來源：`index.html` 第 9867-10351 行（484 行），逐行對照搬到 `worker/src/atk-formula.js` 的 `computeATK(input, isNA, isCRI)`
- 設計：裝備/技能百分比聚合值、屬性相剋表查詢、武器體形懲罰維持前端聚合後當純數字傳入；DEF/RES 減傷計算與所有技能特例邏輯（`LK_SPIRALPIERCE`、`HN_BREAKINGLIMIT` 系列、`hitExcludeSkills`、18 個輔助技能分支）整段搬到 Worker 端
- 輔助技能改用統一的 `activeSupportSkills` 陣列查表（`isSupportActive`/`getSupportSkill`），不再各自寫死清單
- **驗證**：39 組情境（baseline、18 個輔助技能各自獨立測、4 個帶參數輔助技能、8 個技能ID特例、12 個邊界情境如穿透100%DEF/transWeaponDEF/ignoreRES/IgnoreDEF選項/不死屬性/雙持副手/遠程武器/遠程技能laterranged/負數hitnumber/公式化hitnumber/體型懲罰/舊版屬性表）× 4 種 isNA/isCRI 組合 = 156 次計算比對，**數值 0 誤差**
  - 過程中發現並修正三個「移植無誤但測試腳本本身寫錯」的陷阱：`MonsterAtkPercent` 實際讀自 `effecttypelist` 而非 `attritube`；`status_total.SPL` 是廢棄欄位，真正吃到公式的是 `status_total.S_P_L`；`computeattribute.enemydef` 正式頁面不會每次呼叫前重置，導致部分無視DEF分支測出「殘留舊值」的假不符——這些都只影響驗證腳本本身，不影響 `atk-formula.js` 的正確性

#### 2-4　前端串接與部署
- [x] Worker 端點全部完成（本機測試）：`/compute-atk`、`/compute-aspd`、`/compute-matk`、`/compute-dragonbreath`、`/compute-trap`。**都還沒 deploy，只在本機 `wrangler dev --local` 測過**
- [x] 前端「共存驗證」機制（`?verifyapi`）：`index.html` 顯示邏輯完全沒動，一般網址不受影響；加上 `?verifyapi` 網址參數後，每個已移植的公式算完的同時會額外打一次本機 Worker API（debounce 300ms），在 console 比對本機算式跟 API 結果是否一致，不一致會警告、不影響畫面。目前 ATK/ASPD/MATK/DragonBreath/Trap 都已接上這個機制，且都在 Playwright 端到端測試中確認過「計算一致」
- [ ] 正式切換：把畫面顯示的資料來源從本機算式改成呼叫 Worker API（目前只是「多算一次來對答案」，還沒有任何畫面數值真的來自 API）——**這一步之前要先 deploy Worker，需要你確認才會執行**
- [ ] 第一次 `wrangler deploy` 到正式環境（**需要你確認才會執行**，這會是第一次讓 Worker 對外公開）

## 已知取捨（先記錄，之後階段再處理）

- **技能公式字串 eval() 問題**：現在技能公式存成字串（如 `100+30*SLV`），用 `SkillFormulaReplace` 代入變數後 `eval()`。這個設計沒辦法直接搬進編譯後的環境，階段 2 需要另外設計（直譯器 or 建置期編譯），本計畫階段 1 不處理。
- **WASM 反編譯風險**：即使之後改用 wasm 進一步強化保護，AI 輔助反編譯已經能大幅降低反組譯門檻，不是不可破解，只是拉高成本。後端化（本計畫）才是真正不下發邏輯的做法。
- **請求量與 UX**：如果維持「改一個數值就即時算」的體驗，遷移到後端後每次改動都要一次網路來回，體感會變慢。階段 2 需要導入 debounce 或「按計算才送出」的互動模式。
