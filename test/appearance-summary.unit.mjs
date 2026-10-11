import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "../tooling/appearance-check/dist/summary.js";
import { checks } from "../tooling/appearance-check/dist/catalog.js";

const all = checks.map(c => c.id);
const viewport = { width: 1280, height: 800 };
const mobile = { width: 390, height: 844 };
const info = id => checks.find(c => c.id === id);
const finding = (checkId, over = {}) => ({
  checkId, target: "#a", message: "msg " + checkId, confidence: "measured", evidence: {},
  page: "http://x/", viewport, colorScheme: "light", state: "default",
  severity: info(checkId).severity, dimensions: [...info(checkId).dimensions], ...over,
});
const gap = (over = {}) => ({ page: "http://x/", viewport, colorScheme: "light", state: "default", target: "#g", reason: "r", level: "check", ...over });
const base = { findings: [], suppressed: [], coverage: [], pages: [], metrics: [] };
const run = (over = {}, enabled = all, scans = 4) => summarize({ ...base, ...over }, enabled, scans);
const row = (result, dimension) => result.summary.find(r => r.dimension === dimension);
const verdicts = result => Object.fromEntries(result.summary.map(r => [r.dimension, r.verdict]));

test("rows come in fixed dimension order", () => {
  assert.deepEqual(run().summary.map(r => r.dimension), ["accessibility", "color", "layout", "typography"]);
});

test("one normative AP001 finding fails accessibility and color only", () => {
  const result = run({ findings: [finding("AP001")] });
  assert.deepEqual(verdicts(result), { accessibility: "fail", color: "fail", layout: "pass", typography: "pass" });
  assert.equal(result.verdict, "fail");
});

test("many clean scans plus one normative finding still fail", () => {
  assert.equal(run({ findings: [finding("AP016")] }, all, 50).verdict, "fail");
});

test("advisory finding only warns its dimension", () => {
  const result = run({ findings: [finding("AP020")] });
  assert.deepEqual(verdicts(result), { accessibility: "pass", color: "pass", layout: "warn", typography: "pass" });
  assert.equal(result.verdict, "warn");
});

test("check gap makes dimensions of that check incomplete", () => {
  const result = run({ coverage: [gap({ checkId: "AP016" })] });
  assert.deepEqual(verdicts(result), { accessibility: "incomplete", color: "incomplete", layout: "pass", typography: "pass" });
  assert.equal(result.verdict, "incomplete");
});

test("info gaps never change a verdict", () => {
  const result = run({ coverage: [gap({ level: "info", target: "document", reason: "HTTP 404: http://x/favicon.ico" })] });
  assert.equal(result.summary.length, 4);
  assert(result.summary.every(r => r.verdict === "pass"));
  assert.equal(result.verdict, "pass");
});

test("a blocking gap makes every row at least incomplete", () => {
  const result = run({ coverage: [gap({ level: "blocking", target: "document" })] });
  assert.equal(result.summary.length, 4);
  assert(result.summary.every(r => r.verdict === "incomplete"));
  const withFinding = run({ coverage: [gap({ level: "blocking" })], findings: [finding("AP020")] });
  assert.equal(row(withFinding, "layout").verdict, "warn");
  assert.equal(row(withFinding, "color").verdict, "incomplete");
});

test("dimensions without an enabled check are not-run", () => {
  const result = run({}, ["AP003"]);
  assert.deepEqual(verdicts(result), { accessibility: "not-run", color: "not-run", layout: "pass", typography: "not-run" });
  assert.deepEqual(row(result, "layout").checks, ["AP003"]);
  assert.deepEqual(row(result, "color").checks, []);
});

test("all dimensions not-run gives an overall not-run", () => {
  assert.equal(run({}, []).verdict, "not-run");
});

test("the same finding at two viewports counts once", () => {
  const result = run({ findings: [finding("AP001"), finding("AP001", { viewport: mobile })] });
  assert.equal(row(result, "accessibility").counts.normative, 1);
  assert.equal(row(result, "color").counts.normative, 1);
  const different = run({ findings: [finding("AP001"), finding("AP001", { target: "#b" })] });
  assert.equal(row(different, "accessibility").counts.normative, 2);
});

test("suppressed findings are counted without changing the verdict", () => {
  const result = run({ suppressed: [{ ...finding("AP001"), reason: "known" }] });
  assert.equal(row(result, "accessibility").counts.suppressed, 1);
  assert.equal(row(result, "accessibility").verdict, "pass");
  assert.equal(result.verdict, "pass");
});

test("conclusions follow the published templates", () => {
  const pass = run({}, all, 4);
  assert.equal(row(pass, "layout").conclusion, `No issues found by ${row(pass, "layout").checks.length} check(s) across 4 scan(s).`);
  assert.equal(row(pass, "accessibility").checks.length, all.filter(id => info(id).dimensions.includes("accessibility")).length);

  const fail = run({ findings: [finding("AP001"), finding("AP001", { target: "#b" }), finding("AP016")] });
  assert.equal(row(fail, "color").conclusion, "Fails: 3 normative issue(s) (AP001 text-contrast ×2, AP016 non-text-contrast ×1).");

  const failFull = run({ findings: [finding("AP016"), finding("AP012"), finding("AP018")], coverage: [gap({ checkId: "AP001" }), gap({ checkId: "AP012" })] });
  assert.equal(row(failFull, "accessibility").conclusion, "Fails: 2 normative issue(s) (AP012 focus-visible ×1, AP016 non-text-contrast ×1); 1 advisory; 2 coverage gap(s).");

  const warn = run({ findings: [finding("AP020")] });
  assert.equal(row(warn, "layout").conclusion, "Needs review: 1 advisory issue(s) (AP020 sibling-rhythm ×1).");
  const warnGap = run({ findings: [finding("AP020")], coverage: [gap({ checkId: "AP008" })] });
  assert.equal(row(warnGap, "layout").conclusion, "Needs review: 1 advisory issue(s) (AP020 sibling-rhythm ×1); 1 coverage gap(s).");

  const incomplete = run({ coverage: [gap({ checkId: "AP016" }), gap({ level: "blocking" })] });
  assert.equal(row(incomplete, "color").conclusion, "No issues found, but 2 area(s) could not be inspected.");

  assert.equal(row(run({}, ["AP003"]), "color").conclusion, "Not checked: no enabled check covers this dimension.");
});

test("byCheck lists only non-zero rows and top is capped at three, normative first", () => {
  const result = run({
    findings: [finding("AP018"), finding("AP012", { target: "#1" }), finding("AP012", { target: "#2" }), finding("AP016"), finding("AP010")],
    coverage: [gap({ checkId: "AP013" })],
  });
  const acc = row(result, "accessibility");
  assert.deepEqual(acc.byCheck.map(r => [r.checkId, r.findings, r.gaps]), [["AP010", 1, 0], ["AP012", 2, 0], ["AP013", 0, 1], ["AP016", 1, 0], ["AP018", 1, 0]]);
  assert.equal(acc.byCheck.find(r => r.checkId === "AP018").severity, "advisory");
  assert.equal(acc.top.length, 3);
  assert(acc.top.every(t => info(t.checkId).severity === "normative"));
  assert.deepEqual(acc.top.map(t => t.checkId), ["AP010", "AP012", "AP012"]);
  assert.deepEqual(Object.keys(acc.top[0]).sort(), ["checkId", "message", "page", "target"]);
  assert.deepEqual(acc.counts, { normative: 4, advisory: 1, suppressed: 0, gaps: 1 });
});

test("a finding in several dimensions counts toward each", () => {
  const result = run({ findings: [finding("AP004")] });
  assert.equal(row(result, "layout").counts.advisory, 1);
  assert.equal(row(result, "typography").counts.advisory, 1);
  assert.equal(row(result, "color").counts.advisory, 0);
});
