/**
 * Capture product screenshots from the live deployment.
 *
 * Uses the already-installed Playwright. Real pages, real data, no mocking, so
 * the images in the README and the DEV post cannot drift from the product.
 */

import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.SHOT_BASE ?? "https://nightglass-aniruddha-adaks-projects.vercel.app";
const OUT = "docs";

mkdirSync(OUT, { recursive: true });

const consoleErrors = [];

async function shoot(page, path, file, options = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  if (options.before) await options.before(page);
  await page.waitForTimeout(options.settle ?? 1200);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: options.fullPage ?? false });
  console.log(`  wrote ${OUT}/${file}`);
}

const browser = await chromium.launch();

try {
  // Desktop
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[desktop] ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`[desktop pageerror] ${err.message}`));

  await shoot(page, "/", "screenshot-home.png");

  await shoot(page, "/tonight", "screenshot-tonight.png", {
    before: async (p) => {
      // Expand a factor so the evidence panel is visible in the image.
      const factor = p.locator("button[aria-expanded]").first();
      if (await factor.count()) await factor.click().catch(() => {});
    },
  });

  await shoot(page, "/catalogue", "screenshot-catalogue.png");
  await shoot(page, "/agent", "screenshot-agent.png", {
    before: async (p) => {
      const preset = p.getByTestId("preset-tools/list");
      if (await preset.count()) await preset.click().catch(() => {});
    },
    settle: 2500,
  });
  await shoot(page, "/method", "screenshot-method.png");
  await desktop.close();

  // Mobile, to prove the layout holds
  const mobile = await browser.newContext({ ...devices["Pixel 7"] });
  const mpage = await mobile.newPage();
  mpage.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[mobile] ${msg.text()}`);
  });
  await shoot(mpage, "/tonight", "screenshot-mobile.png");
  await mobile.close();
} finally {
  await browser.close();
}

if (consoleErrors.length > 0) {
  console.log("\nConsole errors observed:");
  for (const e of [...new Set(consoleErrors)]) console.log(`  ${e}`);
  process.exitCode = 1;
} else {
  console.log("\nNo console errors on any captured route.");
}