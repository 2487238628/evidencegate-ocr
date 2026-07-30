import fs from "node:fs";
import crypto from "node:crypto";
import { evaluate } from "./evidence-gate-v0.2.0.mjs";

const root = new URL(".", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const schema = JSON.parse(read("evidence-schema-v0.2.0.json"));
const testSetText = read("tests/adversarial-cases.json");
const testSet = JSON.parse(testSetText);
const outputIndex = process.argv.indexOf("--output");
const started = process.hrtime.bigint();
const results = [];

for (const testCase of testSet.cases) {
  const candidate = structuredClone(testSet.base_candidate);
  for (const name of testCase.remove ?? []) delete candidate[name];
  Object.assign(candidate, testCase.changes ?? {});
  const payload = testCase.envelope ? { fields: candidate, evidence: testCase.evidence ?? {} } : candidate;
  const candidateText = testCase.raw ?? JSON.stringify(payload);
  const expectedFields = testCase.expected_matches_candidate ? candidate : testSet.base_candidate;
  const expected = { expected_fields: expectedFields, exact_fields: testSet.exact_fields };
  const result = evaluate({ candidateText, schema, expected });
  const codes = [...result.contract_errors, ...result.business_rule_errors, ...result.expected_mismatches].map((item) => item.code);
  const passed = result.status === testCase.expected_status && (!testCase.expected_code || codes.includes(testCase.expected_code));
  const locatorCount = Object.values(result.fields).filter((field) => field.locator != null).length;
  results.push({
    id: testCase.id,
    category: testCase.category,
    expected_status: testCase.expected_status,
    actual_status: result.status,
    expected_code: testCase.expected_code ?? null,
    observed_codes: [...new Set(codes)],
    locator_count: locatorCount,
    passed
  });
}

const acceptable = results.filter((item) => item.expected_status === "ACCEPT_CANDIDATE");
const unacceptable = results.filter((item) => item.expected_status !== "ACCEPT_CANDIDATE");
const dangerous = unacceptable.filter((item) => item.actual_status === "ACCEPT_CANDIDATE");
const overblocked = acceptable.filter((item) => item.actual_status !== "ACCEPT_CANDIDATE");
const failed = results.filter((item) => !item.passed);
const byCategory = Object.fromEntries([...new Set(results.map((item) => item.category))].map((category) => {
  const items = results.filter((item) => item.category === category);
  return [category, { cases: items.length, passed: items.filter((item) => item.passed).length, failed: items.filter((item) => !item.passed).length }];
}));

const report = {
  test_set_id: testSet.test_set_id,
  gate_version: "0.2.0",
  test_set_sha256: crypto.createHash("sha256").update(testSetText).digest("hex"),
  input_cases: results.length,
  output_results: results.length,
  routing_passed: results.length - failed.length,
  routing_failed: failed.length,
  acceptable_cases: acceptable.length,
  unacceptable_cases: unacceptable.length,
  dangerous_false_accepts: dangerous.length,
  dangerous_false_accept_rate: unacceptable.length ? dangerous.length / unacceptable.length : null,
  overblocked_cases: overblocked.length,
  overblock_rate: acceptable.length ? overblocked.length / acceptable.length : null,
  evidence_locators_observed: results.reduce((sum, item) => sum + item.locator_count, 0),
  by_category: byCategory,
  infrastructure_failures: 0,
  manual_corrections: 0,
  duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
  results,
  evidence_boundary: "This deterministic suite measures gate routing safety. It does not measure OCR accuracy, production SLA or real financial outcomes."
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputIndex >= 0 && process.argv[outputIndex + 1]) fs.writeFileSync(process.argv[outputIndex + 1], json, "utf8");
process.stdout.write(json);
if (failed.length) process.exit(1);
