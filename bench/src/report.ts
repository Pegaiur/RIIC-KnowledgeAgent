/**
 * 报告聚合：JSONL 记录 → Markdown 报告 + CSV
 */
import type { CostRecord } from './types.js'

export interface QueryAgg {
  queryId: string
  category: string
  rounds: number
  outputTokens: number
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
}

const sum = (vals: number[]) => vals.reduce((a, c) => a + c, 0)
const mean = (vals: number[]) => (vals.length ? sum(vals) / vals.length : 0)
const p95 = (vals: number[]) => {
  if (!vals.length) return 0
  const sorted = [...vals].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
}

/** 从记录数组聚合 */
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
  }
}

const f2 = (v: number) => v.toFixed(2)
const f4 = (v: number) => v.toFixed(4)

/** 渲染 Markdown 报告 */
export function renderMarkdown(report: BenchReport): string {
  const p95Out = p95(report.byQuery.map((q) => q.outputTokens))
  const avgOut = mean(report.byQuery.map((q) => q.outputTokens)).toFixed(1)
  const lines: string[] = [
    '# Hy3 查询输出成本基准报告',
    '',
    `- 查询数：${report.totalQueries}｜LLM 调用数：${report.totalCalls}｜截断调用：${report.truncatedCalls}`,
    `- 总输入 tokens：${report.totalInput.toLocaleString()}｜总输出 tokens：${report.totalOutput.toLocaleString()}`,
    `- 总成本：¥${f4(report.totalCost)}（输入 ¥${f4(report.totalCostIn)} + 输出 ¥${f4(report.totalCostOut)}）`,
    `- 每查询输出 tokens：均值 ${avgOut}｜P95 ${p95Out.toLocaleString()}`,
    '',
    '## 按思考档位',
    '',
    '| 档位 | 查询数 | 调用数 | 平均轮数 | 输出 tokens | 输出费用(元) | 总费用(元) |',
    '|------|--------|--------|----------|-------------|--------------|------------|',
    ...report.byThinking.map(
      (t) =>
        `| ${t.thinking} | ${t.queries} | ${t.calls} | ${f2(t.avgRounds)} | ${t.outputTokens.toLocaleString()} | ${f4(t.costOut)} | ${f4(t.costTotal)} |`,
    ),
    '',
    '## 按查询',
    '',
    '| 查询 ID | 类目 | 轮数 | 输出 tokens | 输出费用(元) | 总费用(元) | 截断 |',
    '|---------|------|------|-------------|--------------|------------|------|',
    ...report.byQuery.map(
      (q) =>
        `| ${q.queryId} | ${q.category} | ${q.rounds} | ${q.outputTokens} | ${f4(q.costOut)} | ${f4(q.costTotal)} | ${q.truncated} |`,
    ),
    '',
  ]
  return lines.join('\n')
}

/** 渲染 CSV（每查询一行） */
export function renderCsv(report: BenchReport): string {
  const header = 'queryId,category,rounds,outputTokens,inputTokens,costOut,costIn,costTotal,truncated'
  const rows = report.byQuery.map(
    (q) =>
      `${q.queryId},${q.category},${q.rounds},${q.outputTokens},${q.inputTokens},${q.costOut},${q.costIn},${q.costTotal},${q.truncated}`,
  )
  return [header, ...rows].join('\n')
}
