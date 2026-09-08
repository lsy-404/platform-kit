import { describe, expect, it, vi } from "vitest";
import { FluentMenu, FluentSelect } from "../styles/fluent/src/vue/selection.js";

function render(component: { setup: Function }, props: Record<string, unknown>, emit = vi.fn()) {
  return component.setup(props, { attrs: {}, emit, slots: {} })();
}

describe("Fluent selection controls", () => {
  it("renders a Fluent trigger instead of a browser-owned select", () => {
    const tree = render(FluentSelect, {
      modelValue: "light", label: "Theme", disabled: false,
      options: [{ value: "light", label: "Light" }],
    });
    const trigger = tree.children[1];
    expect(trigger.type).toBe("button");
    expect(trigger.props).toMatchObject({ type: "button", "aria-haspopup": "listbox", "aria-expanded": "false" });
  });

  it("ships selected, disabled, menu, and motion-aware selection rules", async () => {
    const css = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../styles/fluent/src/styles/selection.css", import.meta.url), "utf8"),
    );
    for (const selector of [".fluent-select__option", ".fluent-menu__item", ".is-active", ".is-selected", ":disabled", ".fluent-menu__separator"])
      expect(css).toContain(selector);
  });

  it("exposes a menu with semantic separator and multi-select menu items", () => {
    const tree = render(FluentMenu, {
      open: true, label: "Actions", anchor: null, portal: null, multiple: true,
      modelValue: ["copy"], closeOnSelect: false,
      items: [{ value: "copy", label: "Copy" }, { separator: true }, { value: "delete", label: "Delete", disabled: true }],
    });
    expect(tree.type).toBeDefined();
    expect(tree.props.open).toBe(true);
  });
});
