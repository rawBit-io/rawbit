import { Buffer } from "buffer";
import { readFileSync } from "fs";
import path from "path";

import { expect, test } from "@playwright/test";

import { repoRoot } from "./utils";

test("mining actions leave enough room for a readable title", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const fullFlow = JSON.parse(
    readFileSync(
      path.join(repoRoot, "src", "my_tx_flows", "p20_Mining.json"),
      "utf8",
    ),
  );
  const miningNode = fullFlow.nodes.find(
    (node: { data?: { functionName?: string } }) =>
      node.data?.functionName === "mine_nonce_range",
  );
  if (!miningNode) throw new Error("Mining node fixture is missing");
  miningNode.id = "node_mine_nonce";
  delete miningNode.parentId;
  delete miningNode.extent;
  miningNode.position = { x: 200, y: 100 };

  const fileInput = page.locator('input[type="file"][accept=".json"]');
  await fileInput.setInputFiles({
    name: "mining-node.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        nodes: [miningNode],
        edges: [],
      }),
    ),
  });

  const node = page.locator('[data-id="node_mine_nonce"]').first();
  await expect(node).toBeVisible();
  const mineButton = node.getByRole("button", { name: "Mine", exact: true });
  const clearButton = node.getByRole("button", { name: "Clear", exact: true });
  await expect(mineButton).toBeVisible();
  await expect(clearButton).toBeVisible();

  const attempts = node.locator("textarea").nth(2);
  await attempts.fill("101");
  await expect(attempts).toHaveValue("100");
  await attempts.blur();
  await page.mouse.move(1_000, 100);
  await page.waitForTimeout(200);

  const dimensions = await node.evaluate((element) => {
    const header = element.querySelector<HTMLElement>(".calc-node-header");
    const title = element.querySelector<HTMLElement>(".node-title");
    if (!header || !title) throw new Error("Mining node header is incomplete");
    const buttons = Array.from(
      header.querySelectorAll<HTMLButtonElement>("button"),
    );
    const mine = buttons.find((button) => button.textContent?.trim() === "Mine");
    const clear = buttons.find(
      (button) => button.textContent?.trim() === "Clear",
    );
    if (!mine || !clear) throw new Error("Mining actions are missing");

    const mineBox = mine.getBoundingClientRect();
    const clearBox = clear.getBoundingClientRect();

    return {
      headerHeight: header.offsetHeight,
      titleHeight: title.offsetHeight,
      titleWidth: title.offsetWidth,
      titleText: title.textContent?.trim(),
      actionCenterDifference: Math.abs(
        mineBox.top + mineBox.height / 2 - (clearBox.top + clearBox.height / 2),
      ),
    };
  });

  expect(dimensions.titleText).toBe("> Mine nonce");
  expect(dimensions.titleWidth).toBeGreaterThan(80);
  expect(dimensions.titleHeight).toBeLessThan(30);
  expect(dimensions.headerHeight).toBeLessThan(60);
  expect(dimensions.actionCenterDifference).toBeLessThan(1);

  await node.screenshot({
    path: testInfo.outputPath("mining-node.png"),
  });
});
