import { chromium } from 'playwright';

const ARTIFACT_DIR = 'C:/Users/12938/.gemini/antigravity/brain/42d31ee0-4479-41bb-9369-11750b3efbc9';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 960 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:9320/apps/activities...');
  await page.goto('http://localhost:9320/apps/activities', { waitUntil: 'networkidle' });

  // Find any activity card link
  const activityLinks = await page.$$('a[href^="/apps/activities/"]');
  let targetHref = null;
  for (const link of activityLinks) {
    const href = await link.getAttribute('href');
    if (href && href !== '/apps/activities/new') {
      targetHref = href;
      break;
    }
  }

  if (!targetHref) {
    console.log('Taking screenshot of activities list');
    await page.screenshot({ path: `${ARTIFACT_DIR}/deployed_activities_list.png`, fullPage: false });
    await browser.close();
    return;
  }

  console.log(`Entering activity: ${targetHref}`);
  await page.goto(`http://localhost:9320${targetHref}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Take screenshot of the activity studio workspace
  const outputPath = `${ARTIFACT_DIR}/activity_studio_deployed_live.png`;
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`Saved screenshot to ${outputPath}`);

  await browser.close();
}

main().catch(err => {
  console.error('Screenshot error:', err);
  process.exit(1);
});
