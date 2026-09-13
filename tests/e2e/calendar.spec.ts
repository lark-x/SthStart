import { expect, test } from '@playwright/test';

const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

test('calendar shows same-day birthdays and prefills a joint birthday activity', async ({ page, request }) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = 15;
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const suffix = Date.now().toString(36);
  const first = `寿星甲${suffix}`;
  const second = `寿星乙${suffix}`;

  for (const name of [first, second]) {
    const response = await request.post(`${service}/api/v1/admin/characters`, {
      headers,
      data: { displayName: name, draft: { displayName: name, work: '原神', birthday: { status: 'known', calendar: 'gregorian', month, day, source: 'manual' } } },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }

  await page.goto('/apps/calendar');
  await expect(page.getByRole('heading', { name: '角色日历' })).toBeVisible();

  // 日期格可能被其他测试数据占满，因此以“日期详情面板”为准来核对当天全部生日。
  const dayCell = page.getByRole('button', { name: new RegExp(`^${dateKey}，\\d+ 项事件`) });
  await expect(dayCell).toBeVisible();
  await dayCell.click();
  await expect(page.getByText(new RegExp(`寿星（\\d+）`))).toBeVisible();
  await expect(page.getByText(first)).toBeVisible();
  await expect(page.getByText(second)).toBeVisible();
  await page.getByLabel(`选择${first}`).check();
  await page.getByLabel(`选择${second}`).check();
  await page.getByRole('button', { name: /为选中的 2 位寿星合办生日活动/ }).click();

  await expect(page).toHaveURL(/\/apps\/activities\/new\?/);
  const title = page.getByLabel('活动标题');
  await expect(title).toHaveValue(new RegExp(`${first}、${second}`));
  await expect(page.getByLabel('活动日期')).toHaveValue(dateKey);

  // 生日模板带出四个阶段，并且默认把两位都标记为寿星。
  await expect(page.getByLabel('阶段 1 标题')).toBeVisible();
  await expect(page.getByRole('button', { name: /04\s/ })).toHaveCount(1);
  await page.getByRole('button', { name: /04\s/ }).click();
  await expect(page.getByLabel('阶段 4 标题')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '本场寿星' }).first()).toBeChecked();

  await page.getByRole('button', { name: '直接创建活动' }).click();
  await expect(page).toHaveURL(/\/apps\/activities\/[a-f0-9-]+$/);
  await expect(page.getByText(new RegExp(`${first}、${second}`)).first()).toBeVisible();

  // 新活动按日期出现在日历上。
  await page.goto('/apps/calendar');
  /*
   * 日历详情面板要在接口返回后才包含刚建的活动；并行跑用例时这段时间会变长。
   * 因此重试“打开当天详情并确认新活动在列”，而不是在固定超时内只查一次，
   * 断言本身仍然是“新活动按日期出现在日历上”。
   */
  await expect(async () => {
    const dayCellAfter = page.getByRole('button', { name: new RegExp(`^${dateKey}，\\d+ 项事件`) });
    await dayCellAfter.click();
    await expect(page.getByText(`${first}、${second}的生日聚会`).first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
});
