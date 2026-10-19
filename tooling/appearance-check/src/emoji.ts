import type { BrowserResult, CheckId, RawFinding, Skipped } from "./types.js";

// Serialized into the page by Playwright, so it must not reference anything outside its own body.
export function inspectEmoji(enabled: CheckId[]): BrowserResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  if (!enabled.includes("AP035")) return { findings, skipped };

  // Text that names or labels the interface; prose and plain containers (content, game art) are left alone.
  const UI = [
    "button", "a[href]", "summary", "label", "legend", "caption", "th", "option",
    "h1", "h2", "h3", "h4", "h5", "h6",
    ...["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "heading", "switch", "checkbox",
      "radio", "treeitem", "columnheader", "rowheader", "status", "alert", "tooltip"].map(role => `[role=${role}]`),
  ].join(", ");
  const MAX_FINDINGS = 40;
  // A pictograph with its optional presentation selector or skin tone, joined by ZWJ; regional-indicator flags; keycaps.
  const SEQUENCE = /\p{Regional_Indicator}{2}|[0-9#*]\u{FE0F}?\u{20E3}|\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}\p{Emoji_Modifier}]?(?:\u{200D}\p{Extended_Pictographic}[\u{FE0F}\p{Emoji_Modifier}]?)*/gu;
  // UTS #51 emoji presentation: default-emoji characters, VS16, ZWJ, skin tones, flags and keycaps. Text-default
  // symbols such as ©, ™, ✓ or ⚙ stay text unless VS16 asks for emoji, and VS15 always keeps them text.
  const emojiIn = (text: string): string[] => (text.match(SEQUENCE) ?? []).filter(sequence =>
    !sequence.includes("\u{FE0E}") && (/[\p{Regional_Indicator}\u{20E3}\u{FE0F}\u{200D}\p{Emoji_Modifier}]/u.test(sequence) || /^\p{Emoji_Presentation}/u.test(sequence)));
  const rendered = (element: Element): boolean => {
    const host = element instanceof HTMLOptionElement ? element.closest("select") ?? element : element;
    return host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && host.getClientRects().length > 0;
  };
  // An emoji wrapped as a named image (role="img" with a label) was given its meaning on purpose.
  const namedImage = (element: Element): boolean => {
    const image = element.closest("[role=img]");
    return image !== null && (image.hasAttribute("aria-label") || image.hasAttribute("aria-labelledby"));
  };

  // Closed menus and dialogs still count: their labels show and are announced once opened.
  type Hit = { owner: Element; emoji: Set<string>; sources: Set<string>; text: string; rendered: boolean };
  const hits = new Map<Element, Hit>();
  const record = (owner: Element, found: string[], source: string, text: string): void => {
    const hit = hits.get(owner) ?? { owner, emoji: new Set<string>(), sources: new Set<string>(), text: "", rendered: rendered(owner) };
    for (const emoji of found) hit.emoji.add(emoji);
    hit.sources.add(source);
    if (!hit.text) hit.text = text.replace(/\s+/g, " ").trim().slice(0, 60);
    hits.set(owner, hit);
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text, parent = node.parentElement;
    if (!parent || !node.data.trim() || parent.closest("script, style, template, noscript, textarea")) continue;
    const found = emojiIn(node.data);
    if (!found.length) continue;
    const owner = parent.closest(UI);
    if (!owner || kit.decorative(parent) || namedImage(parent)) continue;
    // A hidden piece inside a visible control is never shown or announced.
    if (rendered(owner) && !rendered(parent)) continue;
    record(owner, found, "text", owner.textContent ?? node.data);
  }
  for (const owner of Array.from(document.querySelectorAll(UI + ", input[type=button], input[type=submit], input[type=reset]"))) {
    if (kit.decorative(owner)) continue;
    const label = owner.getAttribute("aria-label");
    const labelEmoji = label ? emojiIn(label) : [];
    if (labelEmoji.length) record(owner, labelEmoji, "aria-label", label!);
    if (owner instanceof HTMLInputElement) {
      const valueEmoji = emojiIn(owner.value);
      if (valueEmoji.length) record(owner, valueEmoji, "value", owner.value);
    }
  }

  for (const hit of hits.values()) {
    if (findings.length === MAX_FINDINGS) {
      skipped.push({ checkId: "AP035", target: "body", reason: "Interface emoji limit reached; remaining elements were not reported." });
      break;
    }
    findings.push({
      checkId: "AP035",
      target: kit.selector(hit.owner),
      message: "Interface text contains emoji that assistive technology reads aloud and platforms render differently; hide decorative emoji or use an icon.",
      confidence: "measured",
      evidence: { emoji: [...hit.emoji], text: hit.text, source: [...hit.sources], element: hit.owner.getAttribute("role") ?? hit.owner.tagName.toLowerCase(), rendered: hit.rendered },
    });
  }
  return { findings, skipped };
}
