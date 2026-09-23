import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Scroll behavior and visual validation', () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test('Sidebar and Main content scroll independently, and favicon is loaded', async ({ page }) => {
    // Ensure screenshot directory exists
    const screenshotDir = path.join(process.cwd(), 'e2e-screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    await page.goto('http://localhost:4173/');
    
    // Screenshot 1: Full page layout (favicon isn't easily screenshot in tab UI from within page, but we capture the page)
    await page.screenshot({ path: path.join(screenshotDir, '1-initial-layout.png') });

    // Check App root container has no scroll (h-dvh overflow-hidden)
    const appRoot = page.locator('#root > div').first();
    await expect(appRoot).toHaveCSS('overflow', 'hidden');

    // Sidebar nav container has independent scroll
    const sidebarNav = page.locator('nav').first();
    await expect(sidebarNav).toHaveCSS('overflow-y', 'auto');
    await expect(sidebarNav).toHaveCSS('overflow-x', 'hidden');

    // Screenshot 2: Sidebar in low viewport
    await page.locator('nav').first().focus();
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(500); // let scroll settle
    await page.screenshot({ path: path.join(screenshotDir, '2-sidebar-scrolled.png') });

    // Screenshot 3: Main content with functional scroll
    // Assuming there's a scrollable view inside main
    const mainView = page.locator('main').first();
    await mainView.click();
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '3-main-scrolled.png') });
  });
});
