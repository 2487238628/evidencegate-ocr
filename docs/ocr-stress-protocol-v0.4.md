# qwen3.5-ocr 开发压力协议 v0.4

冻结日期：2026-08-02。本文在本轮真实模型调用前冻结。

## 目的与边界

本轮只回答一个工程问题：面对旋转、缩放、压缩、裁切和遮挡，EvidenceGate 是否会把不允许接收或证据不完整的模型输出危险放行。

压力集由 5 张既有 GPT-image-2 合成采购票据生成 6 种确定性版本，共 30 张。它不是独立留出集，不用于发布生产准确率、SLA、ROI 或无人审批安全结论。另行封存的 20 份独立盲测材料不在本轮读取或调用范围内。

## 冻结输入

每张既有开发图生成以下版本：

1. 原图；
2. 50% 下采样后恢复原尺寸；
3. 顺时针旋转 90°；
4. 裁去右侧 10%；
5. 中央白色遮挡；
6. JPEG 质量 65 往返后保存为 PNG。

`build-ocr-stress-suite.ps1` 使用 Windows 原生图像库生成变体，不新增依赖。`suite.json` 固定每张图片的来源哈希、变换、允许状态和是否允许候选接收。

## 验收标准

- 基础设施失败：0；
- 危险误接收：0；
- 五张原图路由回归：5/5；
- `ACCEPT_CANDIDATE` 仅在该样本允许接收、9/9 字段精确一致且 9/9 字段均有定位时成立；
- 裁切、遮挡和既有风险样本只允许进入 `HUMAN_REVIEW` 或 `MODEL_OUTPUT_INVALID`；
- 每次调用保存输入 SHA-256、原始响应、请求 ID、耗时、HTTP 尝试、重试、Token、门禁输出、失败和人工修正；
- 人工修正固定为 0；如果发生修正，必须另建记录，不能覆盖模型原始输出。

## 调用与额度边界

- 模型：`qwen3.5-ocr`，内置任务 `advanced_recognition`；
- 串行调用，不并发；
- 单次默认超时 30 秒；
- 仅对 429、502、503 最多退避重试两次，并优先遵守 `Retry-After`；
- 首轮最多 30 个样本；只允许针对真实失败做最小重放，不自动重跑整轮；
- 本轮 Token 预算上限 100,000。超限、免费额度 403 或认证失败时立即停止，不切换到付费调用；
- 当前账户已启用“免费额度用完即停”。

## 成熟实践对照

- Google Document AI：评测必须把预测与已标注测试文档比较，并分别报告无效、失败和已评测文档；本项目因此不把开发压力集称为独立准确率。
- Azure Document Intelligence：页码与 polygon/bounding region 属于文档元素的正式证据位置；本项目保留 page 与归一化 bbox。
- Amazon A2I：模型预测进入业务前可触发明确的人类复核流程；本项目三态门禁不执行自动审批或写库。
- PaddleOCR Agent Skills：识别、解析和业务动作分层，保留原始供应商响应并显式分类输入、配置和 API 失败；本项目沿用同样的证据与失败边界。

参考：

- https://docs.cloud.google.com/document-ai/docs/evaluate
- https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/model-overview
- https://docs.aws.amazon.com/augmented-ai/
- https://github.com/Aidenwu0209/PaddleOCR-Skills
- https://help.aliyun.com/zh/model-studio/qwen-vl-ocr-api-reference
