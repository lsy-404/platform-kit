export type OverlayKind = "dialog" | "popover";

export interface OverlayRegistration {
  kind: OverlayKind;
  onRequestClose: () => void;
}

interface OverlayEntry extends OverlayRegistration {
  id: number;
  restoreFocus: HTMLElement | null;
}

let nextId = 1;
const stack: OverlayEntry[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const top = stack.at(-1);
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  top.onRequestClose();
}

function syncListener(): void {
  if (typeof document === "undefined") return;
  const needed = stack.length > 0;
  if (needed === listening) return;
  listening = needed;
  document[needed ? "addEventListener" : "removeEventListener"](
    "keydown",
    onKeyDown as EventListener,
    true,
  );
}

/** Adds a surface to the local topmost-overlay order and returns its release function. */
export function registerOverlay(registration: OverlayRegistration): (restoreFocus?: boolean) => void {
  const restoreFocus =
    typeof document === "undefined"
      ? null
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  const entry: OverlayEntry = { ...registration, id: nextId++, restoreFocus };
  stack.push(entry);
  syncListener();
  let released = false;
  return (shouldRestoreFocus = true) => {
    if (released) return;
    released = true;
    const index = stack.findIndex((candidate) => candidate.id === entry.id);
    const wasTop = index === stack.length - 1;
    if (index >= 0) stack.splice(index, 1);
    syncListener();
    if (shouldRestoreFocus && wasTop && entry.restoreFocus?.isConnected)
      entry.restoreFocus.focus({ preventScroll: true });
  };
}

export function requestCloseTop(): boolean {
  const top = stack.at(-1);
  if (!top) return false;
  top.onRequestClose();
  return true;
}

/** Test seam for the stack's otherwise module-private state. */
export function resetOverlayStack(): void {
  stack.length = 0;
  syncListener();
}
