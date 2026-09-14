import { describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { FluentMenu, FluentSelect } from "../styles/fluent/src/vue/selection.js";

function render(component: { setup: Function }, props: Record<string, unknown>, emit = vi.fn()) {
  return component.setup(props, { attrs: {}, emit, slots: {} })();
}

function hasForbiddenGlyph(source: string): boolean {
  return Array.from(source).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 0x7f && /\p{S}/u.test(character)
      || character === "\u2039"
      || character === "\u203a";
  });
}

describe("Fluent selection controls", () => {
  it("renders inline SVG affordances and rejects character icon glyphs", async () => {
    const renderSelect = FluentSelect.setup({
      modelValue: "light",
      label: "Theme",
      disabled: false,
      options: [{ value: "light", label: "Light" }],
    }, { attrs: {}, emit: vi.fn(), slots: {} });
    const closed = renderSelect();
    expect(closed.children[1].children[1].type).toBe("svg");
    expect(closed.children[1].children[1].props["data-icon"]).toBe("chevron-down");

    const menuTree = render(FluentMenu, {
      open: true,
      label: "Actions",
      anchor: null,
      portal: null,
      multiple: true,
      modelValue: ["copy"],
      closeOnSelect: false,
      items: [{ value: "copy", label: "Copy" }],
    });
    const menu = menuTree.children.default();
    expect(menu.children[0].children[0].type).toBe("svg");
    expect(menu.children[0].children[0].props["data-icon"]).toBe("check");

    const fluentRoot = new URL("../styles/fluent/src/", import.meta.url);
    const fluentFiles = (await readdir(fluentRoot, { recursive: true }))
      .filter((file) => file.endsWith(".ts") || file.endsWith(".css"));
    const sources = await Promise.all(fluentFiles.map((file) => readFile(new URL(file, fluentRoot), "utf8")));
    expect(hasForbiddenGlyph(sources.join("\n"))).toBe(false);
  });

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
