---
name: db-migration-backup
description: >-
  Use when changing SQLite schemas, running migrations, checking integrity, or backing up
  and restoring SthStart data. Distinguish read-only checks and temporary test databases
  from operations that write real user databases or media assets.
---

# SthStart 数据库迁移与备份

SthStart 使用 WAL 模式的 SQLite。业务库与叙事档案库的实际路径由配置决定，默认文件名为 `sthstart.db` 与 `narrative.db`。

## 编写迁移

- 业务迁移位于 `apps/service/src/database.ts` 的 `SERVICE_DATABASE_MIGRATIONS`，叙事迁移位于 `apps/service/src/narrative-database.ts` 的 `NARRATIVE_DATABASE_MIGRATIONS`。
- 使用当前 `DatabaseMigration` 接口：`version`、`name`、`statements: readonly string[]`。版本取所属数组现有最大值加一，不照抄文档中的固定版本，不修改已经执行的迁移。
- 重建外键关联表时按迁移器约定使用 `foreignKeysOff`；需要拦截破坏性迁移时使用 `guard`，不要另写绕过事务和恢复逻辑的迁移脚本。
- 用临时数据库验证旧版本升级、已有数据保留和完整性；仅编写代码或运行临时测试，不要求备份真实用户数据库。

迁移项形状示意，字段与 SQL 按实际任务替换：

```typescript
{
  version: nextVersion, // 取当前迁移数组的最大版本 + 1
  name: 'add_example_field',
  statements: ['ALTER TABLE example_table ADD COLUMN example_field TEXT'],
}
```

## 检查和真实数据操作

```bash
npm run db:check
npm run db:integrity
```

这两个命令只读，不要求预先备份。`db:check` 检查迁移版本，`db:integrity` 运行 `PRAGMA integrity_check`。

迁移、恢复、重置真实数据前，确认目标配置和用户任务范围，备份当前数据，再执行必要操作。启动可能应用待执行迁移的服务也按真实写入处理。不能仅为了验证代码而自动迁移用户数据库。

```bash
npm run db:backup
npm run db:migrate
npm run db:check
npm run db:integrity
```

WAL 数据库使用项目备份工具生成一致快照，不能只复制活跃数据库的 `.db` 文件并忽略 WAL。

## 两种备份的区别

- `npm run db:backup`：生成数据库快照和 `media-manifest.json`，不复制媒体二进制文件。适用于数据库变更前保底；重置会删除资产，需要完整备份。
- 便携备份：复制数据库、当前工具覆盖的本地媒体与笔记附件，生成 `backup-manifest.json`，记录路径、哈希和缺失文件。不能把未下载的远程媒体当作已备份文件。

```bash
node --import tsx scripts/portable-backup.ts backup
node --import tsx scripts/portable-backup.ts verify <backup-dir>
node --import tsx scripts/portable-backup.ts restore <backup-dir> --confirm
npm run db:restore -- <backup-dir> --confirm
npm run db:reset -- --confirm
```

恢复前验证对应备份，停止使用目标数据库的服务；恢复或重置需已有明确授权，并保留 CLI 要求的 `--confirm`。用户已经明确要求恢复或重置时，不重复询问同一授权。`db:reset` 删除数据库、媒体目录和笔记资产，不用于解决普通迁移失败。
