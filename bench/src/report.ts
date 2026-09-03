/**
 * 报告聚合：JSONL 记录 → Markdown 报告 + CSV
 */
import { isRetrievalTool, isFactTool, type CostRecord } from './types.js'

export interface QueryAgg {
  queryId: string
  category: string
  rounds: number
  outputTokens: number
  reasoningTokens: number
  inputTokens: number
  costOut: number
  costIn: number
  costTotal: number
  truncated: number
}

export interface ThinkingAgg {
  thinking: string
  queries: number
  calls: number
  avgRounds: number
  outputTokens: number
  reasoningTokens: number
  inputTokens: number
  costOut: number
  costIn: number
  costTotal: number
}

export interface BenchReport {
  totalCalls: number
  totalQueries: number
  totalInput: number
  totalOutput: number
  totalCostIn: number
  totalCostOut: number
  totalCost: number
  truncatedCalls: number
  byQuery: QueryAgg[]
  byThinking: ThinkingAgg[]
  byProvider: ProviderAgg[]
  /** 检索工具调用统计（双工具模式；单工具模式返回空数组） */
  toolUsage: ToolUsageAgg[]
}

/** 按 provider 聚合（跨模型对比用） */
export interface ProviderAgg {
  provider: string
  queries: number
  calls: number
  avgRounds: number
  outputTokens: number
  reasoningTokens: number
  inputTokens: number
  costOut: number
  costIn: number
  costTotal: number
}

/** 检索工具调用统计（双工具模式） */
export interface ToolUsageAgg {
  tool: string
  calls: number
}

const sum = (vals: number[]) => vals.reduce((a, c) => a + c, 0)
const mean = (vals: number[]) => (vals.length ? sum(vals) / vals.length : 0)
const p95 = (vals: number[]) => {
  if (!vals.length) return 0
  const sorted = [...vals].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
}

/**
 * 从记录数组聚合。
 * TODO(tech-debt) A2：函数较长，可提取局部 groupBy/sum 助手收敛模板；收益低，暂缓。
 */
export function aggregate(records: CostRecord[]): BenchReport {
  const byQuery = new Map<string, CostRecord[]>()
  for (const r of records) {
    const list = byQuery.get(r.queryId) ?? []
    list.push(r)
    byQuery.set(r.queryId, list)
  }

  const queryAggs: QueryAgg[] = [...byQuery.entries()].map(([queryId, list]) => {
    const first = list[0]
    return {
      queryId,
      category: first.category,
      rounds: list.length,
      outputTokens: sum(list.map((r) => r.output)),
      reasoningTokens: sum(list.map((r) => r.reasoning ?? 0)),
      inputTokens: sum(list.map((r) => r.input)),
      costOut: sum(list.map((r) => r.costOut)),
      costIn: sum(list.map((r) => r.costIn)),
      costTotal: sum(list.map((r) => r.costTotal)),
      truncated: list.filter((r) => r.truncated).length,
    }
  })

  const byThinking = new Map<string, CostRecord[]>()
  for (const r of records) {
    const list = byThinking.get(r.thinking) ?? []
    list.push(r)
    byThinking.set(r.thinking, list)
  }

  const thinkingAggs: ThinkingAgg[] = [...byThinking.entries()].map(([thinking, list]) => {
    const qids = new Set(list.map((r) => r.queryId))
    const perQueryRounds = [...qids].map(
      (qid) => list.filter((r) => r.queryId === qid).length,
    )
    return {
      thinking,
      queries: qids.size,
      calls: list.length,
      avgRounds: mean(perQueryRounds),
      outputTokens: sum(list.map((r) => r.output)),
      reasoningTokens: sum(list.map((r) => r.reasoning ?? 0)),
      inputTokens: sum(list.map((r) => r.input)),
      costOut: sum(list.map((r) => r.costOut)),
      costIn: sum(list.map((r) => r.costIn)),
      costTotal: sum(list.map((r) => r.costTotal)),
    }
  })

  const byProvider = new Map<string, CostRecord[]>()
  for (const r of records) {
    // 旧记录可能无 provider 字段，回退用 model 标识
    const key = r.provider ?? r.model
    const list = byProvider.get(key) ?? []
    list.push(r)
    byProvider.set(key, list)
  }

  const providerAggs: ProviderAgg[] = [...byProvider.entries()].map(([provider, list]) => {
    const qids = new Set(list.map((r) => r.queryId))
    const perQueryRounds = [...qids].map(
      (qid) => list.filter((r) => r.queryId === qid).length,
    )
    return {
      provider,
      queries: qids.size,
      calls: list.length,
      avgRounds: mean(perQueryRounds),
      outputTokens: sum(list.map((r) => r.output)),
      reasoningTokens: sum(list.map((r) => r.reasoning ?? 0)),
      inputTokens: sum(list.map((r) => r.input)),
      costOut: sum(list.map((r) => r.costOut)),
      costIn: sum(list.map((r) => r.costIn)),
      costTotal: sum(list.map((r) => r.costTotal)),
    }
  })

  return {
    totalCalls: records.length,
    totalQueries: byQuery.size,
    totalInput: sum(records.map((r) => r.input)),
    totalOutput: sum(records.map((r) => r.output)),
    totalCostIn: sum(records.map((r) => r.costIn)),
    totalCostOut: sum(records.map((r) => r.costOut)),
    totalCost: sum(records.map((r) => r.costTotal)),
    truncatedCalls: records.filter((r) => r.truncated).length,
    byQuery: queryAggs,
    byThinking: thinkingAggs,
    byProvider: providerAggs,
    toolUsage: aggregateToolUsage(records),
  }
}

/** 聚合检索工具调用（双工具模式统计当前 run 内 rag/grep 各被调用多少轮） */
function aggregateToolUsage(records: CostRecord[]): ToolUsageAgg[] {
  const counter = new Map<string, number>()
  for (const r of records) {
    for (const t of r.tools ?? []) {
      if (isRetrievalTool(t) || isFactTool(t)) counter.set(t, (counter.get(t) ?? 0) + 1)
    }
  }
  return [...counter.entries()]
    .map(([tool, calls]) => ({ tool, calls }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool))
}

const f2 = (v: number) => v.toFixed(2)
const f4 = (v: number) => v.toFixed(4)

/** 渲染 Markdown 报告 */
export function renderMarkdown(report: BenchReport): string {
  const p95Out = p95(report.byQuery.map((q) => q.outputTokens))
  const avgOut = mean(report.byQuery.map((q) => q.outputTokens)).toFixed(1)
  const lines: string[] = [
    '# LLM 查询输出成本基准报告',
    '',
    `- 查询数：${report.totalQueries}｜LLM 调用数：${report.totalCalls}｜截断调用：${report.truncatedCalls}`,
    `- 总输入 tokens：${report.totalInput.toLocaleString()}｜总输出 tokens：${report.totalOutput.toLocaleString()}`,
    `- 总成本：¥${f4(report.totalCost)}（输入 ¥${f4(report.totalCostIn)} + 输出 ¥${f4(report.totalCostOut)}）`,
    `- 每查询输出 tokens：均值 ${avgOut}｜P95 ${p95Out.toLocaleString()}`,
    ...(report.toolUsage.length > 0
      ? [`- 检索工具调用：${report.toolUsage.map((u) => `${u.tool} ${u.calls} 次`).join('｜')}`]
      : []),
    '',
    '## 按思考档位',
    '',
    '| 档位 | 查询数 | 调用数 | 平均轮数 | 输出 tokens | 思考 tokens | 输出费用(元) | 总费用(元) |',
    '|------|--------|--------|----------|-------------|-------------|--------------|------------|',
    ...report.byThinking.map(
      (t) =>
        `| ${t.thinking} | ${t.queries} | ${t.calls} | ${f2(t.avgRounds)} | ${t.outputTokens.toLocaleString()} | ${t.reasoningTokens.toLocaleString()} | ${f4(t.costOut)} | ${f4(t.costTotal)} |`,
    ),
    '',
    '## 按查询',
    '',
    '| 查询 ID | 类目 | 轮数 | 输出 tokens | 思考 tokens | 输出费用(元) | 总费用(元) | 截断 |',
    '|---------|------|------|-------------|-------------|--------------|------------|------|',
    ...report.byQuery.map(
      (q) =>
        `| ${q.queryId} | ${q.category} | ${q.rounds} | ${q.outputTokens} | ${q.reasoningTokens} | ${f4(q.costOut)} | ${f4(q.costTotal)} | ${q.truncated} |`,
    ),
    '',
  ]
  return lines.join('\n')
}

/** 渲染 CSV（每查询一行） */
export function renderCsv(report: BenchReport): string {
  const header = 'queryId,category,rounds,outputTokens,reasoningTokens,inputTokens,costOut,costIn,costTotal,truncated'
  const rows = report.byQuery.map(
    (q) =>
      `${q.queryId},${q.category},${q.rounds},${q.outputTokens},${q.reasoningTokens},${q.inputTokens},${q.costOut},${q.costIn},${q.costTotal},${q.truncated}`,
  )
  return [header, ...rows].join('\n')
}

/** 渲染跨模型对比总览（合并多个 provider 报告） */
export function renderCrossProvider(reports: BenchReport[]): string {
  const lines: string[] = [
    '# 跨模型输出成本对比',
    '',
    '| 模型 | 查询数 | 调用数 | 平均轮数 | 总输入 | 总输出 | 思考 tokens | 总费用(元) | 输出费用(元) |',
    '|------|--------|--------|----------|--------|--------|-------------|-------------|--------------|',
    ...reports.map((r) => {
      const p = r.byProvider[0]
      return `| ${p?.provider ?? '?'} | ${r.totalQueries} | ${r.totalCalls} | ${f2(r.byThinking[0]?.avgRounds ?? 0)} | ${r.totalInput.toLocaleString()} | ${r.totalOutput.toLocaleString()} | ${(p?.reasoningTokens ?? 0).toLocaleString()} | ${f4(r.totalCost)} | ${f4(r.totalCostOut)} |`
    }),
    '',
  ]
  return lines.join('\n')
}
