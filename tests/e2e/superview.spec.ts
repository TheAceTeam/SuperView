import { expect, test } from "@playwright/test";

test("scans fixture logs, renders timeline, opens replay, and toggles theme", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /No project indexed yet|Loading SuperView index/ })).toBeVisible();
  await page.getByRole("button", { name: "Scan Codex Logs" }).first().click();

  await expect(page.getByText(/Ingest completed/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "superview-fixture" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Engineering Timeline")).toBeVisible();
  await expect(page.getByText("Run Ledger")).toBeVisible();

  await page.locator(".run-row").first().click();
  await expect(page.getByText("Selected Run Replay")).toBeVisible();
  await page.getByRole("button", { name: /Play run/ }).click();
  await expect(page.locator(".agent")).toBeVisible();

  await page.getByLabel("Toggle theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
