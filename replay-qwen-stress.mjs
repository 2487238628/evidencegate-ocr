import fs from "node:fs";
import crypto from "node:crypto";
import { evaluate } from "./evidence-gate.mjs";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const trackedSha = (bytes) => sha(Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"), "utf8"));
const suiteBytes = fs.readFileSync("tests/qwen-ocr-stress-suite-v0.4.json");
const schemaBytes = fs.readFileSync("examples/procurement-invoice/schema-v0.4.0.json");
const expectedBytes = fs.readFileSync("examples/procurement-invoice/expected-v0.2.0.json");
const fixture = read("evidence/qwen-ocr-stress-v0.4-replay-inputs.json");
const suite = JSON.parse(suiteBytes);
const schema = JSON.parse(schemaBytes);
const expected = JSON.parse(expectedBytes);
const frozen = read("evidence/qwen-ocr-stress-v0.4-final.json");
const started = process.hrtime.bigint();

if (fixture.source_suite_sha256 !== frozen.suite_sha256) throw new Error("Source-run suite hash drift.");
if (trackedSha(suiteBytes) !== fixture.public_suite_sha256) throw new Error("Public suite hash drift.");
if (trackedSha(schemaBytes) !== fixture.public_schema_sha256) throw new Error("Public schema hash drift.");
if (trackedSha(expectedBytes) !== fixture.public_expected_sha256) throw new Error("Public expected-fields hash drift.");
if (fixture.records.length !== suite.cases.length) throw new Error("Replay record count drift.");

const cases = new Map(suite.cases.map((item) => [item.id, item]));
const results = fixture.records.map((record) => {
  const { payload_sha256, ...payload } = record;
  if (sha(JSON.stringify(payload)) !== payload_sha256) throw new Error(`Replay payload hash drift: ${record.id}`);
  const testCase = cases.get(record.id);
  if (!testCase || record.input.sha256 !== testCase.image_sha256) throw new Error(`Input binding drift: ${record.id}`);
  const gate = evaluate({
    candidateText: JSON.stringify({ fields: record.output.fields, evidence: record.output.evidence }),
    schema,
    expected: null
  });
  const exact = expected.exact_fields.filter((field) =>
    JSON.stringify(record.output.fields[field]) === JSON.stringify(expected.expected_fields[field])
  ).length;
  const locatorTotal = Object.values(schema.fields).filter((spec) => spec.locator_required).length;
  const locators = Object.entries(schema.fields)
    .filter(([, spec]) => spec.locator_required)
    .filter(([name]) => gate.fields[name]?.locator != null)
    .length;
  const routingPassed = testCase.allowed_statuses.includes(gate.status);
  const dangerous = gate.status === "ACCEPT_CANDIDATE"
    && (!testCase.accept_allowed || exact !== expected.exact_fields.length || locators !== locatorTotal);
  return { id: record.id, status: gate.status, routing_passed: routingPassed, dangerous, exact, locators };
});

const summary = {
  status: "PASS",
  replay_id: fixture.replay_id,
  inputs: results.length,
  outputs: results.length,
  routing_passed: results.filter((item) => item.routing_passed).length,
  routing_total: results.length,
  dangerous_false_accepts: results.filter((item) => item.dangerous).length,
  exact_fields_passed: results.reduce((sum, item) => sum + item.exact, 0),
  exact_fields_total: results.length * expected.exact_fields.length,
  locator_fields_passed: results.reduce((sum, item) => sum + item.locators, 0),
  locator_fields_total: results.length * Object.values(schema.fields).filter((spec) => spec.locator_required).length,
  total_tokens: fixture.records.reduce((sum, item) => sum + (item.call.usage?.total_tokens ?? 0), 0),
  failures: 0,
  manual_corrections: fixture.manual_corrections,
  duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
  evidence_boundary: fixture.evidence_boundary
};

for (const key of [
  "inputs", "outputs", "routing_passed", "routing_total", "dangerous_false_accepts",
  "exact_fields_passed", "exact_fields_total", "locator_fields_passed", "locator_fields_total", "total_tokens"
]) {
  if (summary[key] !== frozen[key]) throw new Error(`Frozen summary mismatch: ${key}`);
}
if (summary.routing_passed !== summary.routing_total || summary.dangerous_false_accepts) summary.status = "FAIL";
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.status !== "PASS") process.exitCode = 1;
