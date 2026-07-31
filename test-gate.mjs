import fs from "node:fs";
import crypto from "node:crypto";
import { evaluate } from "./evidence-gate.mjs";

const root = new URL(".", import.meta.url);
const readJson = (name) => JSON.parse(fs.readFileSync(new URL(name, root), "utf8").replace(/^\uFEFF/, ""));
const schema = readJson("evidence-schema.json");
const fixture = readJson("fixture.json");
const testSet = readJson("tests/gate-cases.json");
const outputArg = process.argv.indexOf("--output");
const started = process.hrtime.bigint();
const results = [];

for (const testCase of testSet.cases) {
  const candidate = structuredClone(testSet.base_candidate);
  const caseSchema = structuredClone(schema);
  for (const name of testCase.locator_required_fields ?? []) caseSchema.fields[name].locator_required = true;
  for (const [name, margin] of Object.entries(testCase.locator_edge_margin_fields ?? {})) {
    caseSchema.fields[name].locator_edge_margin = margin;
  }
  for (const rule of testCase.rules ?? []) caseSchema.rules.push(rule);
  for (const name of testCase.remove ?? []) delete candidate[name];
  Object.assign(candidate, testCase.changes ?? {});
  const payload = testCase.envelope
    ? { fields: candidate, evidence: testCase.evidence ?? {} }
    : candidate;
  const candidateText = testCase.raw ?? JSON.stringify(payload);
  const result = evaluate({ candidateText, schema: caseSchema, expected: fixture });
  const codes = [
    ...result.contract_errors,
    ...result.business_rule_errors,
    ...result.expected_mismatches
  ].map((item) => item.code);
  const passed = result.status === testCase.expected_status
    && (!testCase.expected_code || codes.includes(testCase.expected_code));
  results.push({
    id: testCase.id,
    expected_status: testCase.expected_status,
    actual_status: result.status,
    expected_code: testCase.expected_code ?? null,
    observed_codes: codes,
    passed
  });
}

const failed = results.filter((item) => !item.passed);
const report = {
  test_set_id: testSet.test_set_id,
  gate_version: "0.4.0",
  test_set_sha256: crypto.createHash("sha256").update(JSON.stringify(testSet)).digest("hex"),
  input_cases: results.length,
  output_results: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  manual_corrections: 0,
  duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
  results,
  evidence_boundary: "This deterministic test set verifies gate routing, not OCR or production accuracy."
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputArg >= 0 && process.argv[outputArg + 1]) fs.writeFileSync(process.argv[outputArg + 1], json, "utf8");
process.stdout.write(json);
if (failed.length) process.exit(1);

