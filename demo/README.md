# EvidenceGate Judge Demo

This local replay demo needs Node.js 20+ and no API key or package install.

```powershell
node demo/server.mjs
```

Open `http://127.0.0.1:4173/`.

The page replays three saved `qwen3.5-ocr` development records and executes the current `evidence-gate.mjs` `evaluate` export. It does not make a live model call, approve a document, or write business state.

Run the smallest demo check:

```powershell
node demo/test-demo.mjs
```

Expected routes: `ACCEPT_CANDIDATE`, `HUMAN_REVIEW`, `HUMAN_REVIEW`.
