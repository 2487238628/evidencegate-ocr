import fs from "node:fs";
import crypto from "node:crypto";

const root = new URL(".", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8").replace(/^\uFEFF/, "");
const sourceText = read("evidence/image-suite-r1-candidates.json");
const correctionsText = read("evidence/human-corrections-v0.2.json");
const source = JSON.parse(sourceText);
const correctionSet = JSON.parse(correctionsText);
const outputIndex = process.argv.indexOf("--output");
const started = process.hrtime.bigint();
const corrected = structuredClone(source.cases);
const applied = [];

function targetAt(object, path) {
  const names = path.split(".");
  const key = names.pop();
  const parent = names.reduce((value, name) => value[name], object);
  return { parent, key };
}

for (const correction of correctionSet.corrections) {
  const record = corrected[correction.case_id];
  if (!record) throw new Error(`Unknown case: ${correction.case_id}`);
  for (const change of correction.changes) {
    const { parent, key } = targetAt(record, change.path);
    if (JSON.stringify(parent[key]) !== JSON.stringify(change.before)) {
      throw new Error(`Before-value mismatch: ${correction.correction_id} ${change.path}`);
    }
    parent[key] = change.after;
  }
  record.human_final_status = correction.human_final_status;
  record.human_correction_id = correction.correction_id;
  applied.push({
    correction_id: correction.correction_id,
    case_id: correction.case_id,
    change_count: correction.changes.length,
    human_final_status: correction.human_final_status,
    applied: true
  });
}

const report = {
  run_id: "EVIDENCEGATE-HUMAN-CORRECTION-RUN-001",
  source_sha256: crypto.createHash("sha256").update(sourceText).digest("hex"),
  corrections_sha256: crypto.createHash("sha256").update(correctionsText).digest("hex"),
  input_cases: Object.keys(source.cases).length,
  requested_corrections: correctionSet.corrections.length,
  applied_corrections: applied.length,
  failed_corrections: 0,
  human_reasoning_duration_ms: correctionSet.human_reasoning_duration_ms,
  human_reasoning_duration_status: correctionSet.human_reasoning_duration_status,
  application_duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
  applied,
  corrected_cases: corrected,
  evidence_boundary: "Corrections were made by the project evaluator on synthetic samples, not by a real finance user."
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputIndex >= 0 && process.argv[outputIndex + 1]) fs.writeFileSync(process.argv[outputIndex + 1], json, "utf8");
process.stdout.write(json);
