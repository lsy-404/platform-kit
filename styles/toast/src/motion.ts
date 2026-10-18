/**
 * A leaving card turns absolute inside the stack, so it is pinned to its
 * measured box first or it would jump to the stack's origin.
 */
export function pinLeavingToast(element: Element): void {
  const card = element as HTMLElement;
  if (!card.offsetParent) return;
  card.style.left = `${card.offsetLeft}px`;
  card.style.top = `${card.offsetTop}px`;
  card.style.width = `${card.offsetWidth}px`;
}

export const toastStamp = (createdAt: number) => new Date(createdAt).toTimeString().slice(0, 8);
