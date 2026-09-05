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
    expect(report.toolStats).toEqual({ batches: 1, requested: 3, granted: 2, executed: 2, denied: 1, errors: 0, resultChars: 120 })
    expect(renderMarkdown(report)).toContain('费用状态：不完整')
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
    expect(renderMarkdown(report)).toContain('检索工具调用：')
  })

  it('Markdown 渲染含表头与总数', () => {
    const report = aggregate([rec({})])
    const md = renderMarkdown(report)
    expect(md).toContain('LLM 查询输出成本基准报告')
    expect(md).toContain('| 档位 |')
    expect(md).toContain('| 查询 ID |')
  })
})
