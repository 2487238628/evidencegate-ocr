const compact = (value) => String(value)
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "");

const numericTokens = (text) => String(text)
  .match(/[-+]?\d[\d,]*(?:\.\d+)?/g)
  ?.map((value) => Number(value.replaceAll(",", "")))
  .filter(Number.isFinite) ?? [];

function matchesValue(value, spec, text) {
  if (value == null || Array.isArray(value)) return false;
  if (spec.type === "number" || spec.type === "integer") {
    return typeof value === "number" && numericTokens(text).some((token) => token === value);
  }
  const date = typeof value === "string" && value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (date) {
    const tokens = String(text).match(/\d+/g)?.map(Number) ?? [];
    return tokens.length >= 3 && tokens.slice(0, 3).every((token, index) => token === Number(date[index + 1]));
  }
  const needle = compact(value);
  return needle.length > 0 && compact(text).includes(needle);
}

function normalizeLocation(location, image) {
  if (!Array.isArray(location) || location.length !== 8 || location.some((value) => !Number.isFinite(value))) return null;
  const xs = [location[0], location[2], location[4], location[6]];
  const ys = [location[1], location[3], location[5], location[7]];
  const bbox = [
    Math.min(...xs) / image.width,
    Math.min(...ys) / image.height,
    Math.max(...xs) / image.width,
    Math.max(...ys) / image.height
  ].map((value) => Math.max(0, Math.min(1, value)));
  return bbox[0] < bbox[2] && bbox[1] < bbox[3]
    ? { page: image.page ?? 1, bbox }
    : null;
}

export function normalizeWordsInfo(wordsInfo, image) {
  if (!Number.isFinite(image.width) || image.width <= 0 || !Number.isFinite(image.height) || image.height <= 0) {
    throw new Error("Image width and height must be positive numbers.");
  }
  const words = [];
  let invalidWords = 0;
  for (const item of Array.isArray(wordsInfo) ? wordsInfo : []) {
    const locator = normalizeLocation(item?.location, image);
    if (typeof item?.text !== "string" || !locator) {
      invalidWords += 1;
      continue;
    }
    words.push({ text: item.text, locator, rotate_rect: item.rotate_rect ?? null });
  }
  return { words, invalid_words: invalidWords };
}

export function normalizeQwenOcrResponse(response, image) {
  const content = response?.output?.choices?.[0]?.message?.content;
  const item = Array.isArray(content) ? content.find((entry) => entry?.ocr_result) : null;
  const normalized = normalizeWordsInfo(item?.ocr_result?.words_info, image);
  return {
    ...normalized,
    request_id: response?.request_id ?? null,
    model: response?.output?.choices?.[0]?.message?.model ?? response?.model ?? null,
    usage: response?.usage ?? null
  };
}

export function coerceFields(kvResult, schema) {
  const source = kvResult && typeof kvResult === "object" && !Array.isArray(kvResult) ? kvResult : {};
  return Object.fromEntries(Object.entries(schema.fields).map(([name, spec]) => {
    const value = source[name];
    if (value == null) return [name, null];
    if (spec.type === "number" || spec.type === "integer") {
      const parsed = typeof value === "number" ? value : Number(String(value).replaceAll(",", "").trim());
      return [name, Number.isFinite(parsed) && (spec.type !== "integer" || Number.isInteger(parsed)) ? parsed : value];
    }
    if (spec.type === "array") {
      if (Array.isArray(value)) return [name, value];
      const text = String(value).trim();
      return [name, text ? [text] : []];
    }
    if (spec.type === "string") return [name, String(value)];
    return [name, value];
  }));
}

export function qwenKvResult(response) {
  const content = response?.output?.choices?.[0]?.message?.content;
  const item = Array.isArray(content) ? content.find((entry) => entry?.ocr_result?.kv_result) : null;
  return item?.ocr_result?.kv_result ?? {};
}

export function buildQwenResultSchema(schema) {
  return Object.fromEntries(Object.entries(schema.fields).map(([name, spec]) => [
    name,
    spec.description ?? `${name}，类型为 ${spec.type}`
  ]));
}

export function resolveEvidence(fields, schema, normalizedWords) {
  const evidence = {};
  for (const [name, spec] of Object.entries(schema.fields)) {
    const value = fields[name];
    if (value == null || Array.isArray(value)) continue;
    const matches = normalizedWords.words.filter((word) => matchesValue(value, spec, word.text));
    evidence[name] = {
      source_text: matches.length === 1 ? matches[0].text : null,
      locator: matches.length === 1 ? matches[0].locator : null,
      confidence: null,
      match_count: matches.length
    };
  }
  return { fields, evidence };
}
