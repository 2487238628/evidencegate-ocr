import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "../evidence-gate.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demoRoot = path.join(root, "demo");
const schema = JSON.parse(fs.readFileSync(path.join(root, "examples/procurement-invoice/schema-v0.4.0.json"), "utf8"));
const runSummary = JSON.parse(fs.readFileSync(path.join(root, "runs/qwen-ocr-v0.4/summary.json"), "utf8"));
const scenarios = {
  clean: { title: "证据完整", note: "字段、金额关系与定位证据均未发现已知冲突。候选可进入人工快速复核。" },
  "right-crop": { title: "右侧裁切", note: "四个字段同时终止在同一切线，门禁保留残缺值并转人工重新取证。" },
  "prompt-injection": { title: "文档内诱导", note: "票面文字试图要求系统忽略规则。它被当作证据保存，不被当作指令执行。" }
};

function readRecord(id) {
  return JSON.parse(fs.readFileSync(path.join(root, `runs/qwen-ocr-v0.4/${id}-record.json`), "utf8"));
}

function candidateFromRecord(record) {
  const fields = {};
  const evidence = {};
  for (const [name, field] of Object.entries(record.output.gate.fields)) {
    fields[name] = field.value;
    if (field.locator || field.confidence != null) evidence[name] = { locator: field.locator, confidence: field.confidence };
  }
  return { fields, evidence };
}

export function buildScenario(id) {
  if (!scenarios[id]) return null;
  const record = readRecord(id);
  const gate = evaluate({ candidateText: JSON.stringify(candidateFromRecord(record)), schema });
  return {
    id,
    ...scenarios[id],
    mode: "SAVED_MODEL_OUTPUT_REPLAY",
    model: runSummary.model,
    image_url: `/samples/images/${path.basename(record.input.path)}`,
    input: record.input,
    output: {
      status: gate.status,
      codes: [...gate.contract_errors, ...gate.business_rule_errors, ...gate.expected_mismatches].map((item) => item.code),
      human_required: gate.human_required,
      erp_write_allowed: gate.erp_write_allowed,
      fields: Object.entries(gate.fields).filter(([, field]) => !Array.isArray(field.value)).map(([field, value]) => ({
        field, value: value.value, source_text: value.source_text, page: value.locator?.page ?? null,
        bbox: value.locator?.bbox ?? null, match_count: value.match_count ?? null, status: value.final_status
      }))
    },
    run: {
      request_id: record.call.request_id,
      model_duration_ms: record.call.duration_ms,
      gate_duration_ms: gate.validator_duration_ms,
      total_tokens: record.call.usage?.total_tokens ?? null,
      failures: record.failures.length,
      manual_corrections: record.manual_corrections
    },
    boundary: "保存的百炼真实调用结果，由当前 v0.4.0 门禁重新执行；不是实时模型调用，也不代表生产准确率。"
  };
}

const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
function send(response, status, body, type = "application/json; charset=utf-8") {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}
function staticFile(urlPath) {
  const demoAsset = ["/app.js", "/styles.css"].includes(urlPath);\n  const relative = urlPath === "/" ? "demo/index.html" : demoAsset ? `demo/${urlPath.slice(1)}` : urlPath.replace(/^\//, "");
  const absolute = path.resolve(root, relative);
  const allowed = absolute.startsWith(`${demoRoot}${path.sep}`) || absolute.startsWith(`${path.join(root, "samples", "images")}${path.sep}`);
  return allowed ? absolute : null;
}
export function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/health") return send(response, 200, JSON.stringify({ status: "ok", version: "0.4.0" }));
    if (url.pathname === "/api/scenarios" || url.pathname === "/scenarios.json") return send(response, 200, JSON.stringify(Object.keys(scenarios).map((id) => buildScenario(id))));
    const file = staticFile(url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(response, 404, JSON.stringify({ error: "NOT_FOUND" }));
    return send(response, 200, fs.readFileSync(file), contentTypes[path.extname(file)] ?? "application/octet-stream");
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, "127.0.0.1", () => process.stdout.write(`EvidenceGate demo: http://127.0.0.1:${port}\n`));
}
