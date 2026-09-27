---
name: db-migration-backup
description: >-
  Use this skill when modifying database schemas, running SQLite migrations, checking data integrity,
  or performing database backup and restore operations in SthStart.
---

# 数据库变更与便携备份指南 (DB Migration & Backup)

SthStart 使用本地 SQLite 数据库（WAL 模式），主要包含业务主库（`sthstart.db`）与叙事档案库（`narrative.db`）。

修改数据库或执行数据运维时，必须严格遵守“**先检查 ➔ 必备份 ➔ 慎迁移 ➔ 验完整性**”的安全原则。

---

## 核心运维命令速查

```bash
# 1. 状态与完整性检查
npm run db:check                # 检查当前版本与迁移状态
npm run db:integrity            # 运行 SQLite PRAGMA integrity_check

# 2. 数据库迁移
npm run db:migrate              # 执行未执行的迁移脚本

# 3. 原始数据库快照备份与还原 (VACUUM INTO)
npm run db:backup               # 备份到 data/backups/<timestamp>/
npm run db:restore -- <dir> --confirm  # 从指定目录恢复数据库

# 4. 便携备份（包含数据库 + 媒体资产清单）
node --import tsx scripts/portable-backup.ts backup [target-dir]
node --import tsx scripts/portable-backup.ts verify <backup-dir>
node --import tsx scripts/portable-backup.ts restore <backup-dir> --confirm
```

---

## 场景一：修改表结构与编写数据库迁移

当你需要新增字段、修改表结构或创建新表时：

### 1. 确认迁移定义位置
- 业务主库迁移：`apps/service/src/database.ts` 中的 `SERVICE_DATABASE_MIGRATIONS` 数组。
- 叙事档案库迁移：`apps/service/src/narrative-database.ts` 中的 `NARRATIVE_DATABASE_MIGRATIONS` 数组。

### 2. 迁移定义规范
每个迁移项包含唯一的递增 `version` 与 SQL 升级语句：
```typescript
{
  version: 12, // 必须紧接上一版本的递增整数
  up: `
    ALTER TABLE activities ADD COLUMN review_notes TEXT;
    CREATE INDEX IF NOT EXISTS idx_activities_review ON activities(review_notes);
  `,
}
```

### 3. 安全执行流程
1. **备份当前数据库**：
   ```bash
   npm run db:backup
   ```
2. **执行迁移**：
   ```bash
   npm run db:migrate
   ```
3. **校验迁移结果**：
   ```bash
   npm run db:check
   npm run db:integrity
   ```

---

## 场景二：便携备份与数据恢复 (Portable Backup)

便携备份是 SthStart 提供的综合备份机制，不仅包含 SQLite 数据库，还记录了媒体资产（Artifacts）的校验哈希与相对路径。

### 1. 创建便携备份
```bash
node --import tsx scripts/portable-backup.ts backup
```
- 产物将存放在备份目录下，生成 `manifest.json` 与数据库副本。

### 2. 验证备份完整性
在还原之前，务必验证备份文件是否损坏：
```bash
node --import tsx scripts/portable-backup.ts verify <backup-dir>
```

### 3. 从备份中恢复
> [!CAUTION]
> 恢复操作会覆盖当前的数据库文件，必须明确携带 `--confirm` 参数。
```bash
node --import tsx scripts/portable-backup.ts restore <backup-dir> --confirm
```

---

## 危险操作警告 (Reset)

重置数据库会彻底删除数据库文件及关联的本地资产：
```bash
# 严禁在未确认的情况下使用！
npm run db:reset -- --confirm
```
执行前请务必确认已做好备份。
