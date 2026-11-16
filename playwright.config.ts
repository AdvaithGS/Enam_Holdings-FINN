import { defineConfig } from "@playwright/test";

/** Visual checks: every tab at phone and laptop width, compared with committed baselines. */
export default defineConfig({
  testDir: "tests",
  snapshotPathTemplate: "tests/snapshots/{arg}{ext}",
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  use: { baseURL: "http://127.0.0.1:3100", colorScheme: "light", locale: "en-IN", timezoneId: "Asia/Kolkata" },
  webServer: { command: "npm run start -- -p 3100", url: "http://127.0.0.1:3100", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  reporter: [["list"], ["html", { open: "never" }]],
});
