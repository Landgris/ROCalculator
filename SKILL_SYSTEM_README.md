# RO 計算機技能檔案系統使用說明

## 概述
現在 `this.DefaultDB_Skill` 已經改為從 JSON 檔案動態載入，支援多版本技能切換。

## 已完成的功能

### 1. 資料結構變更
- **原本**：硬編碼在 `LoadDB()` 方法中的巨大陣列
- **現在**：從 JSON 檔案動態載入，支援版本切換

### 2. 新增的 Vue Data 屬性
```javascript
data: {
    currentSkillFile: 'skills.json', // 當前技能檔案
    availableSkillFiles: ['skills.json', 'skills_new_version.json'], // 可用的技能檔案列表
}
```

### 3. 新增的方法

#### `loadSkillsFromJSON(filename)`
- **功能**：從指定的 JSON 檔案載入技能資料
- **參數**：filename（可選，預設使用 currentSkillFile）
- **返回**：Promise<boolean>
- **錯誤處理**：如果載入失敗，會自動使用 loadDefaultSkills() 備用資料

#### `switchSkillFile(filename)`
- **功能**：切換到不同的技能檔案
- **自動觸發**：職業技能重新篩選
- **UI 回饋**：成功/失敗訊息

#### `reloadSkills()`
- **功能**：重新載入當前技能檔案
- **用途**：修改 JSON 檔案後重新整理

#### `getSkillFileDisplayName(filename)`
- **功能**：取得技能檔案的顯示名稱
- **支援檔案**：
  - `skills.json` → "原版技能 (Classic)"
  - `skills_new_version.json` → "新版技能 (New Version)"
  - 其他檔案會自動去除 .json 副檔名

#### `loadDefaultSkills()`
- **功能**：載入預設的備用技能資料
- **用途**：當 JSON 檔案載入失敗時的備援方案

### 4. UI 控制項
在技能清單頁面頂部新增了版本選擇器：
- **下拉選單**：選擇不同版本的技能檔案
- **重新載入按鈕**：重新載入當前檔案
- **狀態顯示**：顯示已載入的技能數量

## 使用方式

### 為不同遊戲版本建立技能檔案

1. **複製現有檔案**：
   ```bash
   cp skills.json skills_ep19.json
   ```

2. **修改技能資料**：
   - 調整技能倍率
   - 新增新技能
   - 修改技能屬性

3. **更新可用檔案列表**：
   ```javascript
   availableSkillFiles: [
       'skills.json', 
       'skills_new_version.json',
       'skills_ep19.json'  // 新增
   ]
   ```

4. **更新顯示名稱**（可選）：
   ```javascript
   getSkillFileDisplayName(filename) {
       const displayNames = {
           'skills.json': '原版技能 (Classic)',
           'skills_new_version.json': '新版技能 (New Version)',
           'skills_ep19.json': 'EP19 技能版本'  // 新增
       };
       return displayNames[filename] || filename.replace('.json', '');
   }
   ```

### JSON 檔案格式
```json
[
  {
    "skill": {
      "id": "RK_WINDCUTTER",
      "name": "風壓飛刃",
      "level": 5,
      "formula": "((WTI=='TwoHandedSword')?250:((WTI=='Spears')?400:300))*SLV*BLV/100",
      "class": "RK",
      "DamageTypeIdx": 0,
      "ranged": false,
      "critical": false,
      "cannon": false,
      "transWeaponDEF": false,
      "laterformula": false,
      "hitnumber": "(WTI=='TwoHandedSword')?2:1",
      "elemental": 0,
      "FCT": 0,
      "VCT": 0,
      "CD": 0.3,
      "GCD": 0.5,
      "Note": "雙手劍/矛/其他武器時倍率會不同"
    }
  }
]
```

## 技術細節

### 載入時機
- **初始化**：`LoadDB()` 方法中自動呼叫 `loadSkillsFromJSON()`
- **切換版本**：使用者透過 UI 選擇不同檔案時
- **手動重載**：點擊重新載入按鈕時

### 錯誤處理
- 檔案不存在：顯示錯誤消息，使用備用資料
- JSON 格式錯誤：顯示錯誤消息，使用備用資料
- 網路錯誤：顯示錯誤消息，使用備用資料

### 職業技能整合
當技能檔案載入後，會自動觸發 `onChangeClass()` 重新篩選當前職業的技能。

## 優點

1. **可維護性**：技能資料與程式碼分離
2. **靈活性**：支援多版本切換
3. **擴展性**：容易新增新版本
4. **向下相容**：保留備用硬編碼資料
5. **使用者友好**：直觀的版本切換介面

## 注意事項

1. JSON 檔案必須放在與 index.html 同一目錄
2. 檔案名稱要加入 `availableSkillFiles` 陣列中
3. JSON 格式必須正確，否則會使用備用資料
4. 建議定期備份 JSON 檔案
