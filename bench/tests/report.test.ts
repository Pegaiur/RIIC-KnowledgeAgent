import { describe, expect, it } from 'vitest'
import { aggregate, renderCsv, renderMarkdown } from '../src/report.js'
import type { CostRecord } from '../src/types.js'

function rec(partial: Partial<CostRecord>): CostRecord {
  return {
    ts: '2026-08-31T00:00:00.000Z',
    queryId: 'Q1',
    category: 'fact',
    round: 1,
    thinking: 'off',
    provider: 'hy3',
    model: 'hy3',
    input: 6000,
    output: 800,
    cached: 0,
    reasoning: 0,
    costIn: 0.006,
    costOut: 0.0032,
    costTotal: 0.0092,
    truncated: false,
    ...partial,
  }
}

describe('report：聚合与渲染', () => {
  it('缺失思考分项保持未知，不被聚合为零', () => {
    const report = aggregate([rec({ reasoning: null }), rec({ reasoning: 2 })])
    expect(report.byQuery[0].reasoningTokens).toBeNull()
    expect(report.byThinking[0].reasoningTokens).toBeNull()
    expect(report.byProvider[0].reasoningTokens).toBeNull()
    expect(renderMarkdown(report)).toContain('未知')
  })
  it('按查询聚合轮数与 tokens', () => {
    const records = [
      rec({ queryId: 'Q1', round: 1, output: 800 }),
      rec({ queryId: 'Q1', round: 2, output: 1200 }),
      rec({ queryId: 'Q2', round: 1, output: 500 }),
    ]
    const report = aggregate(records)
    expect(report.totalCalls).toBe(3)
    expect(report.totalQueries).toBe(2)
    const q1 = report.byQuery.find((q) => q.queryId === 'Q1')!
    expect(q1.rounds).toBe(2)
    expect(q1.outputTokens).toBe(2000)
    expect(report.totalOutput).toBe(2500)
  })

  it('按思考档位分组', () => {
    const records = [
      rec({ thinking: 'off', output: 800 }),
      rec({ thinking: 'low', output: 5000 }),
    ]
    const report = aggregate(records)
    const low = report.byThinking.find((t) => t.thinking === 'low')!
    expect(low.outputTokens).toBe(5000)
    expect(low.calls).toBe(1)
  })

  it('截断调用计数', () => {
    const report = aggregate([rec({ truncated: true }), rec({ truncated: false })])
    expect(report.truncatedCalls).toBe(1)
  })

  it('按工具批次聚合准入、执行、拒绝和结果字符数，并标记不完整 usage', () => {
    const report = aggregate([
      rec({
        usageCompleteness: 'partial',
        input: null,
        costIn: null,
        toolBatch: {
          requested: 3,
          granted: 2,
          executed: 2,
          denied: 1,
          errors: 0,
          budgetBefore: 2,
          budgetAfter: 0,
          resultChars: 120,
        },
      }),
    ])

    expect(report.incompleteUsageCalls).toBe(1)
    expect(report.unknownUsageCalls).toBe(0)
    expect(report.costComplete).toBe(false)
    expect(report.toolStats).toEqual({ batches: 1, requested: 3, granted: 2, executed: 2, denied: 1, errors: 0, attempts: null, successes: null, hitCount: 0, hitUnknown: 2, resultChars: 120 })
    expect(renderMarkdown(report)).toContain('费用状态：不完整')
    expect(renderMarkdown(report)).toContain('获准尝试 不可用｜成功 不可用')
  })

  it('新批次聚合获准尝试与非空成功数，缺失时保持不可用', () => {
    const withNewStats = aggregate([
      rec({ toolBatch: { requested: 3, granted: 2, executed: 2, denied: 1, errors: 0, attempts: 2, successes: 1, budgetBefore: 5, budgetAfter: 4, resultChars: 90 } }),
      rec({ round: 2, toolBatch: { requested: 2, granted: 2, executed: 2, denied: 0, errors: 0, attempts: 2, successes: 1, budgetBefore: 4, budgetAfter: 3, resultChars: 60 } }),
    ])
    expect(withNewStats.toolStats).toMatchObject({ attempts: 4, successes: 2 })
    expect(renderMarkdown(withNewStats)).toContain('获准尝试 4｜成功 2')

    const mixed = aggregate([
      rec({ toolBatch: { requested: 1, granted: 1, executed: 1, denied: 0, errors: 0, attempts: 1, successes: 1, budgetBefore: 5, budgetAfter: 4, resultChars: 10 } }),
      rec({ round: 2, toolBatch: { requested: 1, granted: 1, executed: 1, denied: 0, errors: 0, budgetBefore: 4, budgetAfter: 3, resultChars: 10 } }),
    ])
    expect(mixed.toolStats).toMatchObject({ attempts: null, successes: null })
  })

  it('部分 usage 仍汇总已知费用，并把重试未知用量标为不完整', () => {
    const report = aggregate([rec({
      input: null,
      output: 1000,
      costIn: null,
      costOut: 0.0008,
      costTotal: null,
      usageCompleteness: 'partial',
      httpAttempts: [{
        attempt: 1,
        status: 503,
        outcome: 'retry',
        usage: { input: null, output: null, cached: 0, reasoning: 0, completeness: 'unknown' },
      }],
    })])

    expect(report.totalCostOut).toBe(0.0008)
    expect(report.totalCost).toBe(0.0008)
    expect(report.byQuery[0]?.costTotal).toBe(0.0008)
    expect(report.incompleteUsageCalls).toBe(1)
    expect(report.unknownUsageCalls).toBe(1)
    expect(report.costComplete).toBe(false)
    expect(renderCsv(report)).toContain('costComplete')
    expect(renderCsv(report)).toContain('false')
  })

  it('按 HTTP 尝试聚合完整 usage，避免只统计最终响应', () => {
    const report = aggregate([rec({
      provider: 'qwen',
      model: 'qwen3.7-flash',
      input: 100,
      output: 10,
      costIn: 0.000045,
      costOut: 0.000044,
      costTotal: 0.000089,
      usageCompleteness: 'complete',
      usageAggregation: 'http_attempts',
      httpAttempts: [
        { attempt: 1, status: 503, outcome: 'retry', usage: { input: 123, output: 45, cached: 0, reasoning: 0, completeness: 'complete' } },
        { attempt: 2, status: 200, outcome: 'accepted', usage: { input: 100, output: 10, cached: 0, reasoning: 0, completeness: 'complete' } },
      ],
    })])

    expect(report.totalInput).toBe(223)
    expect(report.totalOutput).toBe(55)
    expect(report.totalCostIn).toBe(0.000045)
    expect(report.totalCostOut).toBe(0.000044)
    expect(report.totalCost).toBe(0.000089)
    expect(report.costComplete).toBe(true)
  })

  it('未知尝试不补零，但保留后续已知费用小计并标记不完整', () => {
    const report = aggregate([rec({
      provider: 'qwen',
      model: 'qwen3.7-flash',
      input: null,
      output: null,
      costIn: 0.00002,
      costOut: 0.000008,
      costTotal: null,
      usageCompleteness: 'unknown',
      usageAggregation: 'http_attempts',
      httpAttempts: [
        { attempt: 1, status: 503, outcome: 'retry', usage: { input: null, output: null, cached: 0, reasoning: 0, completeness: 'unknown' } },
        { attempt: 2, status: 200, outcome: 'accepted', usage: { input: 100, output: 10, cached: 0, reasoning: 0, completeness: 'complete' } },
      ],
    })])

    expect(report.totalCostIn).toBe(0.00002)
    expect(report.totalCostOut).toBe(0.000008)
    expect(report.totalCost).toBeCloseTo(0.000028, 10)
    expect(report.totalInput).toBe(100)
    expect(report.totalOutput).toBe(10)
    expect(report.totalInputExact).toBeNull()
    expect(report.totalOutputExact).toBeNull()
    expect(report.costComplete).toBe(false)
  })

  it('报告信任记录中持久化的费用，不按当前 provider 内置价格漂移', () => {
    const report = aggregate([rec({
      provider: 'qwen',
      model: 'qwen3.7-flash',
      input: 100,
      output: 10,
      costIn: 0.0001,
      costOut: 0.00004,
      costTotal: 0.00014,
      usageCompleteness: 'complete',
    })])

    expect(report.totalCostIn).toBe(0.0001)
    expect(report.totalCostOut).toBe(0.00004)
    expect(report.totalCost).toBe(0.00014)
    expect(report.costComplete).toBe(true)
  })

  it('跨查询汇总保留已知小计、exact 未知和明确零值', () => {
    const report = aggregate([
      rec({ queryId: 'Q1', input: null, output: null, knownInput: 100, knownOutput: 10, costIn: 0.00002, costOut: 0.000008, costTotal: 0.000028, usageCompleteness: 'partial' }),
      rec({ queryId: 'Q2', input: 0, output: 0, knownInput: 0, knownOutput: 0, cached: 0, costIn: 0, costOut: 0, costTotal: 0, usageCompleteness: 'complete' }),
    ])

    expect(report.totalInput).toBe(100)
    expect(report.totalOutput).toBe(10)
    expect(report.totalInputExact).toBeNull()
    expect(report.totalOutputExact).toBeNull()
    expect(report.byQuery.find((query) => query.queryId === 'Q2')).toMatchObject({ inputTokens: 0, outputTokens: 0, inputTokensExact: 0, outputTokensExact: 0 })
  })

  it('双工具模式统计工具调用次数（按调用计数）', () => {
    const records = [
      rec({ round: 1, tools: ['rag_search'] }),
      rec({ round: 2, tools: ['grep_search'] }),
      rec({ round: 3, tools: ['rag_search', 'grep_search'] }), // 一轮可能多工具
      rec({ round: 4 }), // 无工具调用不计入
    ]
    const report = aggregate(records)
    const rag = report.toolUsage.find((u) => u.tool === 'rag_search')!
    const grep = report.toolUsage.find((u) => u.tool === 'grep_search')!
    expect(rag.calls).toBe(2)
    expect(grep.calls).toBe(2)
    // 渲染含工具统计行
    expect(renderMarkdown(report)).toContain('工具调用：')
  })

  it('当前与历史事实工具均按原名统计，不误判为 RAG', () => {
    const report = aggregate([
      rec({ tools: ['facts_search'] }),
      rec({ tools: ['lookup'] }),
      rec({ tools: ['query_operators'] }),
      rec({ tools: ['rag_search'] }),
    ])
    expect(report.toolUsage).toEqual(expect.arrayContaining([
      { tool: 'facts_search', calls: 1 },
      { tool: 'lookup', calls: 1 },
      { tool: 'query_operators', calls: 1 },
    ]))
    expect(report.toolUsage).toEqual(expect.arrayContaining([{ tool: 'rag_search', calls: 1 }]))
  })

  it('read_section 计入工具调用统计，但不进入搜索命中口径', () => {
    const report = aggregate([
      rec({
        tools: ['read_section'],
        toolBatch: {
          requested: 1,
          granted: 1,
          executed: 1,
          denied: 0,
          errors: 0,
          hitCount: 0,
          hitUnknown: 0,
          budgetBefore: 5,
          budgetAfter: 4,
          resultChars: 120,
        },
      }),
    ])
    expect(report.toolUsage).toEqual(expect.arrayContaining([{ tool: 'read_section', calls: 1 }]))
    expect(report.toolStats).toMatchObject({ executed: 1, hitCount: 0, hitUnknown: 0 })
  })

  it('Markdown 渲染含表头与总数', () => {
    const report = aggregate([rec({})])
    const md = renderMarkdown(report)
    expect(md).toContain('LLM 查询输出成本基准报告')
    expect(md).toContain('| 档位 |')
    expect(md).toContain('| 查询 ID |')
  })
})
