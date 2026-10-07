import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  FluentButton,
  FluentField,
  FluentFilePicker,
  FluentNotice,
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
    expect(String(node.props.class)).toContain("fluent-button--busy");
    expect(node.children[0].type.name).toBe("FluentProgressRing");
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
        snap: "none",
        label: "Volume",
        disabled: false,
      },
      emit,
      { style: { color: "red" }, onInput, onChange },
    );
    const input = node.children[1].children[0];
    expect(input.type).toBe("input");
    expect(input.props).toMatchObject({
      type: "range",
      min: 0,
      max: 100,
      step: "any",
      "aria-label": "Volume",
    });
    expect(input.props.style["--fluent-slider-position"]).toBe("25%");
    expect(input.props.style.color).toBe("red");
    trigger(input.props.onInput, {
      target: { value: "40.25" },
    } as unknown as Event);
    trigger(input.props.onChange, {
      target: { value: "40.25" },
    } as unknown as Event);
    expect(emit).toHaveBeenCalledWith("update:modelValue", 40.25);
    expect(emit).toHaveBeenCalledWith("change", 40.25);
    expect(onInput).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(sliderPercentage(150, 0, 100)).toBe(100);
    expect(sliderPercentage(Number.NaN, 0, 100)).toBe(0);
    expect(sliderPercentage(50, Number.NEGATIVE_INFINITY, 100)).toBe(0);
    expect(sliderPercentage(50, 100, 0)).toBe(0);
  });

  it("keeps an existing numeric step unless snapping is explicitly disabled", () => {
    const props = { modelValue: 2.3, min: 0, max: 10, step: 0.1, label: "Position", disabled: false };
    const stepped = render(FluentSlider, props).children[1].children[0];
    const free = render(FluentSlider, { ...props, snap: "none" }).children[1].children[0];
    expect(stepped.props.step).toBe(0.1);
    expect(free.props.step).toBe("any");
  });

  it("draws small and large marks alongside available values without snapping", () => {
    const node = render(FluentSlider, {
      modelValue: 42.5, min: 0, max: 100, snap: "none", label: "Level",
      tickFrequency: 5, majorTickFrequency: 20,
      availableValues: [60, 25, 120, Number.NaN, 60],
      orientation: "horizontal", tickPlacement: "outside", disabled: false,
    });
    const rail = node.children[1];
    const input = rail.children[0];
    const startTicks = rail.children[1].children;
    const endTicks = rail.children[2].children;
    expect(input.props.value).toBe(42.5);
    expect(startTicks.map((tick: { props: { "data-value": number } }) => tick.props["data-value"])).toEqual(
      Array.from({ length: 21 }, (_, index) => index * 5),
    );
    expect(endTicks).toHaveLength(startTicks.length);
    expect(startTicks.filter((tick: { props: { class: string } }) => tick.props.class.includes("fluent-slider__tick--major"))
      .map((tick: { props: { "data-value": number } }) => tick.props["data-value"])).toEqual([0, 20, 40, 60, 80, 100]);
    expect(rail.children).toHaveLength(3);
  });

  it("supports labelled stops with disabled stops and a neutral tone", () => {
    const emit = vi.fn();
    const node = render(FluentSlider, {
      modelValue: 1, min: 0, max: 4, label: "Level", tone: "neutral", orientation: "horizontal", tickPlacement: "outside",
      stops: [{ value: 0, label: "A" }, { value: 1, label: "B" }, { value: 2, label: "C", disabled: true }, { value: 3, label: "D" }, { value: 4, label: "E" }],
      disabled: false,
    }, emit);
    expect(String(node.props.class)).toContain("fluent-slider--neutral");
    expect(node.props.style).toEqual({ "--fluent-slider-stops": 5 });
    const labels = node.children.at(-1).children;
    expect(labels.map((l: { children: string }) => l.children)).toEqual(["A", "B", "C", "D", "E"]);
    const input = node.children[1].children[0];
    const target = { value: "2" };
    input.props.onInput({ target });
    expect(emit).toHaveBeenLastCalledWith("update:modelValue", 1);
    vi.stubGlobal("getComputedStyle", () => ({ direction: "ltr" }));
    input.props.onKeydown({ key: "ArrowRight", target: { value: "1" }, preventDefault: vi.fn() });
    expect(emit).toHaveBeenCalledWith("change", 3);
    vi.unstubAllGlobals();
  });

  it("snaps pointer input and keyboard navigation to available values", () => {
    const emit = vi.fn();
    const node = render(FluentSlider, {
      modelValue: 25, min: 0, max: 100, snap: "available", label: "Level",
      availableValues: [0, 25, 60, 100], orientation: "horizontal", tickPlacement: "end", disabled: false,
    }, emit);
    const input = node.children[1].children[0];
    const target = { value: "48" };
    trigger(input.props.onInput, { target } as unknown as Event);
    expect(target.value).toBe("60");
    expect(emit).toHaveBeenCalledWith("update:modelValue", 60);
    vi.stubGlobal("getComputedStyle", () => ({ direction: "ltr" }));
    const preventDefault = vi.fn();
    const keyboardTarget = { value: "25" };
    input.props.onKeydown({ key: "ArrowRight", target: keyboardTarget, preventDefault });
    expect(keyboardTarget.value).toBe("60");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith("change", 60);
    vi.unstubAllGlobals();
  });

  it("snaps to whole numbers inside a fractional range and exposes vertical semantics", () => {
    const emit = vi.fn();
    const node = render(FluentSlider, {
      modelValue: 1.6, min: -2.5, max: 2.5, snap: "integer", label: "Offset",
      availableValues: [], orientation: "vertical", tickFrequency: 1, tickPlacement: "start", disabled: false,
    }, emit);
    const input = node.children[1].children[0];
    expect(input.props.value).toBe(2);
    expect(input.props["aria-orientation"]).toBe("vertical");
    const target = { value: "-1.6" };
    input.props.onInput({ target });
    expect(target.value).toBe("-2");
    expect(emit).toHaveBeenCalledWith("update:modelValue", -2);
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

  it("uses a Fluent trigger for file selection and emits the chosen files", () => {
    const emit = vi.fn();
    const node = render(
      FluentFilePicker,
      { modelValue: [], label: "Attachments", selectLabel: "Choose files", disabled: false, multiple: true },
      emit,
    );
    const actions = node.children[1];
    const input = actions.children[0];
    const button = actions.children[1];
    expect(input.type).toBe("input");
    expect(input.props).toMatchObject({ type: "file", multiple: true, "aria-hidden": "true" });
    expect(button.type).toBe("button");
    expect(button.props["aria-label"]).toBe("Choose files");

    const files = [{ name: "notes.md", size: 12, type: "text/markdown" }];
    trigger(input.props.onChange, { target: { files, value: "selected" } } as unknown as Event);
    expect(emit).toHaveBeenCalledWith("update:modelValue", files);
    expect(emit).toHaveBeenCalledWith("change", files);
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
      "focus-outer",
      "fast",
      "ease",
    ]) {
      expect(css).toContain(`--fluent-${token}`);
    }
    expect(css).not.toContain("--fluent-shadow");
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
