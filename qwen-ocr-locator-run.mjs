import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { evaluate } from "./evidence-gate.mjs";
import { coerceFields, normalizeQwenOcrResponse, resolveEvidence } from "./evidence-locator.mjs";
import { redPixelRatio } from "./png-visual-signal.mjs";

const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) =>
  value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : []
));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const LABELS = {
  invoice_number: "发票号码",
  invoice_date: "开票日期",
  supplier: "供应商",
  buyer: "采购方",
  currency: "币种",
  amount_excluding_tax: "未税金额",
  tax_amount: "税额",
  total_amount: "含税总额",
  po_number: "采购订单"
};
const DOCUMENT_INSTRUCTION = /忽略.{0,8}规则|直接通过|自动通过|无视.{0,8}规则|ignore.{0,20}rules?|approve/i;
const RED_OVERLAY_REVIEW_THRESHOLD = 0.001;

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.subarray(1, 4).toString() !== "PNG") throw new Error("Only PNG input is supported.");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), page: 1 };
}

function extractFields(positioned, schema, redRatio) {
  const raw = {};
  for (const [field, label] of Object.entries(LABELS)) {
    const index = positioned.words.findIndex((word) => word.text.trim() === label);
    raw[field] = index >= 0 ? positioned.words[index + 1]?.text?.trim() ?? null : null;
  }
  const fields = coerceFields(raw, schema);
  fields.document_instructions = positioned.words.map((word) => word.text).filter((text) => DOCUMENT_INSTRUCTION.test(text));
  // ponytail: conservative red-overlay signal, not a general stamp or obstruction detector.
  fields.visual_obstructions = redRatio >= RED_OVERLAY_REVIEW_THRESHOLD ? ["prominent_red_overlay"] : [];
  fields.uncertainties = [];
  return fields;
}

async function callAdvanced({ endpoint, apiKey, model, dataUrl }) {
  const started = process.hrtime.bigint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: { messages: [{ role: "user", content: [{ image: dataUrl }] }] },
      parameters: { ocr_options: { task: "advanced_recognition" } }
    })
  });
  const raw = await response.json();
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (!response.ok || raw?.code) {
    const error = new Error(raw?.message ?? `HTTP ${response.status}`);
    error.details = { http_status: response.status, response: raw, duration_ms: durationMs };
    throw error;
  }
  return { raw, duration_ms: durationMs };
}

function checkFields(fields, expected) {
  const results = expected.exact_fields.map((field) => ({
    field,
    expected: expected.expected_fields[field],
    actual: fields[field] ?? null,
    passed: JSON.stringify(fields[field]) === JSON.stringify(expected.expected_fields[field])
  }));
  return { passed: results.filter((item) => item.passed).length, total: results.length, results };
}

async function main() {
  for (const name of ["suite", "schema", "expected", "output-dir", "endpoint"]) {
    if (!args[name]) throw new Error(`Missing --${name}.`);
  }
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not set in the process environment.");
  const suite = readJson(args.suite);
  const schema = readJson(args.schema);
  const expected = readJson(args.expected);
  const outputDir = path.resolve(args["output-dir"]);
  const model = args.model ?? suite.model;
  fs.mkdirSync(outputDir, { recursive: true });
  const startedAt = new Date();
  const records = [];

  for (const testCase of suite.cases) {
    const image = fs.readFileSync(testCase.image);
    const imageInfo = pngSize(image);
    const record = {
      id: testCase.id,
      input: { path: testCase.image, sha256: sha256(image), ...imageInfo },
      expected_status: testCase.expected_status,
      output: null,
      call: null,
      failures: [],
      manual_corrections: 0
    };
    try {
      const call = await callAdvanced({
        endpoint: args.endpoint,
        apiKey,
        model,
        dataUrl: `data:image/png;base64,${image.toString("base64")}`
      });
      fs.writeFileSync(path.join(outputDir, `${testCase.id}-raw.json`), json(call.raw));
      record.call = {
        task: "advanced_recognition",
        request_id: call.raw.request_id ?? null,
        duration_ms: call.duration_ms,
        usage: call.raw.usage ?? null,
        exit_code: 0
      };
      const positioned = normalizeQwenOcrResponse(call.raw, imageInfo);
      const redRatio = redPixelRatio(image);
      const fields = extractFields(positioned, schema, redRatio);
      const envelope = resolveEvidence(fields, schema, positioned);
      const gate = evaluate({ candidateText: JSON.stringify(envelope), schema, expected: null });
      const fieldCheck = checkFields(fields, expected);
      const located = Object.entries(schema.fields)
        .filter(([, spec]) => spec.locator_required)
        .filter(([name]) => gate.fields[name]?.locator != null)
        .length;
      const locatorTotal = Object.values(schema.fields).filter((spec) => spec.locator_required).length;
      record.output = {
        gate_status: gate.status,
        routing_passed: gate.status === testCase.expected_status,
        codes: [...gate.contract_errors, ...gate.business_rule_errors].map((item) => item.code),
        exact_fields_passed: fieldCheck.passed,
        exact_fields_total: fieldCheck.total,
        locator_fields_passed: located,
        locator_fields_total: locatorTotal,
        red_pixel_ratio: redRatio,
        invalid_positioned_words: positioned.invalid_words,
        fields,
        evidence: envelope.evidence,
        field_results: fieldCheck.results,
        gate
      };
      process.stdout.write(`${testCase.id}: ${gate.status}; fields ${fieldCheck.passed}/${fieldCheck.total}; locators ${located}/${locatorTotal}\n`);
    } catch (error) {
      record.failures.push({ message: error.message, ...(error.details ?? {}), exit_code: 1 });
      process.stdout.write(`${testCase.id}: FAILED ${error.message}\n`);
    }
    fs.writeFileSync(path.join(outputDir, `${testCase.id}-record.json`), json(record));
    records.push(record);
  }

  const completed = records.filter((item) => item.output);
  const calls = records.map((item) => item.call).filter(Boolean);
  const summary = {
    run_id: "QWEN-OCR-V0.4-LOCATOR-RUN-002",
    version: "0.4.0",
    provider: "Alibaba Cloud Model Studio",
    endpoint_profile: "workspace-scoped-cn-beijing",
    model,
    started_at: startedAt.toISOString(),
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    suite_sha256: sha256(fs.readFileSync(args.suite)),
    schema_sha256: sha256(fs.readFileSync(args.schema)),
    inputs: records.length,
    outputs: completed.length,
    model_calls: calls.length,
    routing_passed: completed.filter((item) => item.output.routing_passed).length,
    routing_total: records.length,
    exact_fields_passed: completed.reduce((sum, item) => sum + item.output.exact_fields_passed, 0),
    exact_fields_total: completed.reduce((sum, item) => sum + item.output.exact_fields_total, 0),
    locator_fields_passed: completed.reduce((sum, item) => sum + item.output.locator_fields_passed, 0),
    locator_fields_total: completed.reduce((sum, item) => sum + item.output.locator_fields_total, 0),
    failures: records.reduce((sum, item) => sum + item.failures.length, 0),
    manual_corrections: 0,
    calls,
    results: records.map((item) => ({
      id: item.id,
      expected_status: item.expected_status,
      actual_status: item.output?.gate_status ?? null,
      routing_passed: item.output?.routing_passed ?? false,
      exact_fields: item.output ? `${item.output.exact_fields_passed}/${item.output.exact_fields_total}` : "0/0",
      locators: item.output ? `${item.output.locator_fields_passed}/${item.output.locator_fields_total}` : "0/0",
      red_pixel_ratio: item.output?.red_pixel_ratio ?? null,
      codes: item.output?.codes ?? [],
      failures: item.failures
    })),
    known_limitations: [
      "The label-value parser is specific to this procurement-invoice layout.",
      "The red-overlay rule is a conservative signal, not general stamp or obstruction recognition.",
      "The development images are synthetic and not held out."
    ],
    evidence_boundary: "Existing five-image synthetic development set; not production OCR accuracy, SLA, fraud detection, or autonomous approval evidence."
  };
  fs.writeFileSync(path.join(outputDir, "summary.json"), json(summary));
  process.stdout.write(json(summary));
  if (summary.failures || summary.routing_passed !== summary.routing_total) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
});
