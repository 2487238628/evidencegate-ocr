import fs from "node:fs";
import { redPixelRatio } from "./png-visual-signal.mjs";

const clean = redPixelRatio(fs.readFileSync("samples/images/procurement-clean-gpt-image-2.png"));
const stamp = redPixelRatio(fs.readFileSync("samples/images/procurement-stamp-overlap-gpt-image-2.png"));
const report = {
  test_set_id: "PNG-RED-OVERLAY-DEVELOPMENT-002",
  input_cases: 2,
  passed: Number(clean < 0.001) + Number(stamp >= 0.001),
  failed: Number(clean >= 0.001) + Number(stamp < 0.001),
  manual_corrections: 0,
  results: [
    { id: "clean", red_pixel_ratio: clean, expected_review_signal: false, passed: clean < 0.001 },
    { id: "stamp-overlap", red_pixel_ratio: stamp, expected_review_signal: true, passed: stamp >= 0.001 }
  ],
  evidence_boundary: "Two synthetic RGB PNG development fixtures; this is not general stamp-detection accuracy."
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.failed) process.exit(1);
