import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScenario } from "./server.mjs";

const demoRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(demoRoot);
const outputRoot = path.join(demoRoot, "dist");
const assetRoot = path.join(outputRoot, "assets");
const ids = ["clean", "right-crop", "prompt-injection"];

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(assetRoot, { recursive: true });
for (const name of ["index.html", "app.js", "styles.css"]) {
  fs.copyFileSync(path.join(demoRoot, name), path.join(outputRoot, name));
}

const scenarios = ids.map((id) => {
  const scenario = buildScenario(id);
  const imageName = path.basename(scenario.image_url);
  fs.copyFileSync(path.join(repoRoot, "samples", "images", imageName), path.join(assetRoot, imageName));
  return { ...scenario, image_url: `./assets/${imageName}` };
});
fs.writeFileSync(path.join(outputRoot, "scenarios.json"), `${JSON.stringify(scenarios, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, ".nojekyll"), "");

assert.deepEqual(scenarios.map((item) => item.output.status), ["ACCEPT_CANDIDATE", "HUMAN_REVIEW", "HUMAN_REVIEW"]);
assert.ok(scenarios.every((item) => item.output.human_required && !item.output.erp_write_allowed));
assert.ok(scenarios.every((item) => fs.existsSync(path.join(outputRoot, item.image_url))));
process.stdout.write(`${JSON.stringify({ input_scenarios: ids.length, output_scenarios: scenarios.length, failures: 0, manual_corrections: 0, status: "PASS", output: outputRoot }, null, 2)}\n`);
