import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  FluentButton,
  FluentField,
  FluentNotice,
  FluentSelect,
  FluentSlider,
  FluentSwitch,
  sliderPercentage,
} from "../styles/fluent/src/vue/controls.js";

function render(
  component: { setup: Function },
  props: Record<string, unknown>,
  emit = vi.fn(),
  attrs: Record<string, unknown> = {},
) {
  return component.setup(props, { attrs, emit, slots: {} })();
}

function trigger(handler: unknown, event: Event) {
  for (const listener of Array.isArray(handler) ? handler : [handler])
    (listener as (input: Event) => void)(event);
}

describe("Fluent controls", () => {
  it("keeps button semantics and prevents busy submission", () => {
    const emit = vi.fn();
    const node = render(
      FluentButton,
      { tone: "primary", type: "button", disabled: false, busy: true },
      emit,
    );
    expect(node.type).toBe("button");
    expect(node.props).toMatchObject({
      type: "button",
      disabled: true,
      "aria-busy": true,
    });
    expect(node.props.class).toContain("fluent-button--primary");
  });

  it("reports switch changes through its model event", () => {
    const emit = vi.fn();
    const node = render(
      FluentSwitch,
      { modelValue: false, label: "Use system setting", disabled: false },
      emit,
    );
    expect(node.props).toMatchObject({
      role: "switch",
      "aria-checked": "false",
    });
    node.props.onClick();
    expect(emit).toHaveBeenCalledWith("update:modelValue", true);
    expect(emit).toHaveBeenCalledWith("change", true);
  });

  it("uses native range semantics and reports continuous plus final values", () => {
    const emit = vi.fn();
    const onInput = vi.fn();
    const onChange = vi.fn();
    const node = render(
      FluentSlider,
      {
        modelValue: 25,
        min: 0,
        max: 100,
        step: 5,
        label: "Volume",
        disabled: false,
      },
      emit,
      { style: { color: "red" }, onInput, onChange },
    );
    const input = node.children[1];
    expect(input.type).toBe("input");
    expect(input.props).toMatchObject({
      type: "range",
      min: 0,
      max: 100,
      step: 5,
      "aria-label": "Volume",
    });
    expect(input.props.style["--fluent-slider-position"]).toBe("25%");
    expect(input.props.style.color).toBe("red");
    trigger(input.props.onInput, {
      target: { value: "40" },
    } as unknown as Event);
    trigger(input.props.onChange, {
      target: { value: "40" },
    } as unknown as Event);
    expect(emit).toHaveBeenCalledWith("update:modelValue", 40);
    expect(emit).toHaveBeenCalledWith("change", 40);
    expect(onInput).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(sliderPercentage(150, 0, 100)).toBe(100);
    expect(sliderPercentage(Number.NaN, 0, 100)).toBe(0);
    expect(sliderPercentage(50, Number.NEGATIVE_INFINITY, 100)).toBe(0);
    expect(sliderPercentage(50, 100, 0)).toBe(0);
  });

  it("uses a native select and retains unavailable options", () => {
    const emit = vi.fn();
    const onChange = vi.fn();
    const node = render(
      FluentSelect,
      {
        modelValue: "light",
        label: "Theme",
        disabled: false,
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark", disabled: true },
        ],
      },
      emit,
      { onChange },
    );
    const control = node.children[1];
    expect(control.type).toBe("select");
    expect(control.children[1].props.disabled).toBe(true);
    trigger(control.props.onChange, {
      target: { value: "dark" },
    } as unknown as Event);
    expect(emit).toHaveBeenCalledWith("update:modelValue", "dark");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("keeps caller input listeners while updating a field model", () => {
    const emit = vi.fn();
    const onInput = vi.fn();
    const node = render(
      FluentField,
      {
        modelValue: "old",
        label: "Name",
        disabled: false,
        placeholder: "Enter name",
        type: "text",
      },
      emit,
      { onInput },
    );
    const input = node.children[1];
    trigger(input.props.onInput, {
      target: { value: "new" },
    } as unknown as Event);
    expect(emit).toHaveBeenCalledWith("update:modelValue", "new");
    expect(onInput).toHaveBeenCalledOnce();
  });

  it("gives danger notices assertive alert semantics", () => {
    const node = render(FluentNotice, { tone: "danger" });
    expect(node.props).toMatchObject({
      role: "alert",
      "aria-live": "assertive",
    });
  });

  it("ships the shared Fluent tokens and all control selectors", async () => {
    const css = await readFile(
      new URL("../styles/fluent/src/styles/controls.css", import.meta.url),
      "utf8",
    );
    for (const token of [
      "accent",
      "accent-text",
      "text",
      "muted",
      "surface",
      "control",
      "control-hover",
      "control-pressed",
      "border",
      "danger",
      "radius",
      "shadow",
      "fast",
      "ease",
    ]) {
      expect(css).toContain(`--fluent-${token}`);
    }
    for (const selector of [
      ".fluent-button",
      ".fluent-field",
      ".fluent-switch",
      ".fluent-slider",
      ".fluent-select",
      ".fluent-notice",
    ])
      expect(css).toContain(selector);
  });
});
