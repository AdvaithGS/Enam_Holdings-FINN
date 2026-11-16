import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Nothing ships unseen. Each tab is rendered at 390 px and 1440 px against a frozen copy
 * of the data (tests/fixtures), so a diff means the interface changed, not the market.
 * Baselines live in tests/snapshots and are refreshed deliberately:
 *   npx playwright test --update-snapshots      (or run the "Visual checks" workflow with update = true)
 */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const DATA: Record<string, string> = {
  "/data/digest.json": "digest.json", "/data/market.json": "market.json", "/data/network.seed.json": "network.seed.json",
  "/data/hierarchy.json": "hierarchy.json", "/data/universe.json": "universe.json", "/data/research/KAYNES.json": "research-KAYNES.json",
};
const PAGES = [
  { name: "brief-month", path: "/?w=30d", ready: "things need you" },
  { name: "brief-week", path: "/?w=7d", ready: "filings across" },
  { name: "book", path: "/book", ready: "on cost" },
  { name: "ask", path: "/ask?q=adhesives", ready: "Pidilite" },
  { name: "people", path: "/network", ready: "covering" },
  { name: "research", path: "/research/KAYNES?tab=management", ready: "Promised vs delivered" },
];

for (const [label, width] of [["phone", 390], ["laptop", 1440]] as const) {
  for (const p of PAGES) {
    test(`${p.name} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const [url, file] of Object.entries(DATA)) await page.route(`**${url}`, (r) => r.fulfill({ contentType: "application/json", body: fixture(file) }));
      await page.route("**/api/research**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ matches: [], themes: [] }) }));
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(p.path);
      await expect(page.getByText(p.ready, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(600);
      expect(errors, "the page threw").toEqual([]);
      await expect(page).toHaveScreenshot(`${p.name}-${label}.png`, { fullPage: true });
    });
  }
}

test("every control on the Brief is at least 44 px tall and shows focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  for (const [url, file] of Object.entries(DATA)) await page.route(`**${url}`, (r) => r.fulfill({ contentType: "application/json", body: fixture(file) }));
  await page.goto("/?w=30d");
  await expect(page.getByText("things need you").first()).toBeVisible({ timeout: 30_000 });
  const small = await page.$$eval("main button, nav a", (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height < 43.5 && !e.classList.contains("n") && !e.classList.contains("link") && !e.classList.contains("pname"); }).map((e) => `${e.className}: ${Math.round(e.getBoundingClientRect().height)}`));
  expect(small, "tap targets under 44 px").toEqual([]);
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).not.toBe("none");
});
