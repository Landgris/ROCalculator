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
- 5: 毒
- 6: 聖
- 7: 暗
- 8: 念

### ranged (是否遠程)
- true: 遠程攻擊
- false: 近戰攻擊

### critical (是否會暴擊)
- true: 技能可以暴擊
- false: 技能不會暴擊

### halfcri (是否一半暴率)
- true: 暴擊率減半
- false: 正常暴擊率

### cannon (是否砲彈類型)
- true: 砲彈類型技能
- false: 非砲彈類型

### transWeaponDEF (是否半無視DEF)
- true: 無視目標一半防禦力
- false: 正常計算防禦力

### ignoreRES (是否無視RES)
- true: 完全無視魔法防禦
- false: 正常計算魔法防禦

### laterranged (後續是否遠程)
- true: 後續攻擊為遠程
- false: 後續攻擊為近戰

### laterformula (是否有後續公式)
- true: 有額外的傷害計算
- false: 只有基礎公式

### hitnumber (HIT數量)
- 正數: 固定HIT數
- 負數: 絕對值為HIT數，但有特殊計算
- 字串: 動態計算HIT數 (如: "SLV", "(WTI==\"Daggers\")?2:1")

## 公式變數

### 基礎屬性
- STR: 力量
- AGI: 敏捷
- VIT: 體質
- INT: 智力
- DEX: 靈巧
- LUK: 幸運
- CON: 集中力
- CRT: 創造力
- SPL: 咒語力

### 生命值和魔力值
- HP: 目前生命值
- SP: 目前魔力值
- Mhp: 最大生命值
- Msp: 最大魔力值

### 等級相關
- BLV: 基礎等級 (Base Level)
- JLV: 職業等級 (Job Level)
- SLV: 技能等級 (Skill Level)

### 武器相關
- POW: 武器攻擊力
- WLV: 武器等級
- WGT: 武器重量
- WTI: 武器類型 (如: "Books", "Rods", "Daggers", "Instruments", "Whips")
- SRL: 盾牌精煉值
- SHW: 盾牌重量

### 特殊變數
- CRW: 手推車重量
- EVit: 敵方VIT
- DOWN(): 無條件捨去函數

### 職業代碼 (class)
- KN: 騎士
- CR: 十字軍
- LK: 騎士領主
- PA: 聖騎士
- RG: 皇家守衛
- WZ: 法師
- SA: 賢者
- HW: 高等法師
- PR: 教授
- SO: 巫師
- SU: 修羅
- SC: 影子追跡者
- GE: 基因學者
- MI,WA: 遊俠
- KO,OB: 忍者
- RE: 反叛者
- SE: 拳聖
- SL: 魂靈師
- SUM: 召喚師
- SN: 超級新手

### 武器類型 (WTI)
- **Daggers**: 短劍 (小體型100%, 中體型75%, 大體型50%)
- **OneHandedSwords**: 單手劍 (小體型75%, 中體型100%, 大體型75%)
- **TwoHandedSwords**: 雙手劍 (小體型75%, 中體型75%, 大體型100%)
- **Katars**: 拳刃 (小體型75%, 中體型100%, 大體型75%) - 雙手武器
- **Spears**: 矛類 (小體型75%, 中體型75%, 大體型100%)
- **Axes**: 斧類 (小體型50%, 中體型75%, 大體型100%)
- **Maces**: 鈍器 (小體型75%, 中體型100%, 大體型100%)
- **Knuckles**: 拳套 (小體型100%, 中體型100%, 大體型75%)
- **Rods**: 杖類 (小體型100%, 中體型100%, 大體型100%)
- **Books**: 書本 (小體型100%, 中體型100%, 大體型50%)
- **Bows**: 弓 (小體型100%, 中體型100%, 大體型75%) - 遠程雙手武器
- **Instruments**: 樂器 (小體型75%, 中體型100%, 大體型75%)
- **Whips**: 鞭子 (小體型75%, 中體型100%, 大體型75%)
- **Guns**: 槍彈 (小體型100%, 中體型100%, 大體型100%) - 遠程雙手武器

#### 武器特性說明
- **遠程武器**: Bows, Guns
- **雙手武器**: Katars, Bows, Guns, TwoHandedSwords
- **體型修正**: 不同武器對不同體型怪物有傷害修正

### 條件運算
- 支援三元運算符: condition ? value1 : value2
- 支援邏輯運算: ==, !=, >, <, >=, <=, |, &
- 支援算術運算: +, -, *, /
- 支援括號運算: ()

### 時間相關 (單位：秒)
- FCT: 固定詠唱時間 (Fixed Cast Time)
- VCT: 變動詠唱時間 (Variable Cast Time)
- CD: 冷卻時間 (Cool Down)
- GCD: 全域冷卻時間 (Global Cool Down)

### 特殊屬性說明
- intest: 是否為測試技能
- SpecialATK7: 特殊攻擊力加成
- SpecialMATK1: 特殊魔法攻擊力加成

## 新增技能步驟

1. 參考 `skills_zero.json` 中的範例
2. 複製適合的技能類型作為模板
3. 修改各個屬性值
4. 測試公式是否正確
5. 添加到主要檔案中

## 備份建議

定期備份重要的技能檔案，避免資料遺失。
