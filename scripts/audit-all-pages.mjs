import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';
const artifactDir = '/Users/watermelon/.gemini/antigravity/brain/4a15b53d-7087-4e8d-8c7a-28856f59d332';

async function main() {
  await mkdir(artifactDir, { recursive: true });

  // 1. 获取管理员会话
  const sessionRes = await fetch(`${baseUrl}/api/auth/admin-session`, {
    method: 'POST',
    headers: { origin: baseUrl },
  });
  const sessionData = await sessionRes.json();
  const csrfToken = sessionData.csrfToken;
  const cookieHeader = sessionRes.headers.get('set-cookie');
  let sessionValue = '';
  if (cookieHeader) {
    const match = cookieHeader.match(/sthstart_admin_session=([^;]+)/);
    if (match) sessionValue = match[1];
  }

  // 查一个 activity id
  let activityId = '';
  try {
    const actRes = await fetch(`${baseUrl}/api/admin/activities`, {
      headers: { cookie: `sthstart_admin_session=${sessionValue}` }
    });
    if (actRes.ok) {
      const data = await actRes.json();
      if (data.items && data.items.length > 0) activityId = data.items[0].id;
    }
  } catch {}

  // 查一个 character id
  let characterId = '';
  try {
    const charRes = await fetch(`${baseUrl}/api/admin/characters`, {
      headers: { cookie: `sthstart_admin_session=${sessionValue}` }
    });
    if (charRes.ok) {
      const data = await charRes.json();
      if (data.items && data.items.length > 0) characterId = data.items[0].id;
    }
  } catch {}

  const browser = await chromium.launch({ headless: true });
  // 标准视口宽度 1440x900 (常见 13/14 寸 MacBook 默认缩放比)
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  if (sessionValue) {
    await context.addCookies([
      {
        name: 'sthstart_admin_session',
        value: sessionValue,
        domain: '127.0.0.1',
        path: '/',
      },
    ]);
  }

  const page = await context.newPage();

  const pagesToAudit = [
    { url: '/', name: 'audit_page_home_dashboard' },
    { url: '/apps/story', name: 'audit_page_story_list' },
    { url: '/apps/activities', name: 'audit_page_activities_list' },
    ...(activityId ? [{ url: `/apps/activities/${activityId}`, name: 'audit_page_activity_studio' }] : []),
    { url: '/apps/characters', name: 'audit_page_characters_list' },
    ...(characterId ? [{ url: `/apps/characters/${characterId}`, name: 'audit_page_character_detail' }] : []),
    { url: '/apps/linshe', name: 'audit_page_linshe_app' },
    { url: '/settings/generation', name: 'audit_page_settings_generation' },
    { url: '/settings/control-center', name: 'audit_page_settings_control_center' },
  ];

  for (const item of pagesToAudit) {
    try {
      console.log(`Auditing ${item.url} ...`);
      await page.goto(`${baseUrl}${item.url}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      const screenshotPath = resolve(artifactDir, `${item.name}.png`);
      await page.screenshot({ path: screenshotPath });
      console.log(`  -> Saved: ${screenshotPath}`);
    } catch (e) {
      console.error(`  -> Failed ${item.url}:`, e);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
