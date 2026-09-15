import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { FluentNavigation } from "../styles/fluent/src/vue/navigation.js";

function render(props: Record<string, unknown>) {
  return FluentNavigation.setup(props, { attrs: {}, emit: vi.fn(), slots: {} })();
}

describe("Fluent public navigation", () => {
  it("puts the selection surface on the selected item instead of an overlay cover", () => {
    const tree = render({
      items: [{ key: "catalog", label: "Controls" }, { key: "native", label: "Native inputs" }],
      modelValue: "catalog",
      label: "Catalog sections",
    });
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].props["aria-current"]).toBe("page");
    expect(JSON.stringify(tree.children[0].props.class)).toContain("is-selected");
    expect(tree.children.some((child: any) => child.props?.class === "fluent-navigation__selection")).toBe(false);
  });

  it("ships an item-owned selection indicator without a separate cover layer", async () => {
    const css = await readFile(new URL("../styles/fluent/src/styles/navigation.css", import.meta.url), "utf8");
    expect(css).toContain(".fluent-navigation__item.is-selected");
    expect(css).toContain(".fluent-navigation__item.is-selected::before");
    expect(css).not.toContain(".fluent-navigation__selection");
  });
});
