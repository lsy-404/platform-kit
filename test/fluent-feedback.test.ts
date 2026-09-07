import { describe, expect, it, vi } from "vitest";
import {
  FluentCheckbox,
  FluentProgressBar,
  FluentProgressRing,
  FluentScrollViewer,
} from "../styles/fluent/src/vue/feedback.js";

function render(
  component: { setup: Function },
  props: Record<string, unknown>,
  attrs: Record<string, unknown> = {},
  emit = vi.fn(),
  expose = vi.fn(),
) {
  return { node: component.setup(props, { attrs, emit, slots: {}, expose })(), emit, expose };
}

function trigger(handler: unknown, event: Event) {
  for (const listener of Array.isArray(handler) ? handler : [handler])
    (listener as (input: Event) => void)(event);
}

describe("Fluent feedback controls", () => {
  it("uses native checkbox semantics and keeps caller change listeners", () => {
    const onChange = vi.fn();
    const { node, emit } = render(
      FluentCheckbox,
      { modelValue: false, disabled: false, label: "Remember" },
      { onChange, "aria-label": "Remember setting" },
    );
    const input = node.children[0];
    expect(input.type).toBe("input");
    expect(input.props).toMatchObject({ type: "checkbox", checked: false, "aria-label": "Remember setting" });
    trigger(input.props.onChange, { target: { checked: true } } as unknown as Event);
    expect(emit).toHaveBeenCalledWith("update:modelValue", true);
    expect(emit).toHaveBeenCalledWith("change", true);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("clamps determinate progress and preserves an explicit accessible name", () => {
    const { node } = render(
      FluentProgressBar,
      { value: 150, max: 120, label: "Upload" },
      { "aria-label": "File upload progress" },
    );
    expect(node.props).toMatchObject({ max: 120, value: 120, "aria-label": "File upload progress" });

    const ring = render(FluentProgressRing, {
      value: -4,
      max: 0,
      label: "Loading",
      size: 24,
      active: true,
      indeterminate: false,
    }).node;
    expect(ring.props).toMatchObject({
      role: "progressbar",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": 0,
      "aria-label": "Loading",
    });
  });

  it("passes aria-label through to unlabeled range and switch controls", async () => {
    const controls = await import("../styles/fluent/src/vue/controls.js");
    const slider = render(
      controls.FluentSlider,
      { modelValue: 10, min: 0, max: 20, step: 1, label: undefined, disabled: false },
      { "aria-label": "Playback position" },
    ).node.children[1];
    expect(slider.props["aria-label"]).toBe("Playback position");

    const toggle = render(
      controls.FluentSwitch,
      { modelValue: false, label: undefined, disabled: false },
      { "aria-label": "Repeat playback" },
    ).node;
    expect(toggle.props["aria-label"]).toBe("Repeat playback");
  });

  it("exposes a scroll viewer handle without requiring a mounted viewport", () => {
    const { expose } = render(FluentScrollViewer, { horizontal: false, focusable: true });
    const handle = expose.mock.calls[0][0] as { element(): HTMLDivElement | null; scrollTo(options: ScrollToOptions): void };
    expect(handle.element()).toBeNull();
    expect(() => handle.scrollTo({ top: 12, behavior: "auto" })).not.toThrow();
  });
});
