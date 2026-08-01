# EvidenceGate OCR v0.4：qwen3.5-ocr 开发压力运行审计

运行日期：2026-08-02（Asia/Shanghai）

## 结论先行

本轮在百炼“免费额度用完即停”保护下，完成 30 个唯一合成输入的真实 `qwen3.5-ocr` 调用和修正后门禁重放：

- 输入 30，输出 30；
- 原图路由回归 5/5；
- 全部允许状态 30/30；
- 危险误接收 0；
- 字段精确一致 233/270；
- 关键字段证据定位 266/270；
- 11 个 `ACCEPT_CANDIDATE`、14 个 `HUMAN_REVIEW`、5 个 `MODEL_OUTPUT_INVALID`；
- 选入最终结果的真实模型调用 30 次，重试 0，71,259 Token；
- 包含失败尝试在内，本目标共调用 37 次，消耗 87,950 Token，低于冻结的 100,000 Token 上限；
- 业务数据人工修正 0。

这些结果只覆盖 5 张既有 GPT-image-2 合成开发图的确定性变体，不是独立测试集，不证明生产准确率、SLA、ROI 或无人审批安全。

## 输入与验收

5 张既有合成采购票据分别生成原图、50% 下采样、旋转 90°、右裁 10%、中央遮挡、JPEG 质量 65 往返，共 30 张。生成器使用 Windows 原生图像库，不增加依赖。

最终压力清单 SHA-256：`314783b9da1ef0e39eb89eb9e812972c99401156aea02c6d4091e30d67961afd`。

验收标准在模型调用前冻结：基础设施失败为 0；不允许接收或证据不完整的输出不得进入 `ACCEPT_CANDIDATE`；五张原图路由必须 5/5；每次调用保存输入哈希、原始响应、请求 ID、耗时、HTTP 尝试、Token、门禁输出、失败和人工修正。

## 按变换观察

| 变换 | 样本 | 接收 | 人工复核 | 输出无效 | 9/9 字段 | 9/9 定位 |
|---|---:|---:|---:|---:|---:|---:|
| 原图 | 5 | 2 | 3 | 0 | 4 | 5 |
| 下采样 50% | 5 | 2 | 3 | 0 | 4 | 5 |
| 旋转 90° | 5 | 2 | 3 | 0 | 4 | 5 |
| 右裁 10% | 5 | 3 | 2 | 0 | 4 | 5 |
| 中央遮挡 | 5 | 0 | 0 | 5 | 0 | 1 |
| JPEG 65 | 5 | 2 | 3 | 0 | 4 | 5 |

定位存在不等于字段正确。右裁开发图只精确匹配 5/9 字段，却仍能为模型返回的残缺文本定位 9/9；因此项目继续分别报告字段值与证据位置，不合并成“准确率”。

## 真实失败与停止动作

第一次批量运行在 8 次模型调用后被人工停止：百炼已正常返回，但生成的 PNG 色彩格式超出本地红色遮挡解析器的既有支持范围。该尝试产生 1 个完整输出、7 个本地失败、0 次重试、19,121 Token。失败记录和原始请求 ID均保留，没有静默丢弃。

修正方式是把生成图统一保存为 24 位 RGB；票据像素内容和业务事实未改。修正后先在本地对 30/30 图片执行解析兼容检查，再继续模型调用。失败尝试的原始响应没有绑定到新图片哈希，也没有冒充最终结果。

另外记录了三项 Windows 工具失败：直接执行 PowerShell 脚本被执行策略阻断；Windows PowerShell 缺少 `Path.GetRelativePath`；本地补丁沙箱在中文路径刷新失败。分别通过显式 Bypass、旧版兼容的仓库内相对路径函数、ASCII 临时补丁文件处理。它们都发生在结论生成前并已显式披露。

## 对抗性发现与修正

首轮 28 张续跑报告 4 个“危险接收”。逐项复核后分成两类：

1. 三个右裁 10% 样本只裁去空白边距，当前输入仍保留 9/9 字段和 9/9 定位；提示注入样本的红色指令也已不在当前图片中。把“文件发生过裁切”直接等同于危险会制造误阻断，因此这三项被修正为“只有当前证据完整时才允许候选接收”。修正前压力清单哈希 `9a296dca7c1afc6feedfbd69bd0df09ce9ba42ffbce4d1c4107cfd7e3397e11d` 仍保留。
2. 既有右裁缺证图旋转 90° 后从 `HUMAN_REVIEW` 错误变为 `ACCEPT_CANDIDATE`，且字段仅 5/9。根因是裁切线随旋转变成横向，旧规则只检查横排文本的右边界。共享规则改为：横向 OCR 框检查右侧末端，竖向 OCR 框检查下侧末端。新增确定性回归后 20/20 通过；保存的真实模型响应在不再次调用模型的情况下，从 `ACCEPT_CANDIDATE` 修正为 `HUMAN_REVIEW`，代码为 `RULE_ALIGNED_RIGHT_EDGES`，门禁重放耗时 19.6091 ms。

人工修正边界：业务字段和模型原始响应修正 0 次；测试资产编码修正 1 次；测试政策修正 1 次（涉及 3 个标签）；共享门禁代码修正 1 次。

## 成熟实践对照

- Google Document AI 只在预测与人工标注测试文档对比后计算评测指标，并单列无效、失败和已评测文档。本项目因此不把开发压力运行称为独立准确率。
- Azure Document Intelligence 把页码和 bounding polygon 作为文档元素的正式位置证据。本项目保留页码与归一化 bbox，但仍将“值正确”和“能定位”分开报告。
- Amazon A2I 用显式 human loop 承接需要人类判断的模型输出。本项目的 `HUMAN_REVIEW` 不执行审批、写库或发布。
- PaddleOCR Agent Skills 区分识别、解析和业务动作，保留供应商原始响应并显式分类输入、配置和 API 失败。本项目沿用相同分层，没有用 CLI 成功掩盖后处理失败。

参考：

- https://docs.cloud.google.com/document-ai/docs/evaluate
- https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/model-overview
- https://docs.aws.amazon.com/augmented-ai/
- https://github.com/Aidenwu0209/PaddleOCR-Skills
- https://help.aliyun.com/zh/model-studio/qwen-vl-ocr-api-reference

## 可复核证据

- `tests/qwen-ocr-stress-suite-v0.4.json`：最终 30 项压力清单与图片哈希；
- `evidence/qwen-ocr-stress-suite-pre-policy-correction.json`：政策修正前清单；
- `evidence/qwen-ocr-stress-v0.4-final.json`：最终 30 项输入、输出、请求 ID、耗时、Token 和门禁结果；
- `evidence/qwen-ocr-stress-v0.4-failed-attempt.json`：7 个本地失败和停止动作；
- `evidence/qwen-ocr-rotated-crop-replay-v0.4.json`：真实旋转裁切输出的修正前后重放；
- `build-ocr-stress-suite.ps1`：确定性图片生成；
- `replay-qwen-stress.mjs`：不调用模型的统一门禁重放；
- `docs/ocr-stress-protocol-v0.4.md`：调用前冻结协议。

独立封存的 20 份盲测材料没有被读取、调用或用于本轮调参。没有未参与开发的编辑金标前，项目仍不发布独立准确率或 v0.5.0-rc1 结论。
