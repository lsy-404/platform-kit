import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { FluentButton, FluentField, FluentToggleButton } from "../styles/fluent/src/vue/controls.js";
import { FluentCheckbox, FluentRadio } from "../styles/fluent/src/vue/feedback.js";

function render(component: { setup: Function }, props: Record<string, unknown>, emit = vi.fn(), attrs: Record<string, unknown> = {}) {
  return { node: component.setup(props, { attrs, emit, slots: {} })(), emit };
}

describe("Fluent control states", () => {
  it("exposes controlled toggle and icon button semantics", () => {
    const { node } = render(FluentButton, {
      tone: "subtle", type: "button", disabled: false, busy: false,
      toggle: true, pressed: true, iconOnly: true,
    }, vi.fn(), { "aria-label": "Pin item" });
    expect(node.props).toMatchObject({ "aria-pressed": "true", "data-icon-only": true, "aria-label": "Pin item" });

    const toggle = render(FluentToggleButton, { modelValue: false, tone: "secondary", disabled: false, iconOnly: false });
    toggle.node.props.onClick({ type: "click" } as MouseEvent);
    expect(toggle.emit).toHaveBeenCalledWith("update:modelValue", true);
  });

  it("renders multiline and invalid fields with native attributes", () => {
    const { node } = render(FluentField, {
      modelValue: "details", label: "Details", disabled: false, readonly: true,
      invalid: true, multiline: true, placeholder: "Write details", type: "text",
    });
    const control = node.children[1];
    expect(control.type).toBe("textarea");
    expect(control.props).toMatchObject({ readonly: true, "aria-invalid": true, "data-invalid": true });
  });

  it("keeps native checkbox and radio model semantics", () => {
    const checkbox = render(FluentCheckbox, { modelValue: true, disabled: false, label: "Remember" }).node;
    expect(checkbox.children[0].props).toMatchObject({ type: "checkbox", checked: true });

    const { node, emit } = render(FluentRadio, { modelValue: "small", value: "large", disabled: false, label: "Large" });
    expect(node.children[0].props).toMatchObject({ type: "radio", value: "large", checked: false });
    node.children[0].props.onChange({ target: { checked: true } });
    expect(emit).toHaveBeenCalledWith("update:modelValue", "large");
    expect(emit).toHaveBeenCalledWith("change", "large");
  });

  it("ships state selectors without styling generic buttons", async () => {
    const css = await readFile(new URL("../styles/fluent/src/styles/controls.css", import.meta.url), "utf8");
    for (const selector of [
      ".fluent-button[data-icon-only]",
      ".fluent-field__input[data-invalid]",
      ".fluent-switch--checked:hover",
      ".fluent-slider__input:disabled",
      ".fluent-checkbox__input:checked",
      ".fluent-radio__input:checked",
      "prefers-reduced-motion",
      "forced-colors: active",
    ]) expect(css).toContain(selector);
    expect(css).not.toContain("button:hover {");
  });
});
