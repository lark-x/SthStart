import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`剧情项目新建使用按需编辑浮层 ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/apps/story');
    // 列表页改名为「剧情与记录工作室」，同时收纳剧情创作与对话感想两类项目。
    await expect(page.getByRole('heading', { name: '剧情与记录工作室', level: 1 })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '项目名称' })).toHaveCount(0);

    // 「全部项目」视图下头部「新建项目」默认按剧情创作工程新建，浮层标题随类型变化。
    const editor = page.getByRole('dialog', { name: '新建剧情创作工程' });
    const openCreate = page.getByRole('button', { name: '新建项目', exact: true });
    /*
     * 按钮在 hydration 前就已由 SSR 渲染可见，此时点击会被丢弃；
     * 与 portal.spec 中的标签切换同一处理：重试点击直到浮层出现。
     */
    for (let attempt = 0; attempt < 12 && !(await editor.isVisible()); attempt += 1) {
      await openCreate.click();
      await page.waitForTimeout(150);
    }
    await expect(editor).toBeVisible();
    await page.screenshot({ path: `artifacts/frontend-warm-audit-2026-09-29/story-create-${viewport.width}.png`, fullPage: false });
    const title = editor.getByRole('textbox', { name: '项目名称' });
    await title.fill('未提交的测试名称');
    await editor.getByRole('button', { name: '取消' }).click();
    const discard = page.getByRole('dialog', { name: '放弃未保存的新建项目？' });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: '放弃填写' }).click();
    await expect(discard).toHaveCount(0);
    await expect(editor).toHaveCount(0);

    await openCreate.click();
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('textbox', { name: '项目名称' })).toHaveValue('');
    await expect(editor.getByRole('button', { name: '创建项目' })).toBeDisabled();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
