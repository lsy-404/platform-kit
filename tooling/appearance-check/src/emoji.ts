import type { BrowserResult, CheckId, RawFinding, Skipped } from "./types.js";

// Serialized into the page by Playwright, so it must not reference anything outside its own body.
export function inspectEmoji(enabled: CheckId[]): BrowserResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  if (!enabled.includes("AP035")) return { findings, skipped };

  // Findings are grouped under the nearest interface element, or else the element holding the text.
  const UI = [
    "button", "a[href]", "summary", "label", "legend", "caption", "th", "option",
    "h1", "h2", "h3", "h4", "h5", "h6",
    ...["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "heading", "switch", "checkbox",
      "radio", "treeitem", "columnheader", "rowheader", "status", "alert", "tooltip"].map(role => `[role=${role}]`),
  ].join(", ");
  const MAX_FINDINGS = 40;
  // Emoji (flags, keycaps, pictographs with their selectors, skin tones and ZWJ joins) and the symbol blocks that
  // fonts draw as pictures: arrows, technical symbols, geometric shapes, miscellaneous symbols and dingbats.
  const SYMBOL = /\p{Regional_Indicator}{2}|[0-9#*]\u{FE0F}?\u{20E3}|(?:\p{Extended_Pictographic}|[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{27BF}\u{27F0}-\u{27FF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{1F800}-\u{1F8FF}])[\u{FE0E}\u{FE0F}\p{Emoji_Modifier}]?(?:\u{200D}\p{Extended_Pictographic}[\u{FE0F}\p{Emoji_Modifier}]?)*/gu;
  // The only exemption: ©, ® and ™ used as ordinary text marks (an emoji presentation selector still counts).
  const STANDARD = new Set(["\u{A9}", "\u{AE}", "\u{2122}", "\u{A9}\u{FE0E}", "\u{AE}\u{FE0E}", "\u{2122}\u{FE0E}"]);
  const symbolsIn = (text: string): string[] => (text.match(SYMBOL) ?? []).filter(symbol => !STANDARD.has(symbol));
  const rendered = (element: Element): boolean => {
    const host = element instanceof HTMLOptionElement ? element.closest("select") ?? element : element;
    return host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && host.getClientRects().length > 0;
  };

  type Hit = { owner: Element; symbols: Set<string>; sources: Set<string>; text: string; rendered: boolean };
  const hits = new Map<Element, Hit>();
  const record = (holder: Element, found: string[], source: string, text: string, shown: boolean): void => {
    const owner = holder.closest(UI) ?? holder;
    const hit = hits.get(owner) ?? { owner, symbols: new Set<string>(), sources: new Set<string>(), text: "", rendered: false };
    for (const symbol of found) hit.symbols.add(symbol);
    hit.sources.add(source);
    hit.rendered ||= shown;
    if (!hit.text) hit.text = text.replace(/\s+/g, " ").trim().slice(0, 60);
    hits.set(owner, hit);
  };

  // Text, including closed menus, dialogs and art that appears later; `rendered` says whether it shows right now.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text, parent = node.parentElement;
    if (!parent || !node.data.trim() || parent.closest("script, style, template, noscript, textarea")) continue;
    const found = symbolsIn(node.data);
    if (found.length) record(parent, found, "text", (parent.closest(UI) ?? parent).textContent ?? node.data, rendered(parent));
  }
  // Attributes people read or hear, and generated content.
  for (const element of Array.from(document.querySelectorAll("body *"))) {
    if (element.closest("script, style, template, noscript")) continue;
    for (const name of ["aria-label", "placeholder", "title"]) {
      const value = element.getAttribute(name);
      const found = value ? symbolsIn(value) : [];
      if (found.length) record(element, found, name, value!, rendered(element));
    }
    if (element instanceof HTMLInputElement && /^(button|submit|reset)$/.test(element.type)) {
      const found = symbolsIn(element.value);
      if (found.length) record(element, found, "value", element.value, rendered(element));
    }
    for (const pseudo of ["::before", "::after"] as const) {
      const content = getComputedStyle(element, pseudo).content;
      if (!content || content === "none" || content === "normal" || !content.includes("\"")) continue;
      const literal = content.split("\"").filter((_, i) => i % 2 === 1).join("");
      const found = symbolsIn(literal);
      if (found.length) record(element, found, pseudo, literal, rendered(element));
    }
  }

  for (const hit of hits.values()) {
    if (findings.length === MAX_FINDINGS) {
      skipped.push({ checkId: "AP035", target: "body", reason: "Emoji limit reached; remaining elements were not reported." });
      break;
    }
    findings.push({
      checkId: "AP035",
      target: kit.selector(hit.owner),
      message: "Text uses emoji or pictographic symbols, which every platform draws differently; use an icon or image instead (only ©, ® and ™ are exempt).",
      confidence: "measured",
      evidence: { symbols: [...hit.symbols], text: hit.text, source: [...hit.sources], element: hit.owner.getAttribute("role") ?? hit.owner.tagName.toLowerCase(), rendered: hit.rendered },
    });
  }
  const title = symbolsIn(document.title);
  if (title.length && findings.length < MAX_FINDINGS) {
    findings.push({
      checkId: "AP035",
      target: "title",
      message: "The document title uses emoji or pictographic symbols, which every platform draws differently.",
      confidence: "measured",
      evidence: { symbols: [...new Set(title)], text: document.title.slice(0, 60), source: ["title"], element: "title", rendered: true },
    });
  }
  return { findings, skipped };
}
