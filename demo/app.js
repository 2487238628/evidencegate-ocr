const tabs = document.querySelector(".scenario-tabs");
const image = document.querySelector("#document-image");
const bboxLayer = document.querySelector("#bbox-layer");
const hash = document.querySelector("#input-hash");
const badge = document.querySelector("#status-badge");
const note = document.querySelector("#scenario-note");
const metrics = document.querySelector("#metrics");
const issueBox = document.querySelector("#issue-box");
const fieldList = document.querySelector("#field-list");
const boundary = document.querySelector("#boundary");
const fieldNames = { invoice_number: "发票号码", invoice_date: "开票日期", supplier: "供应商", buyer: "采购方", currency: "币种", amount_excluding_tax: "未税金额", tax_amount: "税额", total_amount: "含税总额", po_number: "采购订单" };
const statusNames = { ACCEPT_CANDIDATE: "候选可复核", HUMAN_REVIEW: "转人工复核", MODEL_OUTPUT_INVALID: "模型输出无效" };
const metric = (label, value) => `<div><span>${label}</span><strong>${value}</strong></div>`;

function selectField(field, button) {
  document.querySelectorAll(".field-row[aria-pressed=true]").forEach((row) => row.setAttribute("aria-pressed", "false"));
  button.setAttribute("aria-pressed", "true");
  bboxLayer.replaceChildren();
  if (!field.bbox) return;
  const [x1, y1, x2, y2] = field.bbox;
  const box = document.createElement("div");
  box.className = "bbox";
  box.style.cssText = `left:${x1 * 100}%;top:${y1 * 100}%;width:${(x2 - x1) * 100}%;height:${(y2 - y1) * 100}%`;
  box.dataset.label = fieldNames[field.field] ?? field.field;
  bboxLayer.append(box);
}

function render(scenario) {
  document.querySelectorAll(".scenario-tabs button").forEach((button) => button.setAttribute("aria-current", String(button.dataset.id === scenario.id)));
  image.src = scenario.image_url;
  image.alt = `${scenario.title}合成采购票据`;
  hash.textContent = `SHA-256  ${scenario.input.sha256}`;
  badge.className = `status ${scenario.output.status.toLowerCase()}`;
  badge.textContent = statusNames[scenario.output.status];
  note.textContent = scenario.note;
  metrics.innerHTML = [metric("百炼模型", scenario.model), metric("模型耗时", `${(scenario.run.model_duration_ms / 1000).toFixed(3)} s`), metric("门禁耗时", `${scenario.run.gate_duration_ms.toFixed(3)} ms`), metric("Token", scenario.run.total_tokens ?? "未返回"), metric("失败", scenario.run.failures), metric("人工修正", scenario.run.manual_corrections)].join("");
  issueBox.innerHTML = scenario.output.codes.length ? `<span>触发规则</span>${scenario.output.codes.map((code) => `<code>${code}</code>`).join("")}` : `<span>触发规则</span><strong>未发现已知冲突</strong>`;
  fieldList.replaceChildren();
  scenario.output.fields.forEach((field, index) => {
    const button = document.createElement("button");
    button.className = "field-row";
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `<span>${fieldNames[field.field] ?? field.field}</span><strong>${field.value ?? "null"}</strong><small>p.${field.page} · bbox · ${field.status}</small>`;
    button.addEventListener("click", () => selectField(field, button));
    fieldList.append(button);
    if (index === 0) queueMicrotask(() => selectField(field, button));
  });
  boundary.textContent = scenario.boundary;
}

try {
  const response = await fetch("./scenarios.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const scenarios = await response.json();
  scenarios.forEach((scenario) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = scenario.id;
    button.innerHTML = `<span>${scenario.title}</span><small>${statusNames[scenario.output.status]}</small>`;
    button.addEventListener("click", () => render(scenario));
    tabs.append(button);
  });
  render(scenarios[0]);
} catch (error) {
  document.querySelector(".inspection").innerHTML = `<p class="load-error">演示数据读取失败：${error.message}</p>`;
}
