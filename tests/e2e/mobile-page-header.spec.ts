import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';
import { isOwnedDirectory } from './global-setup';

const pages = [
  { route: '/', name: 'home', title: '工作台', action: '新建创作' },
  { route: '/apps/projects', name: 'projects', title: '创作项目', action: '新建项目' },
  { route: '/apps/story-worlds', name: 'story-worlds', title: '故事世界', action: '运行设置' },
  { route: '/settings/public-services', name: 'public-services', title: '模型与公共服务', action: '刷新模型与扩展服务配置' },
] as const;

const toolbarNames = ['打开全站导航', '搜索与命令', '打开全局任务抽屉'];

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Visible header element has no bounding box');
  return bounds;
}

async function seedWorld(request: APIRequestContext) {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
  const response = await request.post(service + '/story-worlds/create-bundle', {
    headers: { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' },
    data: {
      idempotencyKey: 'header-audit-' + crypto.randomUUID(),
      definition: {
        title: '海雾中的末班船', summary: '守灯人发现今晚的归航名单上多了一个人。', timeLabel: '归航日',
        locations: [{ id: 'lighthouse', name: '旧灯塔', description: '海边的灯塔。' }],
        actors: [{
          id: 'keeper', name: '守灯人', role: 'main', locationId: 'lighthouse', goals: ['确认归航名单'],
          characterId: null, characterVersion: null, background: '', personality: '', speechStyle: '', appearance: '', referenceArtifactIds: [],
        }],
        sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
      },
      initialBranch: { title: '主线', mode: 'canon-gap', direction: '跟随归航名单。' },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return await response.json() as { world: { id: string }; branch: { id: string } };
}

for (const viewport of [
  { width: 320, height: 750 },
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  const phone = viewport.width < 640;
  for (const theme of viewport.width === 390 ? ['light-paper', 'dark-espresso'] : ['light-paper']) {
    test(`page headers at ${viewport.width}px in ${theme}`, async ({ browser, baseURL, request }, info) => {
      const world = await seedWorld(request);
      const context = await browser.newContext({
        baseURL,
        viewport,
        hasTouch: phone,
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      });
      try {
        const origin = new URL(baseURL!).origin;
        expect((await context.request.post('/api/auth/admin-session', { headers: { origin } })).ok()).toBe(true);
        await context.addInitScript(id => localStorage.setItem('sthstart_theme_id', id), theme);
        const page = await context.newPage();
        for (const fixture of pages) {
          await page.goto(fixture.name === 'story-worlds'
            ? fixture.route + '?world=' + world.world.id + '&branch=' + world.branch.id
            : fixture.route);
          await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await page.evaluate(() => document.fonts.ready.then(() => undefined));

          const header = page.locator('.tpl-header, .workspace-header').filter({
            has: page.getByRole('heading', { name: fixture.title, exact: true, level: 1 }),
          });
          const title = header.getByRole('heading', { name: fixture.title, exact: true, level: 1 });
          const action = header.getByRole('button', { name: fixture.action, exact: true });
          const search = header.getByRole('button', { name: '搜索与命令', exact: true });
          await expect(action).toBeEnabled();
          if (fixture.name === 'story-worlds') {
            await expect(header.getByRole('button', { name: '故事世界操作', exact: true })).toBeInViewport();
          }
          const [titleBox, actionBox, searchBox, headerBox] = await Promise.all([box(title), box(action), box(search), box(header)]);
          const centerY = ({ y, height }: { y: number; height: number }) => y + height / 2;
          expect(await title.evaluate(el => el.scrollWidth - el.clientWidth), fixture.name + ': clipped title').toBeLessThanOrEqual(1);
          const geometry = await page.evaluate(() => {
            const viewportWidth = document.documentElement.clientWidth;
            const overflow = document.documentElement.scrollWidth - viewportWidth;
            const overflowing = overflow <= 1 ? [] : [...document.querySelectorAll('body *')].flatMap(el => {
              const { right } = el.getBoundingClientRect();
              return right > viewportWidth + 1 ? [{ tag: el.tagName, class: el.getAttribute('class'), right }] : [];
            }).slice(0, 16);
            return { overflow, overflowing };
          });
          expect(geometry.overflow, `${fixture.route}: horizontal overflow ${JSON.stringify(geometry.overflowing)}`).toBeLessThanOrEqual(1);

          for (const controlName of phone || fixture.name === 'story-worlds' ? toolbarNames : toolbarNames.slice(1)) {
            const control = await box(header.getByRole('button', { name: controlName, exact: true }));
            expect(control.x, fixture.name + ': ' + controlName).toBeGreaterThanOrEqual(0);
            expect(control.x + control.width, fixture.name + ': ' + controlName).toBeLessThanOrEqual(viewport.width + 1);
            if (phone && fixture.name !== 'story-worlds') {
              expect(Math.min(control.width, control.height), 'touch target: ' + controlName).toBeGreaterThanOrEqual(44);
            }
          }
          expect(Math.abs(centerY(actionBox) - centerY(searchBox)), fixture.name + ': actions and global tools share a row').toBeLessThanOrEqual(2);
          if (!phone) {
            expect(headerBox.height, fixture.name + ': tablet/desktop header has one row').toBeLessThanOrEqual(64);
            expect(Math.abs(centerY(titleBox) - centerY(searchBox))).toBeLessThanOrEqual(4);
          }
          if (fixture.name === 'public-services') {
            const settingsNav = page.getByRole('navigation', { name: '设置中心二级导航' });
            await expect(settingsNav.getByRole('link', { name: '模型与连接', exact: true })).toHaveAttribute('aria-current', 'page');
            await expect(header.getByRole('tab', { name: '模型', exact: true })).toHaveAttribute('aria-selected', 'true');
          }
          if (viewport.width === 390) {
            await page.screenshot({ path: info.outputPath(fixture.name + '.png'), animations: 'disabled', scale: 'css' });
          }
        }
      } finally {
        await context.close();
      }
    });
  }
}

test('a narrow page header opens its help text inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await page.goto('/apps/activities');
  const header = page.locator('.tpl-header');
  const summary = header.locator('summary', { hasText: '说明' });
  const description = header.locator('.tpl-description');
  await expect(description).toBeHidden();

  await summary.focus();
  await summary.press('Enter');
  await expect(description).toBeInViewport({ ratio: 1 });
  const [headerBox, descriptionBox] = await Promise.all([box(header), box(description)]);
  expect(descriptionBox.x).toBeGreaterThanOrEqual(headerBox.x - 1);
  expect(descriptionBox.x + descriptionBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);

  await summary.press('Space');
  await expect(description).toBeHidden();
  await expect(summary).toBeFocused();
});
