# 实施笔记：基准结果入库与分支收尾清理

> 对应 spec：[plan-temp-cleanup.md](plan-temp-cleanup.md)
> 开始日期：2026-09-06

## 决策偏离

暂无。已按用户确认及独立评审收敛的计划实施，不重新引入多文件快照或自动归属协议。

## 实现调整

已新增 `bench/src/snapshot.ts`，将运行目录解析为单文件 JSON 快照：顶层固定为 `schemaVersion`、`runId`、`topic`、`meta`、`queries`、`records`；CostRecord 按白名单提取，HTTP 尝试保留用量和结果状态但丢弃错误诊断文本，问题/答案文本执行密钥模式脱敏。相同快照重复导出不覆盖，内容冲突拒绝覆盖。

`report`/`compare` 现在可直接读取快照，并用 `queries` 补齐没有 CostRecord 的失败题。运行器 meta 增加题目 ID、仓库内相对题集路径及嵌入式题目定义、价格快照、主题和运行时 Git/Node/包版本信息；仓库外题集不记录绝对路径，导出依靠嵌入定义恢复。源码版本在运行时采集，缺失时保留 null。

`scripts/tooling.mjs` 增加显式清理清单生成、预览和 apply：清单只含 `path`、指纹及 `snapshot`/`reason`，清单文件固定在仓库内 `dev-temp/`，目标固定在 `dev-temp/` 或 `bench-runs` 运行目录。删除前复核指纹、Git 跟踪状态、`.keep`、reparse point、运行结束产物和共享快照提交状态；默认预览，部分失败保留清单；旧的无清单入口仅允许 dry-run，真实删除必须走 manifest。`release-workflow` 与 `scripts/INDEX.md` 已补充共享后清理步骤。

修正旧 `answers.md` 解析为从最后一行元数据之后读取正文，兼容旧版轮数/检索次数/工具序列格式并保留多行答案中的空行；并为缺少历史 `truncated` 标记的 JSONL 提供兼容缺省值。

## 债务记录

暂无新增债务。

## 意外发现

旧运行目录中部分历史结果没有 `answers.md`、`injected.json` 或题集路径。导出器优先读取运行 meta 和现有文件，缺失时回落仓库题集并按 meta 的题数/题号裁剪；仍无法取得题目时保留 records 中出现的 queryId，不静默丢弃计量事实。旧存量的数量和体积来自 2026-09-05 盘点，实施导出前仍需重新确认实际输入。

## 阻塞与解决

当前分支为 `feature/temp-cleanup`，沿用现有目录，未新建工作树。全量测试和 typecheck/build 已通过；`node scripts/doc-check.mjs --json` 仅保留计划施工中的 7 个 D1 未勾选错误，未为通过检查提前勾选。验证使用隔离临时目录和既有 dry 运行，没有发起真实付费 LLM 请求。
