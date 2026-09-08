# 装备数据版本控制系统 - 测试指南

## ✅ 已实施的功能

### 1. 数据版本控制
- ✅ 添加了 `equipDataVersion: 1` 字段
- ✅ 保存装备时自动添加版本信息
- ✅ 加载时自动检测并迁移旧数据

### 2. 自动迁移系统
- ✅ `migrateEquipData()` - 主迁移函数
- ✅ `migrateToV1()` - 从版本0迁移到版本1
- ✅ 自动补充新字段（targetSkillId, targetSkillName, Enable）
- ✅ 向后兼容：支持旧格式数组自动转换

### 3. 数据加载
- ✅ `LoadEquipDB()` - 新的加载函数
- ✅ 自动检测旧格式（数组）并转换
- ✅ 错误处理：自动备份损坏的数据

### 4. 辅助功能
- ✅ `getEquipIndex(slotName)` - 通过名称获取索引
- ✅ `exportAllData()` - 导出备份
- ✅ `importAllData()` - 导入备份

### 5. 改进的保存函数
- ✅ `SaveEquipDB()` - 保存时添加版本信息
- ✅ 控制台日志记录

## 📝 测试清单

### 测试场景 1：新用户（推荐首先测试）
**步骤**：
1. 清除浏览器的 localStorage
   - 按 F12 打开开发者工具
   - 切换到 Console 标签
   - 输入：`localStorage.clear()`
   - 刷新页面

2. 创建一个新装备
   - 编辑任意装备部位
   - 添加一些效果
   - 点击确认

3. 检查控制台输出
   - 应该看到：`💾 裝備數據已保存 (版本 1)`

4. 刷新页面
   - 应该看到：`✅ 裝備數據已加載 (1 件裝備)`
   - 装备应该正确显示

**预期结果**：✅ 一切正常，没有错误

---

### 测试场景 2：有旧数据的用户（最重要）
**步骤**：
1. 如果您有旧的装备数据，直接刷新页面

2. 检查控制台输出
   - 应该看到：`📦 檢測到舊格式數據，正在轉換...`
   - 应该看到：`⚙️ 檢測到舊版本數據 (v0)，正在遷移到 v1...`
   - 应该看到：`✅ 數據遷移完成`
   - 应该看到：`✅ 裝備數據已加載 (X 件裝備)`

3. 检查装备是否正常显示
   - 所有旧装备应该都还在
   - 效果应该正确显示
   - 技能增伤相关的新功能应该可用

4. 编辑一个旧装备
   - 应该可以正常编辑
   - 新功能（技能选择）应该可用
   - 保存后刷新，数据应该保持

**预期结果**：✅ 旧数据自动升级，功能正常

---

### 测试场景 3：使用辅助函数
**步骤**：
1. 打开浏览器控制台（F12）
2. 输入以下命令测试：

```javascript
// 测试索引查找
app.getEquipIndex('mainWeapon')        // 应返回 0
app.getEquipIndex('mainWeaponCard')    // 应返回 14
app.getEquipIndex('mainWeaponCard2')   // 应返回 30
app.getEquipIndex('pet')               // 应返回 28
```

**预期结果**：✅ 返回正确的索引值

---

### 测试场景 4：导出备份（可选）
**步骤**：
1. 打开浏览器控制台
2. 输入：`app.exportAllData()`
3. 应该会自动下载一个 JSON 文件

**预期结果**：✅ 成功下载备份文件

---

### 测试场景 5：多种操作
**步骤**：
1. 创建新装备
2. 编辑装备添加技能增伤
3. 保存装备配置
4. 刷新页面
5. 加载装备
6. 再次编辑
7. 清空装备
8. 重新加载之前保存的装备

**预期结果**：✅ 所有操作都正常工作

---

## 🔍 如何验证迁移成功

### 方法 1：检查控制台
打开 F12，查看 Console 标签，应该看到：
```
✅ 裝備數據已加載 (X 件裝備)
```
如果有旧数据，还会看到：
```
📦 檢測到舊格式數據，正在轉換...
⚙️ 檢測到舊版本數據 (v0)，正在遷移到 v1...
✅ 數據遷移完成
```

### 方法 2：检查 localStorage
打开 F12 Console，输入：
```javascript
JSON.parse(localStorage.getItem('StoreDB_Equip'))
```
应该看到类似这样的结构：
```json
{
  "version": 1,
  "Equip": [
    {
      "uuid": "xxx",
      "equip": {
        "id": "weaponr",
        "label": "主手",
        "equipname": "xxx",
        "effectlist": [...],
        "targetSkillId": null,
        "targetSkillName": null
      },
      "version": 1
    }
  ]
}
```

### 方法 3：功能测试
1. 编辑装备
2. 点击"技能增傷 %"旁的"選擇"按钮
3. 应该能看到技能选择对话框
4. 选择一个技能
5. 输入增伤百分比
6. 点击"套用"
7. 保存装备
8. 刷新页面
9. 技能名称应该正确显示

---

## ⚠️ 注意事项

### 数据安全
1. **第一次加载时会自动迁移数据**
   - 旧数据不会被删除，只是添加了新字段
   - 迁移是安全的

2. **如果遇到错误**
   - 系统会自动备份损坏的数据
   - 备份key格式：`StoreDB_Equip_backup_[时间戳]`
   - 可以在 localStorage 中找到备份

3. **建议导出备份**
   - 在控制台输入：`app.exportAllData()`
   - 定期保存备份文件

### 兼容性
- ✅ 支持旧版本数据（无版本号的数组格式）
- ✅ 自动检测并转换
- ✅ 不会丢失任何数据
- ✅ 所有现有功能继续正常工作

### 未来扩展
如果将来需要添加更多字段：
1. 增加 `equipDataVersion` 数值（如：改为 2）
2. 添加新的迁移函数 `migrateToV2(data)`
3. 在 `migrateEquipData()` 中添加版本检查

示例：
```javascript
if (dataVersion < 2) {
    loadedData = this.migrateToV2(loadedData);
}
```

---

## 🎯 快速测试命令

打开浏览器控制台（F12），使用以下命令：

```javascript
// 1. 查看当前版本
app.equipDataVersion

// 2. 查看装备数量
app.StoreDB_Equip.length

// 3. 查看第一个装备的结构
app.StoreDB_Equip[0]

// 4. 测试索引函数
app.getEquipIndex('mainWeapon')

// 5. 导出备份
app.exportAllData()

// 6. 查看 localStorage 中的数据
JSON.parse(localStorage.getItem('StoreDB_Equip'))

// 7. 手动触发迁移测试（不要在生产环境使用！）
// app.LoadEquipDB()
```

---

## 💡 常见问题

### Q1: 我的旧装备还在吗？
**A**: 是的！迁移过程只是添加新字段，不会删除或修改现有数据。

### Q2: 如果迁移失败怎么办？
**A**: 系统会自动备份损坏的数据到 `StoreDB_Equip_backup_[时间戳]`，可以手动恢复。

### Q3: 如何恢复备份？
**A**: 
```javascript
// 查看所有备份
Object.keys(localStorage).filter(k => k.includes('backup'))

// 恢复特定备份
localStorage.setItem('StoreDB_Equip', localStorage.getItem('StoreDB_Equip_backup_[时间戳]'))
location.reload()
```

### Q4: 辅助函数有什么用？
**A**: 可以用名称代替数字索引，提高代码可读性。例如：
```javascript
// 旧方式
app.equipspartlist[0]

// 新方式
app.equipspartlist[app.getEquipIndex('mainWeapon')]
```

### Q5: 需要通知用户更新吗？
**A**: 不需要！迁移是自动的，用户无感知。但建议在界面上添加"导出备份"按钮。

---

## 🚀 建议的后续优化

1. **添加备份按钮到UI**
   - 在装备管理界面添加"导出备份"按钮
   - 让用户可以轻松备份数据

2. **添加版本号显示**
   - 在页面底部显示当前数据版本
   - 帮助调试和支持

3. **逐步使用辅助函数**
   - 在新代码中使用 `getEquipIndex()`
   - 提高代码可读性

4. **监控迁移情况**
   - 检查控制台日志
   - 确保用户数据正确迁移

---

## ✨ 总结

这个系统现在：
- ✅ 完全向后兼容
- ✅ 自动迁移旧数据
- ✅ 不会丢失用户数据
- ✅ 支持未来扩展
- ✅ 有错误保护
- ✅ 有备份功能
- ✅ 有调试工具

您可以放心部署！
