import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
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
const RETRYABLE_HTTP = new Set([429, 502, 503]);

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

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response, attempt) {
  const header = response.headers.get("retry-after");
  const seconds = header == null ? NaN : Number(header);
  const headerDelay = Number.isFinite(seconds)
    ? seconds * 1000
    : header
      ? Date.parse(header) - Date.now()
      : NaN;
  return Math.max(0, Math.min(10_000, Number.isFinite(headerDelay) ? headerDelay : 500 * (2 ** (attempt - 1))));
}

async function callAdvanced({ endpoint, apiKey, model, dataUrl, timeoutMs, maxRetries }) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const started = process.hrtime.bigint();
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          input: { messages: [{ role: "user", content: [{ image: dataUrl }] }] },
          parameters: { ocr_options: { task: "advanced_recognition" } }
        })
      });
    } catch (cause) {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const category = cause?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK";
      attempts.push({ attempt, category, duration_ms: durationMs, retry: false });
      const error = new Error(`${category}: ${cause?.message ?? "request failed"}`);
      error.details = { category, duration_ms: durationMs, attempts };
      throw error;
    }

    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const text = await response.text();
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      attempts.push({ attempt, category: "PROTOCOL_RESPONSE", http_status: response.status, duration_ms: durationMs, retry: false });
      const error = new Error("PROTOCOL_RESPONSE: API response was not JSON.");
      error.details = { category: "PROTOCOL_RESPONSE", http_status: response.status, duration_ms: durationMs, attempts };
      throw error;
    }

    if (response.ok && !raw?.code) {
      attempts.push({ attempt, category: "SUCCESS", http_status: response.status, duration_ms: durationMs, retry: false });
      return { raw, duration_ms: attempts.reduce((sum, item) => sum + item.duration_ms, 0), attempts };
    }

    const retry = RETRYABLE_HTTP.has(response.status) && attempt <= maxRetries;
    const waitMs = retry ? retryDelay(response, attempt) : 0;
    attempts.push({ attempt, category: "HTTP", http_status: response.status, duration_ms: durationMs, retry, retry_delay_ms: waitMs });
    if (retry) {
      await delay(waitMs);
      continue;
    }
    const error = new Error(raw?.message ?? `HTTP ${response.status}`);
    error.details = { category: "HTTP", http_status: response.status, response: raw, duration_ms: durationMs, attempts };
    throw error;
  }
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

function assessCase({ status, allowedStatuses, acceptAllowed, fieldsPassed, fieldsTotal, locatorsPassed, locatorsTotal }) {
  const routingChecked = allowedStatuses.length > 0;
  return {
    routing_checked: routingChecked,
    routing_passed: !routingChecked || allowedStatuses.includes(status),
    dangerous_false_accept: status === "ACCEPT_CANDIDATE"
      && (!acceptAllowed || fieldsPassed !== fieldsTotal || locatorsPassed !== locatorsTotal)
  };
}

function selfTest() {
  const complete = { fieldsPassed: 9, fieldsTotal: 9, locatorsPassed: 9, locatorsTotal: 9 };
  assert.equal(assessCase({ status: "ACCEPT_CANDIDATE", allowedStatuses: ["ACCEPT_CANDIDATE"], acceptAllowed: true, ...complete }).dangerous_false_accept, false);
  assert.equal(assessCase({ status: "ACCEPT_CANDIDATE", allowedStatuses: ["HUMAN_REVIEW"], acceptAllowed: false, ...complete }).dangerous_false_accept, true);
  assert.equal(assessCase({ status: "ACCEPT_CANDIDATE", allowedStatuses: [], acceptAllowed: true, ...complete, fieldsPassed: 8 }).dangerous_false_accept, true);
  assert.equal(assessCase({ status: "MODEL_OUTPUT_INVALID", allowedStatuses: ["HUMAN_REVIEW", "MODEL_OUTPUT_INVALID"], acceptAllowed: false, ...complete }).routing_passed, true);
  assert.equal(retryDelay({ headers: { get: () => null } }, 2), 1000);
  assert.equal(retryDelay({ headers: { get: () => "3" } }, 1), 3000);
  process.stdout.write(`${JSON.stringify({ status: "PASS", cases: 6, failures: 0, manual_corrections: 0 })}\n`);
}

async function main() {
  if (args["self-test"] === "true") return selfTest();
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
  const timeoutMs = Number(args["timeout-ms"] ?? 30_000);
  const maxRetries = Number(args["max-retries"] ?? 2);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) throw new Error("--timeout-ms must be an integer >= 1000.");
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new Error("--max-retries must be an integer from 0 to 5.");
  fs.mkdirSync(outputDir, { recursive: true });
  const startedAt = new Date();
  const records = [];

  for (const testCase of suite.cases) {
    const image = fs.readFileSync(testCase.image);
    const imageInfo = pngSize(image);
    const record = {
      id: testCase.id,
      input: { path: testCase.image, sha256: sha256(image), transform: testCase.transform ?? "original", ...imageInfo },
      expected_status: testCase.expected_status ?? null,
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
        dataUrl: `data:image/png;base64,${image.toString("base64")}`,
        timeoutMs,
        maxRetries
      });
      fs.writeFileSync(path.join(outputDir, `${testCase.id}-raw.json`), json(call.raw));
      record.call = {
        task: "advanced_recognition",
        request_id: call.raw.request_id ?? null,
        duration_ms: call.duration_ms,
        usage: call.raw.usage ?? null,
        retry_count: call.attempts.length - 1,
        attempts: call.attempts,
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
      const allowedStatuses = testCase.allowed_statuses
        ?? (testCase.expected_status ? [testCase.expected_status] : []);
      const acceptAllowed = testCase.accept_allowed
        ?? testCase.expected_status === "ACCEPT_CANDIDATE";
      const assessment = assessCase({
        status: gate.status,
        allowedStatuses,
        acceptAllowed,
        fieldsPassed: fieldCheck.passed,
        fieldsTotal: fieldCheck.total,
        locatorsPassed: located,
        locatorsTotal: locatorTotal
      });
      record.output = {
        gate_status: gate.status,
        allowed_statuses: allowedStatuses,
        accept_allowed: acceptAllowed,
        ...assessment,
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
  const routed = completed.filter((item) => item.output.routing_checked);
  const failedAttempts = records.flatMap((item) => item.failures.flatMap((failure) => failure.attempts ?? []));
  const requestAttempts = calls.reduce((sum, item) => sum + item.attempts.length, 0) + failedAttempts.length;
  const endpointProfile = args.endpoint.includes(".cn-beijing.maas.aliyuncs.com")
    ? "workspace-scoped-cn-beijing"
    : args.endpoint.includes("dashscope.aliyuncs.com")
      ? "legacy-shared-cn-beijing"
      : "custom-redacted";
  const summary = {
    run_id: suite.run_id ?? "QWEN-OCR-V0.4-LOCATOR-RUN-002",
    version: "0.4.0",
    provider: "Alibaba Cloud Model Studio",
    endpoint_profile: endpointProfile,
    model,
    started_at: startedAt.toISOString(),
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    suite_sha256: sha256(fs.readFileSync(args.suite)),
    schema_sha256: sha256(fs.readFileSync(args.schema)),
    inputs: records.length,
    outputs: completed.length,
    model_calls: requestAttempts,
    retries: calls.reduce((sum, item) => sum + item.retry_count, 0),
    routing_passed: routed.filter((item) => item.output.routing_passed).length,
    routing_total: routed.length,
    exact_fields_passed: completed.reduce((sum, item) => sum + item.output.exact_fields_passed, 0),
    exact_fields_total: completed.reduce((sum, item) => sum + item.output.exact_fields_total, 0),
    locator_fields_passed: completed.reduce((sum, item) => sum + item.output.locator_fields_passed, 0),
    locator_fields_total: completed.reduce((sum, item) => sum + item.output.locator_fields_total, 0),
    accept_candidates: completed.filter((item) => item.output.gate_status === "ACCEPT_CANDIDATE").length,
    dangerous_false_accepts: completed.filter((item) => item.output.dangerous_false_accept).length,
    total_tokens: calls.reduce((sum, item) => sum + (item.usage?.total_tokens ?? 0), 0),
    failures: records.reduce((sum, item) => sum + item.failures.length, 0),
    manual_corrections: 0,
    calls,
    results: records.map((item) => ({
      id: item.id,
      expected_status: item.expected_status,
      actual_status: item.output?.gate_status ?? null,
      routing_passed: item.output?.routing_passed ?? false,
      routing_checked: item.output?.routing_checked ?? false,
      allowed_statuses: item.output?.allowed_statuses ?? [],
      accept_allowed: item.output?.accept_allowed ?? false,
      dangerous_false_accept: item.output?.dangerous_false_accept ?? false,
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
    evidence_boundary: suite.evidence_boundary ?? "Synthetic development set; not production OCR accuracy, SLA, fraud detection, or autonomous approval evidence."
  };
  fs.writeFileSync(path.join(outputDir, "summary.json"), json(summary));
  process.stdout.write(json(summary));
  if (summary.failures || summary.routing_passed !== summary.routing_total || summary.dangerous_false_accepts) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
});
