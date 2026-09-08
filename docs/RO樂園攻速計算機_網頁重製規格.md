# RO 樂園攻速計算機 — 網頁重製規格整理

> 來源：`RO樂園攻速計算機 的副本.xlsx`。本文件分析 Excel 中的 **攻速計算、公式、攻速懲罰表、攻速懲罰表 wo 三轉**；但網頁版實作只採用 **三轉版「攻速懲罰表」**，因其已包含前置二轉職業資料。
> 目的：提供另一個 Agent 重製為網頁版。應以「資料表 + 純函式計算」實作，不要直接照搬 Excel 儲存格座標。

> **目前網頁已有既有進度**：職業加成點數、ASPD%、BUFF 等欄位/介面已存在。後續 Agent 不應重新設計或重做這些欄位，而應以既有欄位值作為 ASPD 核心計算引擎的輸入，除非現有程式本身缺少必要資料。
>
> **武器選擇規則**：網頁版不限制職業可選武器。任何職業都可以選擇任何武器；若「攻速懲罰表」中該職業 × 武器的懲罰值為空白，計算時直接視為 `0`。

## 1. 核心計算模型

Excel「公式」分頁定義：

```text
ASPD1 = FLOOR(Base ASPD - Weapon/Shield Penalty + Stat Bonus + (Status Bonus * AGI / 200))
ASPD2 = FLOOR((195 - ASPD1) * %ASPD) + ASPD1
Final ASPD = ASPD2 + Flat Bonus
```

注意：Excel 的懲罰表實際上直接存放正負數，例如巫師短劍為 `-4`，所以程式實作應採 **直接相加查表值**，不要再額外做一次負號轉換：

```text
ASPD1 = floor(BaseASPD + MainHandPenalty + OffHandPenalty + StatBonus + StatusBonus)
```

其中 `%ASPD` 在 Excel 實作為 `(裝備攻速% + Buff ASPD%) / 100`；Flat Bonus 對應「固定素質 ASPD」。

### Stat Bonus

```text
弓、樂器、鞭子：sqrt(DEX² / 7 + AGI² / 2) / 4
其他武器：      sqrt(DEX² / 5 + AGI² / 2) / 4
```

## 2. 「攻速計算」分頁：輸入、輸出與計算順序

### 使用者輸入

網頁現有欄位應直接沿用，不要另外做一套重複 UI。核心計算至少會使用：

- 職業
- 主手裝備
- 副手裝備
- 裝備攻速 %
- 固定素質 ASPD
- JOB 等級 / 已計算好的職業加成點數
- AGI：base/裝備點數、其他加成、職業加成
- DEX：base/裝備點數、其他加成、職業加成
- Buff 的使用狀態、Modifier、ASPD% 等既有欄位值


### 計算輸出
- AGI Total
- DEX Total
- Base ASPD
- Weapon Penalty
- Shield/Off-hand Penalty
- Stat Bonus
- Status Bonus
- ASPD1
- ASPD2
- 最終 ASPD

### Excel 核心公式對照

| 儲存格 | 意義 | Excel 公式 |
| --- | --- | --- |

| C10 | Base ASPD：依職業查表 | `=index('攻速懲罰表'!$B$2:$C$36,match(C2,'攻速懲罰表'!$B$2:$B$36,0),2)` |

| C11 | 主手 Weapon Penalty：依職業 × 主手武器查表 | `=index('攻速懲罰表'!$B$2:$U$36,match(C2,'攻速懲罰表'!$B$2:$B$36,0),match(C3,'攻速懲罰表'!$B$2:$U$2,0))` |

| C12 | 副手/盾 Penalty：一般職業依職業 × 副手；刺客/十字刺客改查「左手」列 | `=if(or(C2="刺客",C2="十字刺客"),index('攻速懲罰表'!$B$2:$U$36,match(C2,'攻速懲罰表'!$B$2:$B$36,0)+1,match(C4,'攻速懲罰表'!$B$2:$U$2,0)),index('攻速懲罰表'!$B$2:$U$36,match(C2,'攻速懲罰表'!$B$2:$B$36,0),match(C4,'攻速懲罰表'!$B$2:$U$2,0)))` |

| C13 | Stat Bonus：AGI/DEX 的平方根公式，弓/樂器/鞭子使用不同 DEX 除數 | `=if(AND(C3<>"弓", C3<>"樂器", C3<>"鞭子"),SQRT(F8^2/5+F7^2/2)/4,SQRT(F8^2/7+F7^2/2)/4)` |

| C14 | Status Bonus：所有 Modifier 合計 × 最終 AGI / 200 | `=sum(K3:K13)*F7/200` |

| C15 | ASPD1：Base + Weapon + Shield + Stat + Status 後向下取整 | `=Floor(sum(C10:C14),1)` |

| C16 | ASPD2：把裝備攻速%與技能 ASPD% 套用到 (195-ASPD1) 的剩餘區間 | `=Floor(C15+(195-C15)*((F2+L16)/100),1)` |

| C17 | Final ASPD：ASPD2 + 固定素質 ASPD | `=C16+F3` |

| E7 | AGI 的 Buff 額外值選擇邏輯 | `=if(J15="是",P15,if(J5="是",P5,0))` |

| F7 | AGI Total；心神凝聚有效時，指定部分 AGI 乘 1.12 | `=if(Q6,sum(C7)*1.12+D7+E7,sum(C7:E7))` |

| E8 | DEX 的 Buff 額外值選擇邏輯 | `=if(J14="是",P14,if(J4="是",P4,0))` |

| F8 | DEX Total；心神凝聚有效時，指定部分 DEX 乘 1.12 | `=if(Q6,sum(C8)*1.12+D8+E8,sum(C8:E8))` |

| K16 | Modifier 合計 | `=sum(K3:K15)` |


### 建議網頁計算流程

```text
1. 根據 job 取得 Base ASPD。
2. 根據 job + mainWeapon 取得主手懲罰值。
   - 若查表結果為空白 / null / undefined，懲罰值直接當作 `0`。
   - 不檢查該職業是否「允許」使用此武器。
3. 根據 job + offHand 取得副手/盾懲罰值。
   - 若查表結果為空白 / null / undefined，懲罰值直接當作 `0`。
   - 不檢查該職業是否「允許」使用此副手。
   - 刺客、十字刺客的副手仍使用專用「(左手)」資料列；該列若為空白同樣視為 `0`。
4. 計算 Buff 對 AGI/DEX 的影響。
5. 若心神凝聚有效：
   - Excel 的 Total 邏輯不是把所有 AGI/DEX 一律 ×1.12；
   - 只對指定的 base/裝備區段套用 1.12，再加上不受影響的其他加成/Buff。
6. 依主手武器類型計算 Stat Bonus。
7. Status Bonus = Buff Modifier 合計 × AGI Total / 200。
8. ASPD1 = floor(BaseASPD + MainPenalty + OffHandPenalty + StatBonus + StatusBonus)。
9. ASPD2 = floor(ASPD1 + (195-ASPD1) × ((EquipmentAspdPct + SkillAspdPct)/100))。
10. FinalASPD = ASPD2 + FlatAspdBonus。
```

## 3. Buff 與既有網頁欄位整合

目前網頁已經有 BUFF、ASPD% 等相關欄位，因此後續 Agent 的工作重點不是重新建立 Excel 的 Buff UI，而是把**既有欄位輸出值接入 ASPD 核心公式**。

核心計算至少需要取得：

- Buff 所產生的 `Modifier` 合計，用於 Status Bonus。
- Buff 所產生的 `ASPD%` 合計，用於 ASPD2。
- Buff 對 AGI / DEX 的實際加成結果。
- 心神凝聚等特殊效果所需的狀態。

Excel 原始檔內雖然存在職業限制、武器限制等判斷，但**網頁版不要求依 Excel 的職業武器限制封鎖武器選擇**。武器懲罰單純依懲罰表查值；查不到或表格為空白就當作 `0`。

若現有 BUFF 系統本身已完成可用性判斷，應保留現有行為，不要為了模仿 Excel 而重做第二套判斷邏輯。


## 4. 攻速懲罰資料表（三轉版，網頁實作唯一資料來源）

說明：網頁版只使用此三轉版資料表。此表已包含前置二轉職業，因此不需要另外維護 `wo 三轉` 版本。第一個數值欄「空手」同時扮演該職業的 Base ASPD；其餘欄為裝備後直接加到 Base ASPD 的懲罰/修正值。空白不代表不可使用；網頁版允許照常選擇，計算時將該懲罰值視為 `0`。

| 職業 | 空手 | 盾 | 鈍器 | 單手杖 | 雙手杖 | 短劍 | 弓 | 單手劍 | 雙手劍 | 單手斧 | 雙手斧 | 單手矛 | 雙手矛 | 書 | 拳套 | 樂器 | 鞭子 | 拳刃 | 無 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 服事 | 156 | -7 | -5 | -20 | -20 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 弓箭手 | 156 | -9 |  |  |  | -15 | -10 |  |  |  |  |  |  |  |  |  |  |  |  |
| 魔法師 | 146 | -10 |  | -5 | -5 | 0 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 商人 | 156 | -5 | -10 |  |  | -12 |  | -12 |  | -8 | -15 |  |  |  |  |  |  |  |  |
| 劍士 | 156 | -5 | -10 |  |  | -7 |  | -7 | -14 | -15 | -20 | -17 | -25 |  |  |  |  |  |  |
| 盜賊 | 156 | -6 |  |  |  | -8 | -13 | -10 |  | -20 |  |  |  |  |  |  |  |  |  |
| 祭司 | 156 | -5 | -3 | -20 | -20 |  |  |  |  |  |  |  |  | -4 | -20 |  |  |  |  |
| 武僧 | 156 | -3 | -3 | -20 | -18 |  |  |  |  |  |  |  |  |  | 0 |  |  |  |  |
| 神官 | 156 | -3 | -3 | -20 | -20 |  |  |  |  |  |  |  |  | -4 | -20 |  |  |  |  |
| 武術宗師 | 156 | -3 | -3 | -20 | -18 |  |  |  |  |  |  |  |  |  | 0 |  |  |  |  |
| 獵人 | 156 | -9 |  |  |  | -13 | -7 |  |  |  |  |  |  |  |  |  |  |  |  |
| 詩人 | 156 | -5 |  |  |  | -13 | -8 |  |  |  |  |  |  |  |  | -5 |  |  |  |
| 舞孃 | 156 | -5 |  |  |  | -13 | -8 |  |  |  |  |  |  |  |  |  | -5 |  |  |
| 神射手 | 156 | -9 |  |  |  | -13 | -7 |  |  |  |  |  |  |  |  |  |  |  |  |
| 搞笑藝人 | 156 | -5 |  |  |  | -13 | -8 |  |  |  |  |  |  |  |  | -5 |  |  |  |
| 冷豔舞姬 | 156 | -5 |  |  |  | -13 | -8 |  |  |  |  |  |  |  |  |  | -5 |  |  |
| 巫師 | 146 | -8 |  | -3 | -3 | -4 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 賢者 | 151 | -3 |  | -10 | -10 | -8 |  |  |  |  |  |  |  | 2 |  |  |  |  |  |
| 超魔導士 | 146 | -8 |  | -3 | -3 | -4 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 智者 | 151 | -3 |  | -10 | -10 | -8 |  |  |  |  |  |  |  | 2 |  |  |  |  |  |
| 鐵匠 | 156 | -5 | -8 |  |  | -10 |  | -10 |  | -6 | -10 |  |  |  |  |  |  |  |  |
| 煉金術師 | 156 | -4 | -5 |  |  | -10 |  | -5 |  | -5 | -12 |  |  |  |  |  |  |  |  |
| 神工匠 | 156 | -5 | -8 |  |  | -10 |  | -10 |  | -6 | -10 |  |  |  |  |  |  |  |  |
| 創造者 | 156 | -4 | -5 |  |  | -10 |  | -5 |  | -5 | -12 |  |  |  |  |  |  |  |  |
| 騎士 | 156 | -5 | -5 |  |  | -9 |  | -5 | -2 | -10 | -15 | -15 | -20 |  |  |  |  |  |  |
| 十字軍 | 156 | -5 | -5 |  |  | -8 |  | -3 | -15 | -10 | -15 | -13 | -10 |  |  |  |  |  |  |
| 騎士領主 | 156 | -5 | -5 |  |  | -9 |  | -5 | -3 | -10 | -15 | -15 | -20 |  |  |  |  |  |  |
| 聖殿十字軍 | 156 | -5 | -5 |  |  | -8 |  | -3 | -15 | -10 | -15 | -13 | -10 |  |  |  |  |  |  |
| 刺客 | 156 |  |  |  |  | -2 |  | -10 |  | -11 |  |  |  |  |  |  |  | -2 |  |
| 刺客(左手) |  | -6 |  |  |  | -10 |  | -12 |  | -12 |  |  |  |  |  |  |  |  |  |
| 流氓 | 156 | -3 |  |  |  | -5 | -10 | -10 |  |  |  |  |  |  |  |  |  |  |  |
| 十字刺客 | 156 |  |  |  |  | -2 |  | -10 |  | -11 |  |  |  |  |  |  |  | -2 |  |
| 十字刺客(左手) |  | -6 |  |  |  | -10 |  | -12 |  | -12 |  |  |  |  |  |  |  |  |  |
| 神行太保 | 156 | -3 |  |  |  | -5 | -10 | -10 |  |  |  |  |  |  |  |  |  |  |  |


## 5. 「公式」分頁原始定義

| 項目 | 定義/公式 |
| --- | --- |
| ASPD1 | FLOOR(Base ASPD - Weapon/Shield Penalty + Stat Bonus + (Status Bonus* AGI/200)) |
| ASPD2 | FLOOR((195 - ASPD1) * %ASPD) + ASPD1 |
| Final ASPD | ASPD2 + Flat Bonus |
|  |  |
| Base ASPD: A base number determined by the character's class. (To find this, go to an individual class page, like Hunter, and scroll to the bottom.) |  |
| Weapon/Shield Penalty: A penalty based on the character's class and the weapon/shield being equipped. |  |
| Stat Bonus: bonus based on a Character's AGI and DEX. |  |
| Status Bonus (Potion Modifier + Skill Modifier): bonuses from status effects bestowed by ASPD potions and certain skills |  |
| %ASPD (%Equipment Bonus + %Skill Bonus): Percentage bonuses from certain skills (such as Two-Hand Quicken) and equipment |  |
| Flat Bonus: bonuses in the form of flat additions gained from certain equipment. |  |
|  |  |
|  |  |
| Bows, Instruments, Whips | √(DEX²/7 + AGI²/2) / 4 |
| Other weapons | √(DEX²/5 + AGI²/2) / 4 |


## 6. 建議的網頁資料結構

```ts
type WeaponType =
  | "空手" | "盾" | "鈍器" | "單手杖" | "雙手杖" | "短劍" | "弓"
  | "單手劍" | "雙手劍" | "單手斧" | "雙手斧" | "單手矛" | "雙手矛"
  | "書" | "拳套" | "樂器" | "鞭子" | "拳刃" | "無";

interface JobAspdData {
  job: string;
  baseAspd: number;
  // 缺少的武器 key 代表 penalty = 0，不代表禁止使用。
  penalties: Partial<Record<WeaponType, number>>;
  leftHandPenalties?: Partial<Record<WeaponType, number>>;
}

interface BuffData {
  name: string;
  modifier: number;
  aspdPercent: number;
  jobs?: string[];
  weapons?: WeaponType[];
}

interface AspdInput {
  job: string;
  mainWeapon: WeaponType;
  offHand: WeaponType;
  agiBaseEquip: number;
  agiOther: number;
  dexBaseEquip: number;
  dexOther: number;
  equipmentAspdPercent: number;
  flatAspdBonus: number;
  buffs: Record<string, boolean | string>;
}

interface AspdResult {
  agiTotal: number;
  dexTotal: number;
  baseAspd: number;
  mainPenalty: number;
  offHandPenalty: number;
  statBonus: number;
  statusBonus: number;
  aspd1: number;
  aspd2: number;
  finalAspd: number;
}
```

## 7. 建議純函式

```ts
function getWeaponPenalty(
  table: Partial<Record<WeaponType, number>>,
  weapon: WeaponType
): number {
  // 不做職業武器限制；空白/不存在直接視為 0。
  return table[weapon] ?? 0;
}
```

```ts
function calcStatBonus(agi: number, dex: number, mainWeapon: WeaponType) {
  const ranged = ["弓", "樂器", "鞭子"].includes(mainWeapon);
  return ranged
    ? Math.sqrt((dex * dex) / 7 + (agi * agi) / 2) / 4
    : Math.sqrt((dex * dex) / 5 + (agi * agi) / 2) / 4;
}

function calcAspd(params: {
  baseAspd: number;
  mainPenalty: number;
  offHandPenalty: number;
  statBonus: number;
  statusModifierTotal: number;
  agiTotal: number;
  equipmentAspdPercent: number;
  skillAspdPercent: number;
  flatAspdBonus: number;
}) {
  const statusBonus = params.statusModifierTotal * params.agiTotal / 200;

  const aspd1 = Math.floor(
    params.baseAspd +
    params.mainPenalty +
    params.offHandPenalty +
    params.statBonus +
    statusBonus
  );

  const aspdPct =
    (params.equipmentAspdPercent + params.skillAspdPercent) / 100;

  const aspd2 = Math.floor(
    aspd1 + (195 - aspd1) * aspdPct
  );

  return {
    statusBonus,
    aspd1,
    aspd2,
    finalAspd: aspd2 + params.flatAspdBonus
  };
}
```

## 8. Excel → Web 重製時必須保留的特殊規則

> **版本規則：攻速懲罰資料只維護三轉版 `攻速懲罰表`。不要建立 `wo 三轉` 第二套資料；三轉表已涵蓋前置二轉職業。**

1. **懲罰值直接相加**：表內已經是 `-4`、`-10` 等值，不要再乘 `-1`。
2. **不限制職業武器**：任何職業都可以選任何主手/副手武器。懲罰表空白、null 或不存在時，一律使用 `0`。
3. **刺客系副手特例**：刺客/十字刺客的副手仍需使用 `(左手)` 懲罰資料；若該格空白則同樣為 `0`。
4. **Stat Bonus 武器分流**：弓/樂器/鞭子使用 `DEX²/7`，其他使用 `DEX²/5`。
5. **ASPD 百分比不是直接乘 ASPD**：它只作用在 `195 - ASPD1` 的剩餘空間。
6. **固定 ASPD 最後才加**。
7. **既有 BUFF / ASPD% / 職業加成欄位優先沿用**：不要重做第二套 UI 或資料模型，先把現有輸出值接入核心公式。
8. **心神凝聚不是所有最終 AGI/DEX 一律乘 1.12**，必須重現 Excel 的分段加成邏輯。
9. **慈悲術/純白百合花**：原表註記為以天賜、加速滿級計算，且不與天賜/加速重複計算。
10. **空白懲罰 = 0**：這是網頁版明確規格，不視為錯誤、不支援，也不應阻止武器選擇。

## 9. 尚未包含但網頁完整版會需要的相依分頁

Excel 原始公式仍引用 `增益`、`職業加成`、`職業武器` 等分頁，但網頁目前已經有部分對應功能。

因此後續 Agent 應採以下原則：

- `職業加成`：優先使用現有網頁已完成的職業加成點數，不要重新建立。
- `增益 / BUFF`：優先使用現有 BUFF 欄位、ASPD% 與計算結果，不要重新建立。
- `職業武器`：**不要用來限制武器選擇**。
- 主手/副手下拉選單：可提供完整武器清單，不需要依職業過濾。
- ASPD 懲罰：唯一判斷依據是三轉版 `攻速懲罰表`；空白值統一轉為 `0`。

後續主要工作應集中在：**把現有網頁資料正確接進 ASPD 核心引擎，並確認計算結果與 Excel 一致。**
