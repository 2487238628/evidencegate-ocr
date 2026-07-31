import fs from "node:fs";
import crypto from "node:crypto";
import { evaluate } from "../../evidence-gate.mjs";

const root = new URL(".", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const schema = JSON.parse(read("schema.json"));
const testSetText = read("cases.json");
const testSet = JSON.parse(testSetText);
const outputIndex = process.argv.indexOf("--output");
const started = process.hrtime.bigint();
const results = [];

for (const testCase of testSet.cases) {
  const candidate = structuredClone(testSet.base_candidate);
  for (const name of testCase.remove ?? []) delete candidate[name];
  Object.assign(candidate, testCase.changes ?? {});
  const payload = testCase.envelope ? { fields: candidate, evidence: testCase.evidence ?? {} } : candidate;
  const expected = { expected_fields: testSet.base_candidate, exact_fields: testSet.exact_fields };
  const result = evaluate({ candidateText: JSON.stringify(payload), schema, expected });
  const codes = [...result.contract_errors, ...result.business_rule_errors, ...result.expected_mismatches].map((item) => item.code);
  const passed = result.status === testCase.expected_status && (!testCase.expected_code || codes.includes(testCase.expected_code));
  results.push({
    id: testCase.id,
    category: testCase.category,
    expected_status: testCase.expected_status,
    actual_status: result.status,
    expected_code: testCase.expected_code ?? null,
    observed_codes: [...new Set(codes)],
    passed
  });
}

const acceptable = results.filter((item) => item.expected_status === "ACCEPT_CANDIDATE");
const unacceptable = results.filter((item) => item.expected_status !== "ACCEPT_CANDIDATE");
const dangerous = unacceptable.filter((item) => item.actual_status === "ACCEPT_CANDIDATE");
const overblocked = acceptable.filter((item) => item.actual_status !== "ACCEPT_CANDIDATE");
const failed = results.filter((item) => !item.passed);
const report = {
  test_set_id: testSet.test_set_id,
  gate_version: "0.3.0",
  test_set_sha256: crypto.createHash("sha256").update(testSetText).digest("hex"),
  input_cases: results.length,
  output_results: results.length,
  routing_passed: results.length - failed.length,
  routing_failed: failed.length,
  acceptable_cases: acceptable.length,
  unacceptable_cases: unacceptable.length,
  dangerous_false_accepts: dangerous.length,
  overblocked_cases: overblocked.length,
  infrastructure_failures: 0,
  manual_corrections: 0,
  duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
  results,
  evidence_boundary: "This synthetic arts-event suite verifies gate routing only. It does not prove editorial accuracy, event truth, publication safety or production readiness."
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputIndex >= 0 && process.argv[outputIndex + 1]) fs.writeFileSync(process.argv[outputIndex + 1], json, "utf8");
process.stdout.write(json);
if (failed.length) process.exit(1);
