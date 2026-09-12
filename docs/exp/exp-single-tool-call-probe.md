# 单工具调用参数与提示服从性探针

> 创建日期：2026-09-12
> 状态：已结束
> 结束日期：2026-09-12
> 需求入口：docs/inbox.md「单工具调用准入」

## 过程

本记录从单工具调用准入与具名取证草案迁入，保留原有观察数据；迁移时未重新请求模型或复核原始响应。工程方案见 docs/plan-single-tool-call-and-facts-evidence.md。

原记录使用 glm-5.3-flash（open.bigmodel.cn/api/paas/v4）与合成 get_weather 工具，比较 parallel_tool_calls 为 false、缺省、true 的三次响应，每种形态一例。其后以 knowledge/AGENTS.md 全文作为 system，比较无 system 中性问法、带 system 中性问法、带 system 平行诱导问法，每组 3 次。中性问法为「北京和上海的天气怎么样？」，平行诱导问法包含「请同时查询北京和上海…两个城市都要查」。

原草案同时记录已强化 knowledge/AGENTS.md 第 4 条单调用约束。各次请求的完整配置、采样参数、指令精确版本及费用未在原草案中完整记录，此处不补造。没有多轮轨迹、真实知识库工具、流式或跨模型对照。原记录称查阅过 docs.bigmodel.cn 工具调用与对话补全参考，未保留精确页面链接；该文档核查说法未在本次迁移中重新验证，不作为跨 provider 的能力结论。

## 结果

| 请求形态 | HTTP | 返回 tool_calls | finish_reason |
|---|---|---|---|
| parallel_tool_calls:false | 200 | 2 个（get_weather×2） | tool_calls |
| 不带 parallel_tool_calls | 200 | 2 个（get_weather×2） | tool_calls |
| parallel_tool_calls:true | 200 | 2 个（get_weather×2） | tool_calls |

| 变体 | 问题措辞 | 3 次返回的 tool_calls 数 | 出现多调用 |
|---|---|---|---|
| 无 system（基线） | 中性 | 2、2、2 | 3/3 |
| 注入 AGENTS.md | 中性 | 1、1、1 | 0/3 |
| 注入 AGENTS.md | 平行诱导 | 2、2、1 | 2/3 |

## 结论

上述样本中，含 false 参数的请求得到 HTTP 200，但仍返回两个调用；只能说明该配置下观察到参数未阻止多调用，HTTP 200 不能证明端点实现了该参数语义。原草案「参数无效」「不改变行为」的泛化表述收窄为这一观察，不推断其他模型或端点的能力。

带指令的中性组未出现多调用，平行诱导组出现 2/3 次多调用，说明提示不构成此次样本中的硬保证。完整 AGENTS 的领域限制是明日方舟基建，天气任务与该限制冲突；样本少且工具合成，不能据此量化真实知识库查询的服从率或提示优化收益。工程选择是由宿主保证最多准入一个调用，不以该探针承诺质量与成本收益。

本记录未经独立复核，不指定正式基线；本次只迁移既有观察，未新增付费运行或试验附件，不承诺完整重放。原脚本 dev-temp/glm-parallel-probe/probe.mjs 在迁移时仍存在，位于 scripts/INDEX.md 清理白名单 work/runs 之外；本次不移动路径绕过边界或直接删除。遗留脚本清理尚未完成，需在已有规则允许的历史路径处理方式明确后再处理，不为其扩展本工程的清理器范围。
