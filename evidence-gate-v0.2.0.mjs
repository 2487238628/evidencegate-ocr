import { evaluate as evaluateBase } from "./evidence-gate.mjs";

const baseRuleKinds = new Set(["date_order", "sum_equals", "array_contains_all"]);
const issue = (code, message, field = null) => ({ code, field, message });

export function evaluate({ candidateText, schema, expected = null }) {
  const started = process.hrtime.bigint();
  const baseSchema = { ...schema, rules: (schema.rules ?? []).filter((rule) => baseRuleKinds.has(rule.kind)) };
  const result = evaluateBase({ candidateText, schema: baseSchema, expected });
  const contract = [];
  const business = [];
  const values = Object.fromEntries(Object.entries(result.fields).map(([name, field]) => [name, field.value]));

  for (const [name, spec] of Object.entries(schema.fields)) {
    const value = values[name];
    if (value == null) continue;
    if (spec.pattern && typeof value === "string" && !new RegExp(spec.pattern).test(value)) {
      contract.push(issue("FIELD_PATTERN", `Value does not match ${spec.pattern}.`, name));
    }
    if (typeof value === "number" && spec.minimum != null && value < spec.minimum) {
      contract.push(issue("FIELD_MINIMUM", `Value must be at least ${spec.minimum}.`, name));
    }
    if (typeof value === "number" && spec.maximum != null && value > spec.maximum) {
      contract.push(issue("FIELD_MAXIMUM", `Value must be at most ${spec.maximum}.`, name));
    }

    const locator = result.fields[name]?.locator;
    if (locator != null) {
      const pageValid = Number.isInteger(locator.page) && locator.page >= 1;
      const bbox = locator.bbox;
      const bboxValid = Array.isArray(bbox)
        && bbox.length === 4
        && bbox.every((number) => typeof number === "number" && number >= 0 && number <= 1)
        && bbox[0] < bbox[2]
        && bbox[1] < bbox[3];
      if (!pageValid || !bboxValid) {
        contract.push(issue("INVALID_LOCATOR", "Locator requires page >= 1 and normalized bbox [x1,y1,x2,y2].", name));
      }
    }
  }

  for (const rule of schema.rules ?? []) {
    if (baseRuleKinds.has(rule.kind)) continue;
    if (rule.kind === "array_empty") {
      const value = values[rule.field];
      if (Array.isArray(value) && value.length) business.push(issue("RULE_ARRAY_EMPTY", `${rule.field} is not empty.`, rule.field));
    } else if (rule.kind === "array_unique") {
      const value = values[rule.field];
      if (Array.isArray(value) && new Set(value).size !== value.length) {
        business.push(issue("RULE_ARRAY_UNIQUE", `${rule.field} contains duplicate values.`, rule.field));
      }
    } else if (rule.kind === "date_difference_equals") {
      const before = Date.parse(values[rule.before]);
      const after = Date.parse(values[rule.after]);
      const target = values[rule.target];
      if (Number.isFinite(before) && Number.isFinite(after) && Number.isInteger(target)) {
        const days = (after - before) / 86400000;
        if (days !== target) business.push(issue("RULE_DATE_DIFFERENCE", `${rule.target} must equal the date difference.`, rule.target));
      }
    } else if (rule.kind === "percent_applied") {
      const base = values[rule.base];
      const rateText = values[rule.rate];
      const target = values[rule.target];
      const rate = typeof rateText === "string" ? Number.parseFloat(rateText) / 100 : NaN;
      if (typeof base === "number" && Number.isFinite(rate) && typeof target === "number") {
        if (Math.abs(base * rate - target) > (rule.tolerance ?? 0)) {
          business.push(issue("RULE_PERCENT_APPLIED", `${rule.base} × ${rule.rate} must equal ${rule.target}.`, rule.target));
        }
      }
    } else if (rule.kind === "fields_not_equal") {
      if (values[rule.left] != null && values[rule.left] === values[rule.right]) {
        business.push(issue("RULE_FIELDS_NOT_EQUAL", `${rule.left} and ${rule.right} must differ.`, rule.right));
      }
    } else {
      contract.push(issue("UNKNOWN_RULE", `Unsupported rule kind: ${rule.kind}.`));
    }
  }

  result.contract_errors.push(...contract);
  result.business_rule_errors.push(...business);
  for (const [name, field] of Object.entries(result.fields)) {
    field.contract_errors.push(...contract.filter((item) => item.field === name));
    field.business_rule_errors.push(...business.filter((item) => item.field === name));
    field.final_status = field.contract_errors.length
      ? "INVALID"
      : field.business_rule_errors.length || field.expected_mismatches.length
        ? "NEEDS_REVIEW"
        : "CANDIDATE";
  }
  result.status = result.contract_errors.length
    ? "MODEL_OUTPUT_INVALID"
    : result.business_rule_errors.length || result.expected_mismatches.length
      ? "HUMAN_REVIEW"
      : "ACCEPT_CANDIDATE";
  result.gate_version = "0.2.0";
  result.validator_duration_ms = Number(process.hrtime.bigint() - started) / 1e6;
  return result;
}
