import { describe, expect, it } from "vitest";
import { placeAnchored } from "../styles/fluent/src/behavior/anchorPosition.js";
import {
  registerOverlay,
  requestCloseTop,
  resetOverlayStack,
} from "../styles/fluent/src/behavior/overlayStack.js";

describe("Fluent overlay behavior", () => {
  it("flips an anchored panel when there is more room above the anchor", () => {
    const position = placeAnchored(
      { top: 560, left: 120, width: 40, height: 32 },
      { width: 280, height: 220 },
      { width: 800, height: 700 },
    );
    expect(position).toMatchObject({ side: "top", left: 120 });
    expect(position.top).toBeLessThan(560);
  });

  it("keeps a panel inside the viewport edge", () => {
    const position = placeAnchored(
      { top: 20, left: 760, width: 30, height: 30 },
      { width: 240, height: 100 },
      { width: 800, height: 500 },
    );
    expect(position.left).toBe(552);
    expect(position.side).toBe("bottom");
  });

  it("asks only the latest surface to close for Escape", () => {
    const calls: string[] = [];
    const releaseDialog = registerOverlay({
      kind: "dialog",
      onRequestClose: () => calls.push("dialog"),
    });
    const releasePopover = registerOverlay({
      kind: "popover",
      onRequestClose: () => calls.push("popover"),
    });
    expect(requestCloseTop()).toBe(true);
    expect(calls).toEqual(["popover"]);
    releasePopover();
    expect(requestCloseTop()).toBe(true);
    expect(calls).toEqual(["popover", "dialog"]);
    releaseDialog();
  });

  it("has no active stack after cleanup", () => {
    resetOverlayStack();
    expect(requestCloseTop()).toBe(false);
  });
});
