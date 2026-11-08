import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const res = await fetch('http://127.0.0.1:9320/api/auth/admin-session', { method: 'POST' });
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/sthstart_admin_session=([^;]+)/);
  if (match) {
    await ctx.addCookies([{
      name: 'sthstart_admin_session',
      value: match[1],
      domain: '127.0.0.1',
      path: '/'
    }]);
  }
  const page = await ctx.newPage();
  page.on('console', m => console.log('LOG:', m.text()));
  await page.goto('http://127.0.0.1:9320/apps/characters');
  await page.waitForTimeout(2000);
  await page.click('button:has-text("多角色公共资产库")');
  await page.waitForTimeout(3000);

  const imgs = await page.$$eval('.break-inside-avoid img', els => els.map(e => ({
    src: e.src,
    natW: e.naturalWidth,
    natH: e.naturalHeight,
    complete: e.complete,
    disp: window.getComputedStyle(e).display,
    vis: window.getComputedStyle(e).visibility
  })));
  console.log('Found images count:', imgs.length);
  console.log('Sample images:', imgs.slice(0, 6));

  await browser.close();
}

main().catch(err => console.error(err));
