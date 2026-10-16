import type { BrowserResult, CheckId, RawFinding, Skipped } from "./types.js";

// Serialized into the page by Playwright, so it must not reference anything outside its own body.
export function inspectAlignment(enabled: CheckId[]): BrowserResult {
  const kit = globalThis.__appearanceKit;
  if (!kit) throw new Error("Appearance kit not installed");
  const findings: RawFinding[] = [];
  const skipped: Skipped[] = [];
  const round = (value: number): number => Math.round(value * 100) / 100;
  const painted = (style: CSSStyleDeclaration): boolean => kit.rgba(style.backgroundColor)[3] > 0 || style.backgroundImage !== "none" || style.boxShadow !== "none"
    || ["top", "right", "bottom", "left"].some(side => parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0
      && !/^(none|hidden)$/.test(style.getPropertyValue(`border-${side}-style`)) && kit.rgba(style.getPropertyValue(`border-${side}-color`))[3] > 0);

  if (enabled.includes("AP030")) {
    const CONTROL = "button,select,input,[role=button],[role=combobox]";
    const MAX_CONTROLS = 400;
    const controls = Array.from(document.querySelectorAll(CONTROL)).filter(element => !(element instanceof HTMLInputElement && /^(checkbox|radio|range|hidden|color|file|image)$/.test(element.type))
      && !element.parentElement?.closest(CONTROL) && kit.visible(element) && !kit.srOnly(element) && !kit.geometryIssue(element) && painted(getComputedStyle(element)));
    if (controls.length > MAX_CONTROLS) skipped.push({ checkId: "AP030", target: "body", reason: "Control limit reached; remaining controls were not compared." });
    // A control's slot is the outermost wrapper that holds no other control; slots sharing a parent form a row.
    const rows = new Map<Element, Array<{ element: Element; rect: DOMRect }>>();
    for (const element of controls.slice(0, MAX_CONTROLS)) {
      let slot = element;
      for (let level = 0; level < 3 && slot.parentElement && slot.parentElement !== document.body && slot.parentElement.querySelectorAll(CONTROL).length === 1; level++) slot = slot.parentElement;
      const parent = slot.parentElement;
      if (!parent) continue;
      rows.set(parent, [...rows.get(parent) ?? [], { element, rect: element.getBoundingClientRect() }]);
    }
    for (const members of rows.values()) {
      const ordered = members.sort((a, b) => a.rect.left - b.rect.left);
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i - 1]!, b = ordered[i]!;
        const gap = b.rect.left - a.rect.right;
        const overlap = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (gap < -0.5 || gap > 48 || overlap < 0.5 * Math.min(a.rect.height, b.rect.height)) continue;
        const heights = [round(a.rect.height), round(b.rect.height)], tops = [round(a.rect.top), round(b.rect.top)];
        if (Math.abs(a.rect.height - b.rect.height) >= 2) {
          findings.push({ checkId: "AP030", target: kit.selector(b.element), related: kit.selector(a.element), message: "Side-by-side controls have different heights.", confidence: "measured", evidence: { kind: "height", heights, difference: round(Math.abs(a.rect.height - b.rect.height)), gap: round(gap) } });
        } else if (Math.abs(a.rect.top - b.rect.top) >= 2) {
          findings.push({ checkId: "AP030", target: kit.selector(b.element), related: kit.selector(a.element), message: "Side-by-side controls of the same height are vertically offset.", confidence: "measured", evidence: { kind: "offset", heights, tops, offset: round(b.rect.top - a.rect.top), gap: round(gap) } });
        }
      }
    }
  }

  if (enabled.includes("AP031")) {
    const MAX_ICONS = 600;
    const labelRuns = (container: Element, icon: Element) => {
      const runs: Array<{ owner: Element; rect: DOMRect }> = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const owner = node.parentElement;
        if (!node.data.trim() || !owner || icon.contains(node) || owner.closest("script, style, svg") || !kit.visible(owner)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of Array.from(range.getClientRects())) if (box.width > 0 && box.height > 0) runs.push({ owner, rect: box });
        range.detach();
      }
      return runs;
    };
    let examined = 0;
    for (const icon of Array.from(document.querySelectorAll("svg, img"))) {
      if (icon.parentElement?.closest("svg")) continue;
      const rect = icon.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8 || rect.width > 32 || rect.height > 32 || !kit.visible(icon)) continue;
      if (/^(absolute|fixed|sticky)$/.test(getComputedStyle(icon).position) || kit.geometryIssue(icon)) continue;
      if (++examined > MAX_ICONS) { skipped.push({ checkId: "AP031", target: "body", reason: "Icon limit reached; remaining icons were not checked." }); break; }
      // The label is the nearest ancestor (up to three levels) with text outside the icon.
      let runs: Array<{ owner: Element; rect: DOMRect }> = [];
      for (let container = icon.parentElement, level = 0; container && container !== document.body && level < 3 && !runs.length; container = container.parentElement, level++) {
        runs = labelRuns(container, icon);
      }
      if (!runs.length) continue;
      const fontSize = parseFloat(getComputedStyle(runs[0]!.owner).fontSize) || 16;
      const centers = runs.map(run => (run.rect.top + run.rect.bottom) / 2);
      if (Math.max(...centers) - Math.min(...centers) > 0.3 * fontSize) continue; // multi-line labels align to their first line by design
      const top = Math.min(...runs.map(run => run.rect.top)), bottom = Math.max(...runs.map(run => run.rect.bottom));
      const left = Math.min(...runs.map(run => run.rect.left)), right = Math.max(...runs.map(run => run.rect.right));
      const adjacent = left - rect.right >= -1 && left - rect.right <= 2 * fontSize || rect.left - right >= -1 && rect.left - right <= 2 * fontSize;
      if (!adjacent || Math.min(bottom, rect.bottom) - Math.max(top, rect.top) <= 0) continue;
      const offset = (rect.top + rect.bottom) / 2 - (top + bottom) / 2;
      if (Math.abs(offset) > Math.max(1.5, 0.12 * fontSize)) {
        findings.push({
          checkId: "AP031",
          target: kit.selector(icon),
          related: kit.selector(runs[0]!.owner),
          message: "Inline icon is vertically off-center from its label text.",
          confidence: "heuristic",
          evidence: { offset: round(offset), fontSize, icon: { top: round(rect.top), height: round(rect.height) }, text: { top: round(top), height: round(bottom - top) } },
        });
      }
    }
  }

  if (enabled.includes("AP032")) {
    const TABLE = "table, [role=table], [role=grid], [role=treegrid]";
    const CELL = "td, th, [role=cell], [role=gridcell], [role=columnheader], [role=rowheader]";
    const BODY_CELL = "td, [role=cell], [role=gridcell]";
    // Figures with an optional sign or currency prefix and a short unit suffix: "$1,234.50", "-12%", "350 ms".
    const NUMERIC = /^[^\p{L}\d\n]{0,3}\d[\d\s.,:'’%/\-]*[^\d\n]{0,8}$/u;
    // Rendered advance of each digit with the owner's font settings; kerning off so pairs like "11" do not skew it.
    const digitWidths = (style: CSSStyleDeclaration): number[] => {
      const probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-kerning:none";
      for (const property of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariantNumeric", "fontFeatureSettings", "fontVariationSettings", "letterSpacing"] as const) probe.style[property] = style[property];
      document.body.append(probe);
      try {
        return "0123456789".split("").map(digit => { probe.textContent = digit; return probe.getBoundingClientRect().width; });
      } finally { probe.remove(); }
    };
    for (const table of Array.from(document.querySelectorAll(TABLE)).filter(element => kit.visible(element)).slice(0, 50)) {
      const columns = new Map<number, Element[]>();
      for (const row of Array.from(table.querySelectorAll("tr, [role=row]")).filter(row => row.closest(TABLE) === table)) {
        Array.from(row.children).filter(cell => cell.matches(CELL)).forEach((cell, index) => {
          if (cell.matches(BODY_CELL) && kit.visible(cell)) columns.set(index, [...columns.get(index) ?? [], cell]);
        });
      }
      for (const [index, cells] of columns) {
        const filled = cells.filter(cell => cell.textContent?.trim());
        const numeric = filled.filter(cell => { const text = cell.textContent!.trim(); return text.length <= 24 && NUMERIC.test(text) && (text.match(/\d/g) ?? []).length >= 2; });
        if (numeric.length < 3 || numeric.length < 0.6 * filled.length) continue;
        let owner: Element = numeric[0]!;
        const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) if (/\d/.test((walker.currentNode as Text).data) && walker.currentNode.parentElement) { owner = walker.currentNode.parentElement; break; }
        const style = getComputedStyle(owner);
        const widths = digitWidths(style);
        const fontSize = parseFloat(style.fontSize) || 16;
        if (Math.max(...widths) - Math.min(...widths) > 0.02 * fontSize) {
          findings.push({
            checkId: "AP032",
            target: kit.selector(numeric[0]!),
            message: "Numeric column uses proportional digits; values do not line up and shift width as they change.",
            confidence: "measured",
            evidence: { column: index + 1, cells: numeric.length, samples: numeric.slice(0, 3).map(cell => cell.textContent!.trim()), digitWidth: { min: round(Math.min(...widths)), max: round(Math.max(...widths)) }, fontFamily: style.fontFamily, fontVariantNumeric: style.fontVariantNumeric },
          });
        }
      }
    }
  }
  return { findings, skipped };
}
