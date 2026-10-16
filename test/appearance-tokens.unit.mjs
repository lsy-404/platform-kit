import assert from "node:assert/strict";
import test from "node:test";
import { designBaseline, parseDesignMarkdown, tokenLength } from "../tooling/appearance-check/dist/tokens.js";

const sample = `---
version: alpha
name: sample
description: |
  colors: this block is prose, not tokens
tags:
  - example
colors:
  primary: "#2563eb"   # brand
  'on-primary': '#ffffff'
  muted: rgb(100 116 139)
  pending:
typography:
  body:
    fontFamily: Inter, sans-serif
    fontSize: 1rem
    fontWeight: 400
  caption:
    fontSize: 12px
rounded:
  sm: 4px
  full: 9999px
spacing:
  xs: 8px
  md: 16
components:
  button:
    backgroundColor: "{colors.primary}"
---

## Overview
`;

test("reads token sections and skips other front matter", () => {
  const tokens = parseDesignMarkdown(sample);
  assert.deepEqual(tokens.colors, { primary: "#2563eb", "on-primary": "#ffffff", muted: "rgb(100 116 139)" });
  assert.deepEqual(tokens.typography.body, { fontFamily: "Inter, sans-serif", fontSize: "1rem", fontWeight: "400" });
  assert.deepEqual(tokens.rounded, { sm: "4px", full: "9999px" });
  assert.deepEqual(tokens.spacing, { xs: "8px", md: "16" });
  assert.equal(tokens.components, undefined);
});

test("flattens tokens to px and hex", () => {
  const baseline = designBaseline(parseDesignMarkdown(sample));
  assert.deepEqual(baseline.colors.map(c => c.value), ["#2563eb", "#ffffff", "#64748b"]);
  assert.deepEqual(baseline.fontSizes, [{ name: "body", value: 16 }, { name: "caption", value: 12 }]);
  assert.deepEqual(baseline.fontWeights, [{ name: "body", value: 400 }]);
  assert.deepEqual(baseline.radii.map(r => r.value), [4, 9999]);
  assert.deepEqual(baseline.spacing.map(s => s.value), [8, 16]);
});

test("lengths accept px, rem, em and bare numbers", () => {
  assert.equal(tokenLength("12px"), 12);
  assert.equal(tokenLength("0.75rem"), 12);
  assert.equal(tokenLength("2em"), 32);
  assert.equal(tokenLength(6), 6);
  assert.equal(tokenLength("50%"), null);
  assert.equal(tokenLength("{rounded.sm}"), null);
});

test("rejects files without usable tokens or with unsupported token syntax", () => {
  assert.throws(() => parseDesignMarkdown("# No front matter"), /front matter/);
  assert.throws(() => parseDesignMarkdown("---\ncolors: {primary: '#000'}\n---\n"), /nested mapping/);
  assert.throws(() => parseDesignMarkdown("---\nspacing:\n  scale: [4, 8]\n---\n"), /flow collections/);
  assert.throws(() => designBaseline(parseDesignMarkdown("---\nname: empty\n---\n")), /no usable/);
});
