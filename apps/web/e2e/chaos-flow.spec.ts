import { expect, test } from "@playwright/test";
import fs from "node:fs";

/**
 * C5 acceptance gate, through the real UI and API with no source edits:
 * run a baseline -> inject malformed JSON -> compare traces -> download the report.
 */
test("baseline, inject malformed JSON, compare traces, download report", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("task-text")).toContainText("robotics task success");
  await expect(page.getByTestId("mode-badge")).toContainText("Offline fixtures");

  // Use the deliberately fragile agent so the fault produces a visible, honest FAIL.
  await page.getByTestId("agent-scripted-naive").click();
  await page.getByTestId("run-baseline").click();
  await expect(page.getByTestId("baseline-card").getByTestId("run-status")).toHaveAttribute("data-status", "PASSED", { timeout: 15_000 });

  await page.getByTestId("fault-malformed_json").click();
  await page.getByTestId("inject-fault").click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/);

  // Status reflects backend events; malformed data was silently used -> agent failure.
  await expect(page.getByTestId("status-reason")).toContainText("malformed_data_not_used", { timeout: 15_000 });
  await expect(page.getByTestId("fault-badge")).toContainText("Malformed JSON");
  await expect(page.getByTestId("fault-callout")).toContainText("get_benchmark call #1");

  // Side-by-side: baseline has no fault marker, chaos has one plus an invalid_json row.
  const chaos = page.getByTestId("chaos-timeline");
  const baseline = page.getByTestId("baseline-timeline");
  await expect(chaos.locator('[data-kind="fault"]')).toHaveCount(1);
  await expect(baseline.locator('[data-kind="fault"]')).toHaveCount(0);
  await expect(chaos.getByText("Invalid JSON", { exact: true })).toBeVisible();

  // Raw event expander.
  await chaos.locator('[data-phase="fault_injected"] button').click();
  await expect(chaos.getByTestId("raw-event")).toContainText('"fault_id": "malformed_json@get_benchmark#1"');

  // Report: which assertion failed, comparison, root cause.
  await expect(page.getByTestId("assertion-malformed_data_not_used")).toHaveAttribute("data-status", "FAIL");
  await expect(page.getByTestId("recovery-outcome")).toHaveText("Silent failure");
  await expect(page.getByTestId("root-cause")).toContainText("malformed_json@get_benchmark#1");

  // Download the JSON report.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-report").click()]);
  const report = JSON.parse(fs.readFileSync((await download.path())!, "utf8"));
  expect(report.run.status).toBe("FAILED");
  expect(report.fault.fault_type).toBe("malformed_json");
  expect(report.root_cause.failed_assertions).toContain("malformed_data_not_used");
  expect(JSON.stringify(report)).not.toMatch(/AIza[0-9A-Za-z_-]{30,}/);

  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/run-detail.png`, fullPage: true });
});

test("robust agent recovers from a 429 and the UI shows the green recovery marker", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("agent-scripted-robust").click();
  await page.getByTestId("fault-http_429").click();
  await page.getByTestId("inject-fault").click();
  await page.waitForURL(/\/runs\//);
  await expect(page.getByTestId("status-reason")).toContainText("All checks passed", { timeout: 15_000 });
  await expect(page.getByTestId("chaos-timeline").locator('[data-kind="recover"]').first()).toBeVisible();
  await expect(page.getByTestId("recovery-outcome")).toHaveText("Recovered");
});

test("invalid input surfaces as a visible error, not a toast", async ({ page }) => {
  await page.goto("/");
  const res = await page.request.post("/api/v1/runs/chaos", { data: { fault: { fault_type: "rm_rf" } } });
  expect(res.status()).toBe(422);
  await page.goto("/runs/does-not-exist");
  await expect(page.getByTestId("error-banner")).toContainText("404");
});
