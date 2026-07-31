import fs from "node:fs";
import crypto from "node:crypto";
import { normalizeWordsInfo, resolveEvidence } from "./evidence-locator.mjs";

const root = new URL(".", import.meta.url);
const raw = fs.readFileSync(new URL("tests/locator-cases.json", root), "utf8").replace(/^\uFEFF/, "");
const testSet = JSON.parse(raw);
const started = process.hrtime.bigint();
const results = [];

for (const testCase of testSet.cases) {
  const normalized = normalizeWordsInfo(testCase.words, testSet.image);
  const type = typeof testCase.value === "number" ? "number" : "string";
  const schema = { fields: { test_field: { type, required: false } } };
  const envelope = resolveEvidence({ test_field: testCase.value }, schema, normalized);
  const actual = envelope.evidence.test_field ?? { match_count: 0, locator: null };
  const bbox = actual.locator?.bbox ?? null;
  const passed = actual.match_count === testCase.expected_match_count
    && JSON.stringify(bbox) === JSON.stringify(testCase.expected_bbox)
    && normalized.invalid_words === (testCase.expected_invalid_words ?? 0);
  results.push({
    id: testCase.id,
    expected_match_count: testCase.expected_match_count,
    actual_match_count: actual.match_count,
    expected_bbox: testCase.expected_bbox,
    actual_bbox: bbox,
    invalid_words: normalized.invalid_words,
    passed
  });
}

const failed = results.filter((item) => !item.passed);
const report = {
  test_set_id: testSet.test_set_id,
  locator_version: "0.4.0",
  test_set_sha256: crypto.createHash("sha256").update(raw).digest("hex"),
  input_cases: results.length,
  output_results: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  manual_corrections: 0,
  duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
  results,
  evidence_boundary: testSet.evidence_boundary
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failed.length) process.exit(1);
