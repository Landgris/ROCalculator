# 技能檔案說明

## 檔案結構

### 1. skills_zero.json - Zero版本 (參考範例)
- **用途**: 包含各種技能類型的參考範例，方便新增技能時參考
- **內容**: 精選的10個技能，涵蓋不同職業和技能類型
- **特色**: 每個技能都有詳細的 Note 說明該技能的特點

### 2. skills_original.json - 原版技能 (Original)
- **用途**: 保存原始的完整技能資料
- **內容**: 308個完整技能資料
- **備註**: 這是修正前的原始版本，作為備份使用

### 3. skills.json - 當前版本技能 (Current)
- **用途**: 目前正在使用的技能檔案
- **內容**: 已修正JSON格式錯誤的完整技能資料
- **備註**: 這是經過修正和優化的版本

## 技能資料結構範例

```json
{
    "skill": {
        "id": "技能ID",
        "name": "技能名稱",
        "level": 技能等級,
        "formula": "傷害公式",
        "class": "職業代碼",
        "DamageTypeIdx": 傷害類型索引,
        "ranged": 是否遠程,
        "critical": 是否會暴擊,
        "halfcri": 是否一半暴率,
        "cannon": 是否砲彈類型,
        "transWeaponDEF": 是否半無視DEF,
        "ignoreRES": 是否無視RES,
        "laterranged": 後續是否遠程,
        "laterformula": 是否有後續公式,
        "hitnumber": HIT數量,
        "elemental": 屬性,
        "FCT": 固定詠唱時間,
        "VCT": 變動詠唱時間,
        "CD": 冷卻時間,
        "GCD": 全域冷卻時間,
        "Note": "備註說明"
    }
}
```

## 屬性值說明

### DamageTypeIdx (傷害類型)
- 0: 物理
- 1: 魔法
- 2: 龍息

### elemental (屬性)
- 0: 無屬性
- 1: 火
- 2: 水
- 3: 風
- 4: 地

### hitnumber (HIT數量)
- 正數: 固定HIT數
- 負數: 絕對值為HIT數，但有特殊計算
- 字串: 動態計算HIT數 (如: "SLV", "(WTI==\"Daggers\")?2:1")

## 公式變數

### 基礎屬性
- STR, AGI, VIT, INT, DEX, LUK: 基礎屬性
- HP, SP, Mhp, Msp: 生命值和魔力值
- BLV: 基礎等級
- SLV: 技能等級
- POW: 力量
- WLV: 武器等級
- WGT: 武器重量
- CRW: 手推車重量

### 武器判斷
- WTI: 武器類型 (如: "Books", "Rods", "Daggers", "Instruments", "Whips")

### 條件運算
- 支援三元運算符: condition ? value1 : value2
- 支援邏輯運算: ==, !=, >, <, >=, <=, |, &

## 新增技能步驟

1. 參考 `skills_zero.json` 中的範例
2. 複製適合的技能類型作為模板
3. 修改各個屬性值
4. 測試公式是否正確
5. 添加到主要檔案中

## 備份建議

定期備份重要的技能檔案，避免資料遺失。
