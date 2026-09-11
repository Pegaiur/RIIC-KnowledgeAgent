/**
 * 报告聚合：JSONL 记录 → Markdown 报告 + CSV
 */
import { isObservedTool, type CostRecord, type LlmUsage } from './types.js'
import { aggregateUsages } from './pricing.js'
import type { BenchSnapshot } from './snapshot.js'

export interface ReportQueryContext {
  id: string
  category: string
  rounds?: number
}

export interface QueryAgg {
  queryId: string
  category: string
  rounds: number
  outputTokens: number
  outputTokensExact: number | null
  reasoningTokens: number | null
  inputTokens: number
  inputTokensExact: number | null
  costOut: number
  costIn: number
  costTotal: number
  costComplete: boolean
  truncated: number
}

export interface ThinkingAgg {
  thinking: string
  queries: number
  calls: number
  avgRounds: number
  outputTokens: number
  outputTokensExact: number | null
  reasoningTokens: number | null
  inputTokens: number
  inputTokensExact: number | null
  costOut: number
  costIn: number
  costTotal: number
}

export interface BenchReport {
  totalCalls: number
  totalQueries: number
  totalInput: number
  totalOutput: number
  totalInputExact: number | null
  totalOutputExact: number | null
  totalCostIn: number
  totalCostOut: number
  totalCost: number
  truncatedCalls: number
  /** usage 不完整的模型调用数；totalCost 仅为已知费用小计。 */
  incompleteUsageCalls: number
  unknownUsageCalls: number
  costComplete: boolean
  totalHttpAttempts: number
  retryAttempts: number
  byQuery: QueryAgg[]
  byThinking: ThinkingAgg[]
  byProvider: ProviderAgg[]
  /** 独立工具调用统计；没有工具调用时返回空数组。 */
  toolUsage: ToolUsageAgg[]
  toolStats: ToolStatsAgg
  ragDeliveryStats: RagDeliveryStats
}

/** 内部查询与送达分层；历史或异常缺观测时为 null，不补零。 */
export interface RagDeliveryStats {
  internalFactsQueries: number | null
  attachedCalls: number | null
  omittedTerms: number | null
  deliveredCards: number | null
  expandedRanges: number | null
}

/** 按 provider 聚合（跨模型对比用） */
export interface ProviderAgg {
  provider: string
  queries: number
  calls: number
  avgRounds: number
  outputTokens: number
  outputTokensExact: number | null
  reasoningTokens: number | null
  inputTokens: number
  inputTokensExact: number | null
  costOut: number
  costIn: number
  costTotal: number
}

/** 独立工具调用统计（按模型响应中的函数调用计数）。 */
export interface ToolUsageAgg {
  tool: string
  calls: number
}

export interface ToolStatsAgg {
  batches: number
  requested: number
  granted: number
  executed: number
  denied: number
  errors: number
  /** 获准尝试数；历史记录缺该字段时为 null（不可用）。 */
  attempts: number | null
  /** 非空执行成功扣点数；历史记录缺该字段时为 null（不可用），不由 executed 推算。
   *  按 ADR-013 决策 5，success 即「RAG/facts 任一部分实际送达非空证据」，故本字段就是实际证据送达计数。 */
  successes: number | null
  /** 已执行且 hitIds 非空的结果数。旧 chunk 命中口径：只统计 RAG 分块/facts 卡命中，
   *  不含仅由内部附带 facts 送达（hitIds 为空）的 rag_search，故不能等同于证据送达；仅作兼容与诊断保留。 */
  hitCount: number
  /** 已执行但旧记录或异常缺少 hitIds 的结果数。 */
  hitUnknown: number
  resultChars: number
}

const sum = (vals: Array<number | null | undefined>): number => vals.reduce<number>((a, c) => a + (c ?? 0), 0)
const sumExact = (vals: Array<number | null | undefined>): number | null =>
  vals.length === 0 ? 0 : vals.some((value) => value === null || value === undefined)
    ? null
    : vals.reduce<number>((total, value) => total + (value as number), 0)
interface AccountingValues {
  input: number | null
  output: number | null
  knownInput: number | null
  knownOutput: number | null
  reasoning: number | null
  costIn: number | null
  costOut: number | null
  costTotal: number | null
}

const knownCost = (record: CostRecord): number => {
  const values = accountingValues(record)
  return values.costTotal ?? roundCost((values.costIn ?? 0) + (values.costOut ?? 0))
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * 以 HTTP 尝试为费用台账的优先来源；无标记的旧记录仍回退其原有字段。
 * 这样重试响应不会把最终响应的 usage 与尝试台账重复相加。
 */
function accountingValues(record: CostRecord): AccountingValues {
  const attempts = record.httpAttempts ?? []
  const hasAttemptUsage = attempts.some((attempt) => {
    const usage = attempt.usage as Partial<LlmUsage> | undefined
    return usage != null && (usage.input !== undefined || usage.output !== undefined)
  })
  const shouldUseAttempts = attempts.length > 0 && (record.usageAggregation === 'http_attempts' || hasAttemptUsage)
  if (!shouldUseAttempts) {
    return persistedValues(record)
  }

  // 旧记录的重试失败项可能只留有 unknown usage，不能用它覆盖记录中仍有效的响应分项。
  const hasKnownAttempt = attempts.some((attempt) => {
    const usage = attempt.usage
    return usage != null && (usage.input !== null || usage.output !== null)
  })
  if (record.usageAggregation !== 'http_attempts' && !hasKnownAttempt) {
    return persistedValues(record)
  }

  const usage = aggregateUsages(attempts.map((attempt) => attempt.usage ?? unknownAttemptUsage()))
  return {
    input: usage.input,
    output: usage.output,
    knownInput: usage.knownInput ?? null,
    knownOutput: usage.knownOutput ?? null,
    reasoning: usage.reasoning,
    // 费用是记录写盘时按当时配置计算的事实，报告不得按当前内置价格重算历史数据。
    costIn: record.costIn,
    costOut: record.costOut,
    costTotal: record.costTotal,
  }
}

function persistedValues(record: CostRecord): AccountingValues {
  return {
    input: record.input,
    output: record.output,
    knownInput: record.knownInput ?? record.input,
    knownOutput: record.knownOutput ?? record.output,
    reasoning: record.reasoning,
    costIn: record.costIn,
    costOut: record.costOut,
    costTotal: record.costTotal,
  }
}

function unknownAttemptUsage(): LlmUsage {
  return { input: null, output: null, cached: null, reasoning: null, completeness: 'unknown' }
}

const attemptIncomplete = (record: CostRecord): boolean =>
  (record.httpAttempts ?? []).some((attempt) => !attempt.usage || attempt.usage.completeness !== 'complete')
const recordIncomplete = (record: CostRecord): boolean =>
  record.usageCompleteness !== 'complete' || attemptIncomplete(record)
const recordUnknown = (record: CostRecord): boolean =>
  !record.usageCompleteness
  || record.usageCompleteness === 'unknown'
  || (record.httpAttempts ?? []).some((attempt) => !attempt.usage || !attempt.usage.completeness || attempt.usage.completeness === 'unknown')
const mean = (vals: number[]) => (vals.length ? sum(vals) / vals.length : 0)
const p95 = (vals: number[]) => {
  if (!vals.length) return 0
  const sorted = [...vals].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
}

function tokenValues(records: CostRecord[]): {
  inputTokens: number
  outputTokens: number
  inputTokensExact: number | null
  outputTokensExact: number | null
} {
  const values = records.map(accountingValues)
  return {
    inputTokens: sum(values.map((value) => value.knownInput)),
    outputTokens: sum(values.map((value) => value.knownOutput)),
    inputTokensExact: sumExact(values.map((value) => value.input)),
    outputTokensExact: sumExact(values.map((value) => value.output)),
  }
}

/**
 * 从记录数组聚合。
 * TODO(tech-debt) A2：函数较长，可提取局部 groupBy/sum 助手收敛模板；收益低，暂缓。
 */
export function aggregate(records: CostRecord[], queryContext: readonly ReportQueryContext[] = []): BenchReport {
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
      ...tokenValues(list),
      reasoningTokens: sumExact(list.map((r) => accountingValues(r).reasoning)),
      costOut: sum(list.map((r) => accountingValues(r).costOut)),
      costIn: sum(list.map((r) => accountingValues(r).costIn)),
      costTotal: sum(list.map(knownCost)),
      costComplete: list.length > 0 && list.every((r) => !recordIncomplete(r) && accountingValues(r).costTotal !== null),
      truncated: list.filter((r) => r.truncated).length,
    }
  })

  // 快照保留没有任何 CostRecord 的失败题；报告仍以完整题集作为分母。
  for (const query of queryContext) {
    if (byQuery.has(query.id)) continue
    queryAggs.push({
      queryId: query.id,
      category: query.category,
      rounds: query.rounds ?? 0,
      outputTokens: 0,
      outputTokensExact: 0,
      reasoningTokens: 0,
      inputTokens: 0,
      inputTokensExact: 0,
      costOut: 0,
      costIn: 0,
      costTotal: 0,
      costComplete: false,
      truncated: 0,
    })
  }

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
      ...tokenValues(list),
      reasoningTokens: sumExact(list.map((r) => accountingValues(r).reasoning)),
      costOut: sum(list.map((r) => accountingValues(r).costOut)),
      costIn: sum(list.map((r) => accountingValues(r).costIn)),
      costTotal: sum(list.map(knownCost)),
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
      ...tokenValues(list),
      reasoningTokens: sumExact(list.map((r) => accountingValues(r).reasoning)),
      costOut: sum(list.map((r) => accountingValues(r).costOut)),
      costIn: sum(list.map((r) => accountingValues(r).costIn)),
      costTotal: sum(list.map(knownCost)),
    }
  })

  const totals = tokenValues(records)
  return {
    totalCalls: records.length,
    totalQueries: new Set([...byQuery.keys(), ...queryContext.map((query) => query.id)]).size,
    totalInput: totals.inputTokens,
    totalOutput: totals.outputTokens,
    totalInputExact: totals.inputTokensExact,
    totalOutputExact: totals.outputTokensExact,
    totalCostIn: sum(records.map((r) => accountingValues(r).costIn)),
    totalCostOut: sum(records.map((r) => accountingValues(r).costOut)),
    totalCost: sum(records.map(knownCost)),
    truncatedCalls: records.filter((r) => r.truncated).length,
    incompleteUsageCalls: records.filter(recordIncomplete).length,
    unknownUsageCalls: records.filter(recordUnknown).length,
    costComplete: records.length > 0 && records.every((r) => !recordIncomplete(r) && accountingValues(r).costTotal !== null),
    totalHttpAttempts: records.reduce((total, record) => total + (record.httpAttempts?.length ?? 0), 0),
    retryAttempts: records.reduce((total, record) => total + (record.httpAttempts?.filter((attempt) => attempt.outcome === 'retry').length ?? 0), 0),
    byQuery: queryAggs,
    byThinking: thinkingAggs,
    byProvider: providerAggs,
    toolUsage: aggregateToolUsage(records),
    toolStats: aggregateToolStats(records),
    ragDeliveryStats: aggregateRagDelivery(records),
  }
}

/** 从共享快照聚合；queries 用于补齐无模型调用的失败题。 */
export function aggregateSnapshot(snapshot: BenchSnapshot): BenchReport {
  return aggregate(snapshot.records, snapshot.queries.map((query) => ({
    id: query.id,
    category: query.category,
    rounds: query.rounds,
  })))
}

/** 聚合独立函数工具调用，统计当前 run 内各工具被调用多少轮。 */
function aggregateToolUsage(records: CostRecord[]): ToolUsageAgg[] {
  const counter = new Map<string, number>()
  for (const r of records) {
    for (const t of r.tools ?? []) {
      if (isObservedTool(t)) counter.set(t, (counter.get(t) ?? 0) + 1)
    }
  }
  return [...counter.entries()]
    .map(([tool, calls]) => ({ tool, calls }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool))
}

function aggregateRagDelivery(records: CostRecord[]): RagDeliveryStats {
  const unavailable = { internalFactsQueries: null, attachedCalls: null, omittedTerms: null, deliveredCards: null, expandedRanges: null }
  if (records.some((record) => (record.tools ?? []).filter((tool) => tool === 'rag_search').length !== (record.ragDelivery?.length ?? 0))) return unavailable
  const calls = records.flatMap((record) => record.ragDelivery ?? [])
  const factsKnown = calls.every((call) => call.attachedFacts !== undefined)
  const facts = calls.flatMap((call) => call.attachedFacts ?? [])
  return {
    internalFactsQueries: factsKnown ? facts.length : null,
    attachedCalls: factsKnown ? calls.filter((call) => call.attachedFacts?.some((fact) => fact.delivered.length > 0)).length : null,
    omittedTerms: factsKnown ? facts.filter((fact) => fact.matched.length > 0 && fact.omittedReason !== null).length : null,
    // 同次跨词共享卡去重，跨次重复送达仍计入成本观测。
    deliveredCards: factsKnown ? sum(calls.map((call) => new Set(call.attachedFacts?.flatMap((fact) => fact.delivered)).size)) : null,
    expandedRanges: calls.every((call) => call.fulltextRanges !== undefined)
      ? calls.flatMap((call) => call.fulltextRanges ?? []).filter((range) => range.endOffset > range.offset).length : null,
  }
}

function aggregateToolStats(records: CostRecord[]): ToolStatsAgg {
  const batches = records.map((record) => record.toolBatch).filter((batch): batch is NonNullable<CostRecord['toolBatch']> => Boolean(batch))
  const hitCount = sum(batches.map((batch) => batch.hitCount))
  const hitUnknown = sum(batches.map((batch) => {
    if (batch.hitUnknown !== undefined) return batch.hitUnknown
    if (batch.hitCount !== undefined) return Math.max(0, batch.executed - batch.hitCount)
    return batch.executed
  }))
  return {
    batches: batches.length,
    requested: sum(batches.map((batch) => batch.requested)),
    granted: sum(batches.map((batch) => batch.granted)),
    executed: sum(batches.map((batch) => batch.executed)),
    denied: sum(batches.map((batch) => batch.denied)),
    errors: sum(batches.map((batch) => batch.errors)),
    attempts: sumOptionalField(records, batches, 'attempts'),
    successes: sumOptionalField(records, batches, 'successes'),
    hitCount,
    hitUnknown,
    resultChars: sum(batches.map((batch) => batch.resultChars)),
  }
}

/** 历史批次可能缺少新统计：存在工具调用却缺整个 toolBatch，或任一批次缺该字段，均整体不可用（null），不以 0 伪填或由 executed 推算。 */
function sumOptionalField(
  records: CostRecord[],
  batches: Array<NonNullable<CostRecord['toolBatch']>>,
  key: 'attempts' | 'successes',
): number | null {
  if (records.some((record) => (record.tools?.length ?? 0) > 0 && !record.toolBatch)) return null
  if (batches.length === 0) return 0
  if (batches.some((batch) => batch[key] === undefined)) return null
  return sum(batches.map((batch) => batch[key]!))
}

const f2 = (v: number) => v.toFixed(2)
const f4 = (v: number) => v.toFixed(4)
const exact = (v: number | null) => v === null ? '未知' : v.toLocaleString()
/** 历史缺失的新统计以「不可用」展示，回填 0 会与真实零次混淆。 */
const nullable = (v: number | null) => v === null ? '不可用' : v.toLocaleString()

/** 渲染 Markdown 报告 */
export function renderMarkdown(report: BenchReport): string {
  const p95Out = p95(report.byQuery.map((q) => q.outputTokens))
  const avgOut = mean(report.byQuery.map((q) => q.outputTokens)).toFixed(1)
  const lines: string[] = [
    '# LLM 查询输出成本基准报告',
    '',
    `- 查询数：${report.totalQueries}｜LLM 调用数：${report.totalCalls}｜截断调用：${report.truncatedCalls}`,
    `- 总输入 tokens：${report.totalInput.toLocaleString()}（已知小计；精确总量：${exact(report.totalInputExact)}）｜总输出 tokens：${report.totalOutput.toLocaleString()}（已知小计；精确总量：${exact(report.totalOutputExact)}）`,
    `- 总成本（已知）：¥${f4(report.totalCost)}（输入 ¥${f4(report.totalCostIn)} + 输出 ¥${f4(report.totalCostOut)}）`,
    `- 费用状态：${report.costComplete ? '完整' : '不完整'}｜不完整 usage 调用：${report.incompleteUsageCalls}｜用量未知调用：${report.unknownUsageCalls}`,
    `- HTTP 尝试：${report.totalHttpAttempts}｜重试：${report.retryAttempts}`,
    `- 每查询输出 tokens：均值 ${avgOut}｜P95 ${p95Out.toLocaleString()}`,
    `- 工具批次：${report.toolStats.batches}｜提出 ${report.toolStats.requested}｜准入 ${report.toolStats.granted}｜执行 ${report.toolStats.executed}｜拒绝 ${report.toolStats.denied}｜错误 ${report.toolStats.errors}｜获准尝试 ${nullable(report.toolStats.attempts)}｜证据送达（成功） ${nullable(report.toolStats.successes)}｜有命中（旧 chunk 口径，不含 facts-only 送达） ${report.toolStats.hitCount}｜命中未知 ${report.toolStats.hitUnknown}`,
    `- RAG 送达：原文范围 ${nullable(report.ragDeliveryStats.expandedRanges)}｜显式 facts_search ${report.toolUsage.find((item) => item.tool === 'facts_search')?.calls ?? 0}｜内部 facts 查询 ${nullable(report.ragDeliveryStats.internalFactsQueries)}｜实际附带调用 ${nullable(report.ragDeliveryStats.attachedCalls)}｜未附带词条 ${nullable(report.ragDeliveryStats.omittedTerms)}｜送达卡次 ${nullable(report.ragDeliveryStats.deliveredCards)}`,
    ...(report.toolUsage.length > 0
      ? [`- 工具调用：${report.toolUsage.map((u) => `${u.tool} ${u.calls} 次`).join('｜')}`]
      : []),
    '',
    '## 按思考档位',
    '',
    '| 档位 | 查询数 | 调用数 | 平均轮数 | 输出 tokens | 思考 tokens | 输出费用(元) | 总费用(元) |',
    '|------|--------|--------|----------|-------------|-------------|--------------|------------|',
    ...report.byThinking.map(
      (t) =>
        `| ${t.thinking} | ${t.queries} | ${t.calls} | ${f2(t.avgRounds)} | ${t.outputTokens.toLocaleString()} | ${(t.reasoningTokens?.toLocaleString() ?? '未知')} | ${f4(t.costOut)} | ${f4(t.costTotal)} |`,
    ),
    '',
    '## 按查询',
    '',
    '| 查询 ID | 类目 | 轮数 | 输出 tokens | 思考 tokens | 输出费用(元) | 总费用(元) | 费用完整 | 截断 |',
    '|---------|------|------|-------------|-------------|--------------|------------|----------|------|',
    ...report.byQuery.map(
      (q) =>
        `| ${q.queryId} | ${q.category} | ${q.rounds} | ${q.outputTokens} | ${q.reasoningTokens ?? '未知'} | ${f4(q.costOut)} | ${f4(q.costTotal)} | ${q.costComplete} | ${q.truncated} |`,
    ),
    '',
  ]
  return lines.join('\n')
}

/** 渲染 CSV（每查询一行） */
export function renderCsv(report: BenchReport): string {
  const header = 'queryId,category,rounds,outputTokens,outputTokensExact,reasoningTokens,inputTokens,inputTokensExact,costOut,costIn,costTotal,costComplete,truncated'
  const rows = report.byQuery.map(
    (q) =>
      `${q.queryId},${q.category},${q.rounds},${q.outputTokens},${q.outputTokensExact ?? ''},${q.reasoningTokens ?? ''},${q.inputTokens},${q.inputTokensExact ?? ''},${q.costOut},${q.costIn},${q.costTotal},${q.costComplete},${q.truncated}`,
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
      return `| ${p?.provider ?? '?'} | ${r.totalQueries} | ${r.totalCalls} | ${f2(r.byThinking[0]?.avgRounds ?? 0)} | ${r.totalInput.toLocaleString()} | ${r.totalOutput.toLocaleString()} | ${p?.reasoningTokens?.toLocaleString() ?? '未知'} | ${f4(r.totalCost)} | ${f4(r.totalCostOut)} |`
    }),
    '',
  ]
  return lines.join('\n')
}
