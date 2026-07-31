# EvidenceGate OCR

[English](README.md) | [简体中文](README.zh-CN.md)

**在文档 AI 输出进入企业系统之前，增加一道与模型厂商无关的证据门禁。**

OCR 或视觉模型成功返回，不等于业务事实正确。EvidenceGate 保存原始响应，校验结构和字段证据，执行确定性业务规则，并把不确定、遮挡、冲突和文档内提示词交给人处理。

它不审批、不发布、不付款，也不静默写入企业业务状态。

## 三种路由

- `ACCEPT_CANDIDATE`：结构和冻结规则通过，仍需人作最终决定；
- `HUMAN_REVIEW`：结果可解析，但存在不确定、遮挡、冲突或需人工核对的证据；
- `MODEL_OUTPUT_INVALID`：结构、字段类型或证据元数据无效，应重试、修复集成或重新提交。

CLI 退出码 `0` 只表示程序成功执行，不能代替业务路由。

## 五分钟运行

需要 Node.js 20 或更高版本；运行测试不需要 API Key，也不需要安装依赖。

```powershell
git clone https://github.com/2487238628/evidencegate-ocr.git
cd evidencegate-ocr
npm test
.\verify-release.ps1
```

运行冻结的采购候选样例：

```powershell
node evidence-gate-cli.mjs --candidate examples/procurement-invoice/candidate.json --schema examples/procurement-invoice/schema.json --expected examples/procurement-invoice/expected.json --output gate-result.json
```

预期核心输出：

```json
{
  "status": "ACCEPT_CANDIDATE",
  "human_required": true,
  "erp_write_allowed": false
}
```

## 评测矩阵与证据边界

“冻结”表示在修改规则前固定输入、预期路由和哈希。下列各行的统计单位不同，不能相加成一个样本总数。

| 层级 | 评测单位 | 规模 | 结果 | 不能证明什么 |
|---|---|---:|---|---|
| 契约回归 | 结构化候选 | 14 条 | 14/14 | 只验证解析、字段和规则回归 |
| 确定性对抗路由 | 结构化候选 | 30 条 | 30/30；危险误接收 0/20；正常误拦截 0/10 | 不代表 OCR 准确率 |
| 艺文迁移 | 明确标注的合成候选 | 12 条 | 12/12 | 不代表活动真实或编辑准确 |
| 百炼模型开发 | 5 张独立合成图片 × 3 轮 | 15 次模型调用 | 路由 2/5 → 3/5 → 5/5 | 同一开发集重复迭代，不是隐藏集 |
| 人工修正回放 | 来源于上述图片的修正事件 | 3 条 | 3/3 已应用 | 不是独立用户反馈 |

第三轮字段精确一致为 41/45。4 个错误全部来自右侧裁切图片：模型把残缺的发票号码、供应商、购买方和采购单号当成完整值返回，且没有主动报告不确定性。本轮依靠冻结标准答案将其转入人工复核；没有对照值的新文档仍可能存在风险。

百炼模型没有返回页码或坐标框，因此证据定位覆盖为 0/45。项目没有伪造坐标。v0.3.1 起，领域 schema 可以将关键字段设置为 `"locator_required": true`；缺少定位时返回 `HUMAN_REVIEW / EVIDENCE_LOCATOR_REQUIRED`。这修复了门禁策略缺口，但不会让历史模型输出凭空获得定位。

以上是开发证据，不构成生产 OCR 准确率、独立泛化能力或证据定位质量结论。

## 行业样例

- `examples/procurement-invoice/`：采购票据字段、金额和证据校验；
- `examples/arts-event/`：面向艺文活动编辑与可信发布的合成对抗案例。

独立运行艺文案例：

```powershell
npm run test:arts
```

## Skill

可复用 Skill 位于 `skills/evidencegate-ocr/`。它要求保存原始输入、执行三态路由、记录运行证据，并保留人的最终责任。

## 参与贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。新增行业案例必须使用合成或不可逆脱敏数据，先冻结期望路由，再修改规则；不得把 Demo 结果包装成生产结论。

## 安全边界

- 公开证据只使用合成或不可逆脱敏材料；
- 密钥只从环境变量读取，不进入日志、JSON 或截图；
- 缺失的置信度和证据位置保持 `null`；
- 所有路由都需要人作业务决定；
- 自动写入业务状态保持关闭。

## 许可证

[Apache-2.0](LICENSE)
