/**
 * 外部流水线 (Harness / 独立脚本) 示例：
 *
 * 演示如何通过 3 步实现：
 * 1. 外部脚本通过 MCP 抓取资料与剧本设定；
 * 2. 外部脚本调用本地 ComfyUI 生成分镜图片或视频；
 * 3. 跑完后调用 SthStart 的同步接口，瞬间将多镜头工程送入网页审片室。
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const STHSTART_API_URL = process.env.STHSTART_API_URL || 'http://localhost:9320/api/admin/activities/sync-external';
const ADMIN_TOKEN = process.env.STHSTART_ADMIN_TOKEN || '';

async function runHarnessPipeline() {
  console.log('=====================================================');
  console.log('🎬 外部流水线启动：MCP 取数 + ComfyUI 生成 + 审片室同步');
  console.log('=====================================================\n');

  // ---------------------------------------------------------
  // 第一步：通过 MCP 获取数据（这里模拟 MCP 查询原神 Wiki 角色资料与设定）
  // ---------------------------------------------------------
  console.log('📌 步骤 1: 模拟通过 MCP 查询角色设定与背景资料...');
  const mcpData = {
    theme: '雪山营地的神秘炼金反应',
    actors: [
      {
        id: 'actor_albedo',
        displayName: '阿贝多',
        activityRole: '首席炼金术士',
        persona: { tone: '沉静、敏锐、温和' },
        outfitDescription: '蒙德西风骑士团炼金术士常服',
        avatarUrl: '/uploads/albedo_avatar.png',
      },
      {
        id: 'actor_sucrose',
        displayName: '砂糖',
        activityRole: '炼金术助手',
        persona: { tone: '内向、专注、认真' },
        outfitDescription: '西风骑士团研究员装束',
      },
    ],
  };
  console.log(`✓ 获取到 2 位角色档案：${mcpData.actors.map((a) => a.displayName).join('、')}\n`);

  // ---------------------------------------------------------
  // 第二步：通过 ComfyUI 生成图片/视频（这里准备生成的媒体文件）
  // ---------------------------------------------------------
  console.log('🎨 步骤 2: 模拟调用 ComfyUI 批量渲染视频与分镜图片...');
  const outputDir = resolve(process.cwd(), 'temp_harness_output');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // 模拟 ComfyUI 生成出来的视频文件和高清分镜图
  const sampleVideoPath = resolve(outputDir, 'scene1_albedo_experiment.mp4');
  const sampleImagePath = resolve(outputDir, 'scene2_sucrose_reaction.png');

  // 生成测试用的占位文件（真实使用中由 ComfyUI API 写入实际 mp4/png）
  writeFileSync(sampleVideoPath, 'MP4_VIDEO_HEADER_DUMMY_BINARY_DATA');
  writeFileSync(sampleImagePath, 'PNG_IMAGE_HEADER_DUMMY_BINARY_DATA');

  console.log(`✓ 渲染完成分镜视频: ${sampleVideoPath}`);
  console.log(`✓ 渲染完成分镜大图: ${sampleImagePath}\n`);

  // ---------------------------------------------------------
  // 第三步：将生成的完整分镜工程推送到 SthStart 导演审片室
  // ---------------------------------------------------------
  console.log('🚀 步骤 3: 打包推送至 SthStart 审片室 (自动转存并入库)...');
  const payload = {
    title: '阿贝多与砂糖的雪山新发现',
    theme: mcpData.theme,
    actors: mcpData.actors,
    scenes: [
      {
        id: 'scene_albedo_camp',
        title: '第 1 场：雪山低温萃取',
        timeText: '傍晚 18:30',
        locationText: '龙脊雪山·阿贝多的营地',
        environment: '风雪渐起，烧瓶内泛出浅金色微光',
        beats: [
          {
            id: 'beat_1',
            characterId: 'actor_albedo',
            characterName: '阿贝多',
            action: '阿贝多 轻轻摇晃试管，注视着结晶的分子重组',
            dialogue: '低温并未抑制反应，反而激发出意想不到的稳定性。',
            outcome: '成功提炼出高纯度星银晶露',
            mediaUrl: sampleVideoPath, // 外部脚本直接填本地文件路径，后台自动复制归档
            mediaType: 'video',
          },
          {
            id: 'beat_2',
            characterId: 'actor_sucrose',
            characterName: '砂糖',
            action: '砂糖 紧张地在实验日志上快速记录温度参数',
            dialogue: '阿贝多先生，第七号催化剂的沉淀速率比平时快了三倍！',
            outcome: '确认了温度对催化效率的倍增效应',
            mediaUrl: sampleImagePath,
            mediaType: 'image',
          },
        ],
      },
    ],
  };

  const headers = { 'Content-Type': 'application/json' };
  if (ADMIN_TOKEN) headers['x-sthstart-admin-token'] = ADMIN_TOKEN;

  try {
    const res = await fetch(STHSTART_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`同步请求失败 [${res.status}]: ${errBody}`);
    }

    const result = await res.json();
    console.log('🎉 同步成功！');
    console.log(`- 活动 ID: ${result.activityId}`);
    console.log(`- 版本号: v${result.headVersion}`);
    console.log(`- 场次数: ${result.sceneCount}`);
    console.log(`- 分镜数: ${result.beatCount}`);
    console.log(`\n👉 现在打开浏览器访问: http://localhost:9320/apps/activities/${result.activityId}`);
    console.log('   点击「快速试演」即可在大屏审片室连贯播放 ComfyUI 视频与台词演出！');
  } catch (err) {
    console.error('❌ 同步异常:', err.message);
  }
}

runHarnessPipeline();
