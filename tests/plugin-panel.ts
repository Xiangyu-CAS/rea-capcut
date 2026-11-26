import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { PANEL_META } from "../src/core/pluginPanel";
import { startPluginHarness } from "./plugin-harness";

const fixtures = await mkdtemp(path.join(tmpdir(), "reacut-panel-test-"));
const video = path.join(fixtures, "panel-preview.mp4");
try {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30",
    "-f", "lavfi", "-i", "sine=frequency=660", "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-movflags", "+faststart", video]);
  const harness = await startPluginHarness([video]);
  try {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 708, height: 787 }, locale: "zh-CN", permissions: ["clipboard-read", "clipboard-write"] });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(harness.url);
      const panel = page.frameLocator("iframe");
      const dock = panel.locator(".reacut-workbench");
      const text = panel.getByRole("textbox", { name: "文字内容" });
      await expect(dock).toBeVisible();
      await expect(panel.locator("#screen, #typing")).toHaveCount(0);
      await expect(panel.getByRole("region", { name: "时间线", exact: true })).toBeVisible();
      await expect.poll(() => panel.locator("canvas").evaluate(canvas => {
        const context = (canvas as HTMLCanvasElement).getContext("2d")!;
        return context.getImageData((canvas as HTMLCanvasElement).width / 4, (canvas as HTMLCanvasElement).height / 4, 1, 1).data[1] > 200;
      })).toBe(true);

      const originalText = "蓝调时刻";
      const selected = panel.locator(".tl-clip").filter({ hasText: originalText });
      await selected.click();
      await expect(text).toBeVisible();
      await text.focus();
      await text.press("ControlOrMeta+a");
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.imeSetComposition", { text: "yuhou", selectionStart: 5, selectionEnd: 5 });
      const title = async () => (await harness.tool("reacut_state")).clips.find((clip: any) => clip.text)?.text.text;
      await expect(text).toHaveValue("yuhou");
      await page.waitForTimeout(180);
      assert.equal(await title(), originalText);
      await cdp.send("Input.insertText", { text: "雨后" });
      await expect.poll(title).toBe("雨后");
      await text.evaluate(async () => navigator.clipboard.writeText("街角\n你好，ReaCut"));
      await text.press("ControlOrMeta+v");
      await expect(text).toHaveValue("雨后街角\n你好，ReaCut");
      await expect.poll(title).toBe("雨后街角\n你好，ReaCut");
      await panel.getByRole("button", { name: "撤销", exact: true }).click();
      await expect.poll(title).toBe(originalText);
      await panel.getByRole("button", { name: "重做", exact: true }).click();
      await expect.poll(title).toBe("雨后街角\n你好，ReaCut");

      const state = await harness.tool("reacut_state");
      const panelState = await harness.call("reacut_panel_state");
      assert.deepEqual(panelState.content, []);
      assert.equal(panelState.structuredContent, undefined);
      assert.equal(panelState._meta[PANEL_META].revision, state.revision);
      assert(!JSON.stringify(panelState).includes(fixtures));
      assert((await harness.call("reacut_panel_media", { id: video, offset: 0, kind: "preview" })).isError);
      assert((await harness.call("reacut_panel_sync", { revision: state.revision, patch: { assetIds: ["unknown"] } })).isError);
      assert((await harness.call("reacut_panel_sync", { revision: state.revision - 1, playing: true })).isError);

      const clip = state.clips.find((item: any) => item.text);
      await harness.tool("reacut_propose_edit", { revision: state.revision, actions: [{ type: "setText", clipId: clip.id, text: "来自 MCP" }] });
      await panel.getByRole("button", { name: "预览", exact: true }).click();
      await expect(panel.getByRole("region", { name: "Agent 方案预览" })).toBeVisible();
      assert.equal(await title(), "雨后街角\n你好，ReaCut");
      await panel.getByRole("button", { name: "应用", exact: true }).click();
      await expect.poll(title).toBe("来自 MCP");
      await expect(text).toHaveValue("来自 MCP");

      const play = panel.locator(".player-controls .play-button");
      const before = (await harness.tool("reacut_state")).playhead;
      await play.click();
      await expect.poll(async () => (await harness.tool("reacut_state")).playhead).toBeGreaterThan(before + 0.2);
      await play.click();
      await expect.poll(async () => (await harness.tool("reacut_state")).playing).toBe(false);
      await page.setViewportSize({ width: 390, height: 700 });
      await expect(text).toBeVisible();
      const overflows = await dock.evaluate(element => document.documentElement.scrollWidth > innerWidth || element.scrollWidth > element.clientWidth);
      assert.equal(overflows, false);
      await panel.getByRole("button", { name: "添加文字" }).click();
      await expect.poll(async () => (await harness.tool("reacut_state")).clips.filter((item: any) => item.text).length).toBe(2);
      await expect(text).toBeVisible();
      assert(!harness.calls.has("reacut_frame") && !harness.calls.has("reacut_input"));
      assert.deepEqual(errors, []);
      console.log("Native sidebar passed: video, IME, clipboard, grouped undo/redo, MCP preview and apply, authorization, narrow layout.");
    } finally {
      await browser.close();
    }
  } finally {
    await harness.close();
  }
} finally {
  await rm(fixtures, { recursive: true, force: true });
}
