import assert from "node:assert/strict";
import { createServer } from "./server.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/scenarios.json`);
  const scenarios = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(scenarios.map((item) => item.output.status), ["ACCEPT_CANDIDATE", "HUMAN_REVIEW", "HUMAN_REVIEW"]);
  assert.ok(scenarios.every((item) => item.output.human_required && !item.output.erp_write_allowed));
  assert.ok(scenarios.every((item) => item.output.fields.every((field) => field.page === 1 && field.bbox?.length === 4)));
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);
  process.stdout.write(`${JSON.stringify({ input_scenarios: 3, output_scenarios: 3, failures: 0, manual_corrections: 0, status: "PASS" }, null, 2)}\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
