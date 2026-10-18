import {
  observeWindowAttention,
  toastAnnouncement,
  type Toast,
  type ToastPlacement,
  type ToastStore,
  type ToastTheme,
} from "./core.js";
import { pinLeavingToast, toastStamp } from "./motion.js";
import { toast as sharedToast } from "./shared.js";

export interface ToastHostOptions {
  store?: ToastStore;
  /** Parent element; defaults to `document.body`. */
  target?: HTMLElement;
  placement?: ToastPlacement;
  theme?: ToastTheme;
  label?: string;
  closeLabel?: string;
  timestamp?: boolean;
  observeWindow?: boolean;
}

export interface MountedToastHost {
  readonly element: HTMLElement;
  setTheme(theme: ToastTheme): void;
  setLabels(labels: { label?: string; closeLabel?: string }): void;
  destroy(): void;
}

const ENTER_MS = 250;
const LEAVE_MS = 150;
const SVG = "http://www.w3.org/2000/svg";

interface Card {
  element: HTMLElement;
  toast: Toast;
  bar: HTMLElement | null;
}

function closeIcon(doc: Document): SVGElement {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = doc.createElementNS(SVG, "path");
  path.setAttribute("d", "M1 1 9 9M9 1 1 9");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.1");
  path.setAttribute("stroke-linecap", "round");
  svg.append(path);
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string) {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Fills a card with the same markup as the Vue `ToastCard`. Text is never parsed as HTML. */
function paint(card: Card, store: ToastStore, closeLabel: string, timestamp: boolean): void {
  const { element: root, toast } = card;
  const doc = root.ownerDocument;
  root.className = `pk-toast pk-toast--${toast.kind}`;
  const announcement = toastAnnouncement(toast.kind);
  root.setAttribute("role", announcement.role);
  root.setAttribute("aria-live", announcement["aria-live"]);
  root.toggleAttribute("data-sticky", toast.duration <= 0);

  const close = element(doc, "button", "pk-toast__close");
  close.type = "button";
  close.setAttribute("aria-label", closeLabel);
  close.append(closeIcon(doc));
  close.addEventListener("click", () => store.dismiss(toast.id));
  const children: Node[] = [close];
  if (toast.title) children.push(element(doc, "div", "pk-toast__title", toast.title));
  children.push(element(doc, "div", "pk-toast__message", toast.message));
  if (toast.actions.length) {
    const actions = element(doc, "div", "pk-toast__actions");
    for (const action of toast.actions) {
      const button = element(
        doc,
        "button",
        action.primary ? "pk-toast__action pk-toast__action--primary" : "pk-toast__action",
        action.label,
      );
      button.type = "button";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        store.runAction(toast.id, action);
      });
      actions.append(button);
    }
    children.push(actions);
  }
  if (timestamp) {
    const stamp = element(doc, "time", "pk-toast__stamp", toastStamp(toast.createdAt));
    stamp.dateTime = new Date(toast.createdAt).toISOString();
    children.push(stamp);
  }
  card.bar = null;
  if (toast.duration > 0) {
    card.bar = element(doc, "div", "pk-toast__bar");
    card.bar.setAttribute("aria-hidden", "true");
    card.bar.style.transform = `scaleX(${store.progress(toast.id)})`;
    children.push(card.bar);
  }
  root.replaceChildren(...children);
}

/** Runs `name` enter/leave classes the way Vue's `TransitionGroup` does. */
function transition(node: HTMLElement, phase: "enter" | "leave", ms: number, done?: () => void): void {
  const win = node.ownerDocument.defaultView;
  node.classList.add(`pk-toast-${phase}-active`, `pk-toast-${phase}-from`);
  const frame = win?.requestAnimationFrame?.bind(win) ?? ((callback: () => void) => setTimeout(callback, 16));
  frame(() => {
    node.classList.remove(`pk-toast-${phase}-from`);
    node.classList.add(`pk-toast-${phase}-to`);
    setTimeout(() => {
      node.classList.remove(`pk-toast-${phase}-active`, `pk-toast-${phase}-to`);
      done?.();
    }, ms);
  });
}

/** Slides cards that stayed to their new slots (FLIP). */
function settle(cards: Iterable<Card>, before: Map<HTMLElement, DOMRect>): void {
  const moved: HTMLElement[] = [];
  for (const { element: node } of cards) {
    const from = before.get(node);
    if (!from) continue;
    const to = node.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (!dx && !dy) continue;
    node.style.transition = "none";
    node.style.transform = `translate(${dx}px, ${dy}px)`;
    moved.push(node);
  }
  if (!moved.length) return;
  void moved[0]!.offsetHeight;
  for (const node of moved) {
    node.classList.add("pk-toast-move");
    node.style.transition = "";
    node.style.transform = "";
    node.addEventListener("transitionend", () => node.classList.remove("pk-toast-move"), { once: true });
  }
}

/** Framework-free host for pages without Vue; same classes as the Vue host. */
export function mountToastHost(options: ToastHostOptions = {}): MountedToastHost {
  const store = options.store ?? sharedToast;
  const target = options.target ?? document.body;
  const doc = target.ownerDocument;
  let closeLabel = options.closeLabel ?? "Dismiss";
  const timestamp = options.timestamp ?? true;
  const host = doc.createElement("section");
  host.className = "pk-toast-host";
  host.dataset.placement = options.placement ?? "bottom-end";
  host.setAttribute("data-pk-toast-theme", options.theme ?? "system");
  host.setAttribute("aria-label", options.label ?? "Notifications");
  target.append(host);

  const cards = new Map<number, Card>();
  let interval: ReturnType<typeof setInterval> | undefined;

  const tick = () => {
    for (const card of cards.values())
      if (card.bar) card.bar.style.transform = `scaleX(${store.progress(card.toast.id)})`;
  };
  const syncTicker = () => {
    const timed = [...cards.values()].some((card) => card.toast.duration > 0);
    if (timed && interval === undefined) interval = setInterval(tick, 100);
    else if (!timed && interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  const render = () => {
    const list = store.snapshot();
    const live = new Set(list.map((toast) => toast.id));
    const before = new Map<HTMLElement, DOMRect>();
    for (const card of cards.values()) before.set(card.element, card.element.getBoundingClientRect());

    for (const [id, card] of cards) {
      if (live.has(id)) continue;
      cards.delete(id);
      pinLeavingToast(card.element);
      transition(card.element, "leave", LEAVE_MS, () => card.element.remove());
    }
    for (const toast of list) {
      const existing = cards.get(toast.id);
      if (existing) {
        if (existing.toast !== toast) {
          existing.toast = toast;
          paint(existing, store, closeLabel, timestamp);
        }
        continue;
      }
      const card: Card = { element: doc.createElement("div"), toast, bar: null };
      paint(card, store, closeLabel, timestamp);
      cards.set(toast.id, card);
      host.append(card.element);
      transition(card.element, "enter", ENTER_MS);
    }
    settle(cards.values(), before);
    syncTicker();
  };

  const engage = (engaged: boolean) => store.setAttention({ engaged });
  const onEnter = () => engage(true);
  const onLeave = () => engage(false);
  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !host.contains(next)) engage(false);
  };
  host.addEventListener("pointerenter", onEnter);
  host.addEventListener("pointerleave", onLeave);
  host.addEventListener("focusin", onEnter);
  host.addEventListener("focusout", onFocusOut);

  const stopList = store.subscribe(render);
  const stopWindow =
    options.observeWindow === false || !doc.defaultView ? () => {} : observeWindowAttention(store, doc.defaultView);
  render();

  return {
    element: host,
    setTheme(theme) {
      host.setAttribute("data-pk-toast-theme", theme);
    },
    setLabels(labels) {
      if (labels.label !== undefined) host.setAttribute("aria-label", labels.label);
      if (labels.closeLabel !== undefined && labels.closeLabel !== closeLabel) {
        closeLabel = labels.closeLabel;
        for (const card of cards.values()) paint(card, store, closeLabel, timestamp);
      }
    },
    destroy() {
      stopList();
      stopWindow();
      if (interval !== undefined) clearInterval(interval);
      store.setAttention({ engaged: false });
      cards.clear();
      host.remove();
    },
  };
}
