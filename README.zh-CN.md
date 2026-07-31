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

## 已冻结证据

- 契约与基础规则：13 条；
- 确定性对抗集：30 条，危险误接收 0/20，正常样本误拦截 0/10；
- 艺文活动领域：12 条，覆盖稿件意图、时间、公共参与证据、来源冲突、不确定性和文档内提示词；
- 百炼图片开发集：5 张 GPT-image-2 合成采购图片，使用 `qwen3-vl-plus` 完成三轮冻结迭代；
- 人工修正回放：3 条，保留修正前后值。

这些结果验证门禁路由，不代表生产 OCR 准确率、SLA 或真实业务收益。

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
