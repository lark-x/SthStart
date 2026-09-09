# 原神角色卡在线检索汇总

生成日期：2026-09-09

这份目录由项目已经接入的 `CharacterTavernProvider` 生成，逐一检索当前可玩角色名册，并对候选详情和 PNG 角色卡执行项目自己的解析器。它是“候选索引”，不是数据库种子；不会自动创建或覆盖角色。

## 结果概览

| 状态 | 数量 | 含义 |
| --- | ---: | --- |
| 明确找到 | 22 | 名称/摘要能对应到原神单角色卡 |
| 待复核 | 13 | 同名卡、摘要不足或作品归属未能确认 |
| 仅场景卡 | 1 | 只找到 RPG/场景类卡，不作为单角色导入 |
| 未找到 | 84 | 在每个角色的英文名、别名和最多 3 页结果中没有合适候选 |
| 合计 | 120 | 当前名册中的可玩角色 |

完整机器可读结果见 [`genshin-character-card-catalog.json`](./genshin-character-card-catalog.json)。该 JSON 不保存第三方原始卡片，只保存来源、详情字段统计、下载哈希、解析格式和兼容性结果。

## 明确找到的候选

以下链接均来自 Character Tavern。导入前仍应在项目的“预览 → 字段映射 → 确认导入”流程中检查，不应直接把原卡的系统提示、作者备注或场景写入活动人设。

| 角色 | 候选卡 | 备注 |
| --- | --- | --- |
| Amber | [Amber (Genshin Impact)](https://character-tavern.com/character/sfw_b/amber_genshin_impact) | 描述较长，缺少独立性格字段 |
| Arlecchino | [Arlecchino](https://character-tavern.com/character/itvr/arlecchino) | 描述与开场较完整 |
| Candace | [Candace](https://character-tavern.com/character/june/candace_genshin_impact) | 有独立性格字段 |
| Chevreuse | [Chevreuse](https://character-tavern.com/character/727171hbbbhahh7/chevreuse) | 描述较完整 |
| Clorinde | [Clorinde](https://character-tavern.com/character/nightlybeta/clorinde_genshin_impact) | 描述较完整，原卡自称早期尝试 |
| Eula | [Eula Lawrence](https://character-tavern.com/character/nightlybeta/eula_lawrence_genshin_impact) | 描述较完整 |
| Furina | [Furina Fontaine](https://character-tavern.com/character/bananashark892/furina_fontaine__genshin_impact) | 当前最完整：有性格字段和 4 组示例对话 |
| Ganyu | [Ganyu](https://character-tavern.com/character/leo/Ganyu) / [Ganyu 2](https://character-tavern.com/character/dmanhodge/ganyu) | 前者描述长，后者结构字段更好 |
| Hu Tao | [Hu Tao](https://character-tavern.com/character/dmanhodge/hu_tao) | 有独立性格字段；另有更长但需整理的候选 |
| Jean | [Jean](https://character-tavern.com/character/jamal12/jean_gunnhildr) | 描述很长，缺少独立性格字段 |
| Lisa | [Lisa](https://character-tavern.com/character/dmanhodge/lisa) | 内容较短 |
| Lohen | [Lohen](https://character-tavern.com/character/bluerose/lohen) | 描述提到 Genshin 角色 |
| Nilou | [Nilou](https://character-tavern.com/character/banesis/nilou) | 描述较长 |
| Ningguang | [Ningguang](https://character-tavern.com/character/goldhhahahbb/ningguang) | 描述较完整 |
| Raiden Shogun | [Raiden Shogun](https://character-tavern.com/character/davi_5241/raiden_shogun) | 有简短独立性格字段 |
| Shenhe | [Shenhe](https://character-tavern.com/character/r_o_y/shenhe_liyues_cursed_child) | 项目解析器同时给出场景卡警告，需复核 |
| Traveler | [Aether](https://character-tavern.com/character/r_o_y/aether_the_main_genshin_boy) / [Lumine](https://character-tavern.com/character/sfw_b/lumine_genshin_impact) | 建议拆成两个独立角色版本 |
| Venti | [Venti](https://character-tavern.com/character/teyvattraveller1441/venti) | V2 卡，描述较长 |
| Wanderer | [Wanderer](https://character-tavern.com/character/teyvattraveller1441/wanderer_scaramouche_the_balladeer) | 描述较短，需补写 |
| Xilonen | [Xilonen](https://character-tavern.com/character/davi_5241/xilonen) | 有性格和示例，但整体较短 |
| Yae Miko | [Yae Miko](https://character-tavern.com/character/itvr/yae_miko) / [Yae Miko 2](https://character-tavern.com/character/dmanhodge/yae_miko) | 前者描述长，后者结构字段更好 |
| Yelan | [Yelan](https://character-tavern.com/character/imi/yelan) | 有独立性格字段，但项目解析器给出场景卡警告 |

## 待复核和排除

待复核角色：Albedo、Bennett、Charlotte、Chiori、Jahoda、Layla、Mika、Mona、Navia、Nicole、Noelle、Varka、Xiao。它们目前只有同名卡或内容不足，不能仅凭名字导入。

Gaming 只命中 RPG/场景卡。`Genshin Impact - Massive Lore`、`Genshin Impact RPG`、世界书和多人场景卡也不在单角色候选中。

## 刷新方式

```bash
node --import tsx/esm scripts/collect-genshin-character-catalog.mjs --pages=3 --workers=4
```

脚本会重新查询来源并覆盖 JSON 汇总，不会写入角色数据库。原神角色名册基线来自 [Character/List](https://genshin-impact.fandom.com/wiki/Character/List)，来源和检索时间会记录在 JSON 的 `scope` 字段中。
