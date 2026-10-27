import { expect, type ElectronApplication, type Page } from "@playwright/test";

/** Legacy workflows assert Chinese labels. Choose the real Settings preference
 * during isolated test setup, independently of the CI machine locale. Do not
 * reload: startup projects are delivered once by the native bridge. Subsequent
 * launches retain this preference and leave recovery dialogs untouched. */
export async function firstChineseWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForSelector(".app-shell");
  const alreadyChinese = await page.evaluate(() =>
    localStorage.getItem("reacut-ui-language-v1") === JSON.stringify("zh-CN"),
  );
  if (!alreadyChinese) {
    // All callers use fresh isolated user data on their first launch. A recovery
    // dialog here is unexpected: do not dismiss it or discard its project.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".titlebar-actions button:has(svg.lucide-settings2)").click();
    const settings = page.getByRole("dialog");
    await settings.locator('select').selectOption("zh-CN");
    await settings.getByRole("button", { name: "完成", exact: true }).click();
  }
  await expect(page.locator(".titlebar-actions button").filter({ hasText: "设置 / Settings" })).toBeVisible();
  return page;
}
