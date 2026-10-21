import { apply, isSupported } from "@oddbird/popover-polyfill/fn";

export function ensurePopoverSupport(): void {
  if (!isSupported()) apply();
}
