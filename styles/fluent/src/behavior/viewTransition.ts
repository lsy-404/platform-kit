import type { FluentPageTransition } from "../theme.js";

export type FluentViewDirection = "forward" | "back";

export type FluentViewTransitionOptions = {
  element?: Element | null;
  transition?: FluentPageTransition;
  direction?: FluentViewDirection;
  /** Called when the browser transition has finished or been skipped, or right after the update when no animation runs. */
  onFinish?: () => void;
};

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
};
type StartViewTransition = (update: () => void | Promise<void>) => ViewTransitionLike;

const baseDuration: Record<FluentPageTransition, number> = {
  entrance: 300,
  fade: 200,
  slide: 300,
  scale: 300,
  wipe: 600,
  none: 0,
};

const properties = [
  "--fluent-view-duration",
  "--fluent-view-ease",
  "--fluent-view-ease-accelerate",
  "--fluent-view-wipe-color",
] as const;

let active: ViewTransitionLike | null = null;

function themeElement(element?: Element | null): Element {
  return element ?? document.querySelector("[data-fluent-theme]") ?? document.documentElement;
}

function clearRoot(root: HTMLElement) {
  root.removeAttribute("data-fluent-view-transition");
  root.removeAttribute("data-fluent-view-direction");
  for (const name of properties) root.style.removeProperty(name);
  if (!root.getAttribute("style")) root.removeAttribute("style");
}

export async function fluentViewTransition(
  update: () => void | Promise<void>,
  options: FluentViewTransitionOptions = {},
): Promise<void> {
  const start = (document as { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== "function") {
    await update();
    options.onFinish?.();
    return;
  }
  const computed = getComputedStyle(themeElement(options.element));
  const style = (options.transition ?? computed.getPropertyValue("--fluent-page-transition").trim()) as FluentPageTransition;
  const scale = Number.parseFloat(computed.getPropertyValue("--fluent-motion-scale"));
  const base = baseDuration[style];
  if (!base || !Number.isFinite(scale) || scale <= 0) {
    await update();
    options.onFinish?.();
    return;
  }

  active?.skipTransition();
  const root = document.documentElement;
  clearRoot(root);
  root.setAttribute("data-fluent-view-transition", style);
  root.setAttribute("data-fluent-view-direction", options.direction ?? "forward");
  root.style.setProperty("--fluent-view-duration", `${base * scale}ms`);
  root.style.setProperty("--fluent-view-ease", computed.getPropertyValue("--fluent-ease").trim() || "ease");
  root.style.setProperty("--fluent-view-ease-accelerate", computed.getPropertyValue("--fluent-ease-accelerate").trim() || "ease-in");
  root.style.setProperty("--fluent-view-wipe-color", computed.getPropertyValue("--fluent-accent").trim() || "currentColor");

  const transition = start.call(document, update);
  active = transition;
  transition.ready.catch(() => {});
  transition.finished
    .catch(() => {})
    .then(() => {
      if (active === transition) {
        active = null;
        clearRoot(root);
      }
      options.onFinish?.();
    });
  try {
    await transition.updateCallbackDone;
  } catch (error) {
    if (!(error instanceof DOMException) || (error.name !== "AbortError" && error.name !== "InvalidStateError")) throw error;
  }
}
