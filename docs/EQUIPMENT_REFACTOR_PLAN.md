# 装备系统重构方案

## 现状问题

当前 `equipspartlist` 数组结构混乱：
```javascript
// 索引 0-13: 基础装备部位
// 索引 14-27: 对应的卡片（14=0的卡片, 15=1的卡片...）
// 索引 28-29: 宠物、石碑
// 索引 30-32: 扩增的武器卡片

// 导致的问题：
// 1. 索引计算复杂 (eqindex+2, eqindex+14, eqindex+30)
// 2. 难以扩展（例如：要加第4张武器卡片需要修改很多地方）
// 3. 代码可读性差
// 4. 维护困难
```

## 解决方案：数据版本控制 + 自动迁移

### 方案 1：添加版本字段（推荐 - 最安全）

**优点**：
- 不改变现有数据结构
- 完全向后兼容
- 可以逐步优化
- 用户数据不会丢失

**实现步骤**：

#### 1. 添加数据版本标识

```javascript
// 在 data 中添加
data: {
    // ...existing data...
    equipDataVersion: 1,  // 当前数据版本
    
    // 改进后的装备结构（保持向后兼容）
    equipspartlist: [
        // ... 现有的33个元素保持不变
    ]
}
```

#### 2. 创建迁移函数

```javascript
methods: {
    // 数据迁移主函数
    migrateEquipData(loadedData) {
        // 检查版本
        const currentVersion = this.equipDataVersion;
        const dataVersion = loadedData.version || 0; // 旧数据没有版本号，默认为0
        
        if (dataVersion < currentVersion) {
            console.log(`⚙️ 检测到旧版本数据 (v${dataVersion})，正在迁移到 v${currentVersion}...`);
            
            // 逐版本迁移
            if (dataVersion < 1) {
                loadedData = this.migrateToV1(loadedData);
            }
            // 未来如果有 v2, v3...
            // if (dataVersion < 2) {
            //     loadedData = this.migrateToV2(loadedData);
            // }
            
            console.log('✅ 数据迁移完成');
        }
        
        return loadedData;
    },
    
    // 迁移到版本 1：添加新字段
    migrateToV1(data) {
        // 为所有装备添加缺失的字段
        data.Equip = data.Equip || [];
        
        data.Equip.forEach(item => {
            // 确保有 version 字段
            if (!item.version) {
                item.version = 1;
            }
            
            // 确保装备对象有 targetSkillId 和 targetSkillName
            if (item.equip && !item.equip.hasOwnProperty('targetSkillId')) {
                item.equip.targetSkillId = null;
                item.equip.targetSkillName = null;
            }
            
            // 确保所有 effectlist 中的效果有 Enable 属性
            if (item.equip && item.equip.effectlist) {
                item.equip.effectlist.forEach(effect => {
                    if (!effect.hasOwnProperty('Enable')) {
                        effect.Enable = true;
                    }
                    if (!effect.hasOwnProperty('targetSkillId')) {
                        effect.targetSkillId = null;
                    }
                });
            }
        });
        
        data.version = 1;
        return data;
    },
    
    // 保存时添加版本信息
    SaveEquipDB() {
        const dataToSave = {
            version: this.equipDataVersion,
            Equip: this.StoreDB_Equip.map(item => ({
                ...item,
                version: this.equipDataVersion
            }))
        };
        
        const parsed = JSON.stringify(dataToSave);
        localStorage.setItem('StoreDB_Equip', parsed);
    },
    
    // 加载时检查并迁移
    LoadEquipDB() {
        if (localStorage.getItem('StoreDB_Equip')) {
            try {
                let loadedData = JSON.parse(localStorage.getItem('StoreDB_Equip'));
                
                // 兼容旧格式（直接是数组）
                if (Array.isArray(loadedData)) {
                    loadedData = {
                        version: 0,
                        Equip: loadedData
                    };
                }
                
                // 执行迁移
                loadedData = this.migrateEquipData(loadedData);
                
                this.StoreDB_Equip = loadedData.Equip;
                Enumerable.From(this.StoreDB_Equip).OrderBy(x => x.equip.id);
            } catch (e) {
                console.error("❌ 加载装备数据失败:", e);
                // 备份损坏的数据
                localStorage.setItem('StoreDB_Equip_backup_' + Date.now(), 
                    localStorage.getItem('StoreDB_Equip'));
            }
        }
    }
}
```

#### 3. 修改初始化代码

```javascript
mounted() {
    // ... 其他初始化代码 ...
    
    // 替换原来的加载代码
    // if (localStorage.getItem('StoreDB_Equip')) { ... }
    // 改为：
    this.LoadEquipDB();
    
    // ... 其他初始化代码 ...
}
```

### 方案 2：优化数据结构（长期方案）

**未来可以考虑的优化**：

```javascript
// 更好的结构（未来版本）
equipmentSlots: {
    weapon: {
        main: { equipname: '', effectlist: [], cards: [] },
        sub: { equipname: '', effectlist: [], cards: [] }
    },
    armor: {
        head: [
            { type: 'upper', equipname: '', effectlist: [], card: {} },
            { type: 'middle', equipname: '', effectlist: [], card: {} },
            { type: 'lower', equipname: '', effectlist: [], card: {} }
        ],
        body: { equipname: '', effectlist: [], card: {} },
        garment: { equipname: '', effectlist: [], card: {} },
        shoes: { equipname: '', effectlist: [], card: {} }
    },
    accessories: [
        { equipname: '', effectlist: [], card: {} },
        { equipname: '', effectlist: [], card: {} }
    ],
    shadow: { equipname: '', effectlist: [], enchant: {} },
    costume: { equipname: '', effectlist: [], enchant: {} },
    special: {
        pet: { equipname: '', effectlist: [] },
        runeTablet: { equipname: '', effectlist: [] }
    },
    custom: [
        { equipname: '', effectlist: [] },
        { equipname: '', effectlist: [] }
    ]
}
```

但这需要：
1. 大量重写代码
2. 复杂的迁移逻辑
3. 长时间测试

**不推荐立即实施**，建议先用方案1。

## 实施建议

### 立即执行（方案1）：

1. ✅ 添加 `equipDataVersion` 字段
2. ✅ 实现迁移函数 `migrateEquipData()`
3. ✅ 修改 `SaveEquipDB()` 添加版本信息
4. ✅ 修改加载逻辑调用迁移
5. ✅ 测试：
   - 新用户（无数据）
   - 旧用户（有旧数据）
   - 数据损坏情况

### 优化建议（可选）：

#### A. 添加辅助函数简化索引访问

```javascript
methods: {
    // 获取装备部位索引
    getEquipIndex(slotName) {
        const indexMap = {
            'mainWeapon': 0,
            'subWeapon': 1,
            'mainWeaponCard': 14,
            'subWeaponCard': 15,
            'mainWeaponCard2': 30,
            'mainWeaponCard3': 31,
            'mainWeaponCard4': 32,
            'pet': 28,
            'runeTablet': 29,
            // ... 其他映射
        };
        return indexMap[slotName];
    },
    
    // 获取装备对象
    getEquipSlot(slotName) {
        const index = this.getEquipIndex(slotName);
        return this.equipspartlist[index];
    },
    
    // 设置装备
    setEquipSlot(slotName, data) {
        const index = this.getEquipIndex(slotName);
        this.$set(this.equipspartlist, index, {
            id: this.equipspartlist[index].id,
            label: this.equipspartlist[index].label,
            ...data
        });
    }
}
```

使用示例：
```javascript
// 原来：
this.equipspartlist[0].equipname = 'xxx';

// 改为：
this.getEquipSlot('mainWeapon').equipname = 'xxx';
```

#### B. 添加常量定义

```javascript
// 在 data 外部定义常量
const EQUIP_INDEX = {
    MAIN_WEAPON: 0,
    SUB_WEAPON: 1,
    HEAD_UPPER: 2,
    HEAD_MIDDLE: 3,
    HEAD_LOWER: 4,
    ARMOR: 5,
    GARMENT: 6,
    SHOES: 7,
    ACCESSORY_1: 8,
    ACCESSORY_2: 9,
    SHADOW: 10,
    COSTUME: 11,
    CARD_SET: 12,
    CUSTOM: 13,
    
    // 卡片
    MAIN_WEAPON_CARD: 14,
    SUB_WEAPON_CARD: 15,
    // ... +14 offset
    
    // 特殊
    PET: 28,
    RUNE_TABLET: 29,
    
    // 扩增卡片
    MAIN_WEAPON_CARD_2: 30,
    MAIN_WEAPON_CARD_3: 31,
    MAIN_WEAPON_CARD_4: 32
};

// 使用：
this.equipspartlist[EQUIP_INDEX.MAIN_WEAPON].equipname = 'xxx';
```

## 备份策略

```javascript
methods: {
    // 导出所有数据
    exportAllData() {
        const allData = {
            version: this.equipDataVersion,
            exportDate: new Date().toISOString(),
            equipments: this.StoreDB_Equip,
            skills: this.StoreDB_Skill,
            allSets: this.StoreDB_AllSet,
            status: this.StoreDB_Status
        };
        
        const dataStr = JSON.stringify(allData, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `ROCalc_backup_${Date.now()}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    },
    
    // 导入数据（带验证）
    importAllData(fileContent) {
        try {
            const data = JSON.parse(fileContent);
            
            // 验证数据格式
            if (!data.version || !data.equipments) {
                throw new Error('无效的备份文件格式');
            }
            
            // 迁移数据
            const migratedData = this.migrateEquipData({
                version: data.version,
                Equip: data.equipments
            });
            
            // 应用数据
            this.StoreDB_Equip = migratedData.Equip;
            if (data.skills) this.StoreDB_Skill = data.skills;
            if (data.allSets) this.StoreDB_AllSet = data.allSets;
            
            // 保存到 localStorage
            this.SaveEquipDB();
            // ... 保存其他数据
            
            alert('✅ 数据导入成功！');
        } catch (e) {
            alert('❌ 导入失败: ' + e.message);
        }
    }
}
```

## 测试清单

- [ ] 新用户首次打开（无本地数据）
- [ ] 旧用户数据自动迁移
- [ ] 保存新装备
- [ ] 加载旧装备
- [ ] 编辑装备（技能增伤功能）
- [ ] 全装备配置保存/加载
- [ ] 多浏览器测试
- [ ] 数据导出/导入
- [ ] 错误数据处理（损坏的JSON）
- [ ] 控制台无错误信息

## 总结

**推荐做法**：
1. 立即实施方案1（数据版本控制）
2. 添加辅助函数优化代码可读性（可选）
3. 添加导出/导入功能给用户备份数据
4. 在显著位置提示用户备份数据
5. 长期考虑方案2（完全重构），但不急

这样可以：
- ✅ 保护现有用户数据
- ✅ 支持未来扩展
- ✅ 提高代码可维护性
- ✅ 不影响当前功能
