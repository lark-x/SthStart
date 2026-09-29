import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`剧情项目新建使用按需编辑浮层 ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/apps/story');
    await expect(page.getByRole('heading', { name: '剧情工作室' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '项目名称' })).toHaveCount(0);

    await page.getByRole('button', { name: '新建项目' }).click();
    const editor = page.getByRole('dialog', { name: '新建剧情项目' });
    await expect(editor).toBeVisible();
    await page.screenshot({ path: `artifacts/frontend-warm-audit-2026-09-29/story-create-${viewport.width}.png`, fullPage: false });
    const title = editor.getByRole('textbox', { name: '项目名称' });
    await title.fill('未提交的测试名称');
    await editor.getByRole('button', { name: '取消' }).click();
    const discard = page.getByRole('dialog', { name: '放弃项目名称？' });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: '放弃修改' }).click();
    await expect(editor).toHaveCount(0);

    await page.getByRole('button', { name: '新建项目' }).click();
    await expect(page.getByRole('textbox', { name: '项目名称' })).toHaveValue('');
    await expect(page.getByRole('dialog', { name: '新建剧情项目' }).getByRole('button', { name: '创建项目' })).toBeDisabled();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
