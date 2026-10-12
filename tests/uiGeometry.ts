import type { Page } from "@playwright/test";
import assert from "node:assert/strict";
/** Verify layout before a click can hide overflow through automatic scrolling. */
export async function verifyEditorViewport(page: Page) {
  const geometry = await page.evaluate(() => {
    const inspector = document
      .querySelector(".inspector")
      ?.getBoundingClientRect();
    const exportButton = document
      .querySelector(".titlebar .export-button")
      ?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      scrollLeft: document.scrollingElement?.scrollLeft ?? 0,
      inspector: inspector
        ? {
            left: inspector.left,
            right: inspector.right,
            width: inspector.width,
          }
        : null,
      exportButton: exportButton
        ? {
            left: exportButton.left,
            right: exportButton.right,
            width: exportButton.width,
          }
        : null,
    };
  });
  assert(
    geometry.inspector &&
      geometry.inspector.left >= -1 &&
      geometry.inspector.right <= geometry.width + 1,
    `Inspector must fit the viewport: ${JSON.stringify(geometry)}`,
  );
  assert(
    geometry.exportButton &&
      geometry.exportButton.left >= -1 &&
      geometry.exportButton.right <= geometry.width + 1,
    `Header export control must fit the viewport: ${JSON.stringify(geometry)}`,
  );
  assert(
    geometry.documentWidth <= geometry.width + 1 && geometry.scrollLeft === 0,
    `Editor must not depend on horizontal document scrolling: ${JSON.stringify(geometry)}`,
  );
  return geometry;
}
