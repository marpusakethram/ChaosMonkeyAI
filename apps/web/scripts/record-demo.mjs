// Records the real demo flow (one continuous session, no splicing) against running local servers:
//   API on :8000, web on :3000. Output: a .webm in DEMO_OUT (convert to GIF with ffmpeg).
import { chromium } from "@playwright/test";

const out = process.env.DEMO_OUT || "demo-video";
const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } });
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);

await page.goto(base);
await pause(1200);
await page.getByTestId("agent-scripted-naive").click();
await pause(600);
await page.getByTestId("run-baseline").click();
await page.getByTestId("baseline-card").getByText("PASSED", { exact: true }).waitFor({ timeout: 15000 });
await pause(1500);
await page.getByTestId("fault-malformed_json").scrollIntoViewIfNeeded();
await page.getByTestId("fault-malformed_json").click();
await pause(1200);
await page.getByTestId("inject-fault").click();
await page.waitForURL(/\/runs\//);
await page.getByTestId("status-reason").getByText("malformed_data_not_used").waitFor({ timeout: 15000 });
await pause(2200);
await page.getByTestId("chaos-timeline").locator('[data-phase="fault_injected"] button').click();
await pause(2000);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 260);
  await pause(450);
}
await page.getByTestId("assertion-malformed_data_not_used").scrollIntoViewIfNeeded();
await pause(2500);
await ctx.close();
await browser.close();
console.log("video written to", out);
