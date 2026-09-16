import { describe, expect, it } from 'vitest'
import { aggregate, renderCsv, renderMarkdown } from '../src/report.js'
import type { ReadDeliveryRecord } from '../src/delivery.js'
import type { CostRecord } from '../src/types.js'

/** 构造 read 台账：默认一条只送达正文的成功页，可按用例覆盖计数。 */
function readDeliveryRecord(input: {
  callId?: string
  status?: string
  bodyChars?: number
  deliveredCards?: number
  deliveredConcepts?: number
}): ReadDeliveryRecord {
  const bodyChars = input.bodyChars ?? 0
  const deliveredCards = input.deliveredCards ?? 0
  const deliveredConcepts = input.deliveredConcepts ?? 0
  const deliveredObjects: ReadDeliveryRecord['deliveredObjects'] = [
    ...Array.from({ length: deliveredCards }, () => ({ kind: 'card' as const, canonical: '干员甲', projection: 'full' as const, grantIds: [], origins: [] })),
    ...Array.from({ length: deliveredConcepts }, () => ({
      kind: 'concept' as const, file: 'guides/类别.md', headingPath: ['甲'], occurrence: 1, startLine: 1, endLine: 1, origins: [],
    })),
  ]
  return {
    callId: input.callId ?? 'read-1',
    status: input.status ?? 'success',
    sectionId: 'sec-0000000000000000',
    factsResultVersion: 8,
    bodyRange: bodyChars > 0
      ? { file: 'base/甲.md', sectionId: 'sec-0000000000000000', offset: 0, endOffset: bodyChars, docOffset: 0, docEndOffset: bodyChars, startLine: 1, endLine: 1, complete: true }
      : null,
    factsPage: { offset: 0, nextOffset: null, total: deliveredObjects.length, returned: deliveredObjects.length, complete: true },
    deliveredObjects,
    resultChars: 200,
  }
}

/** 运行级观测声明：只有明确下发 read 的运行，才把「没有 read 调用」记成 0（历史运行保持不可用）。 */
const READ_RUN = { toolNames: ['rag_search', 'facts_search', 'read'] }

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
    expect(renderMarkdown(report)).toContain('获准尝试 不可用｜证据送达（成功） 不可用')
  })

  it('拒绝标签注明预算耗尽与同批超量两类，不拆分分类计数', () => {
    const report = aggregate([rec({
      toolBatch: { requested: 3, granted: 1, executed: 1, denied: 2, errors: 0, attempts: 1, successes: 1, budgetBefore: 5, budgetAfter: 4, resultChars: 40 },
    })])
    expect(report.toolStats.denied).toBe(2)
    expect(renderMarkdown(report)).toContain('拒绝（预算/同批超量拒绝） 2')
  })

  it('新批次聚合获准尝试与非空成功数，缺失时保持不可用', () => {
    const withNewStats = aggregate([
      rec({ toolBatch: { requested: 3, granted: 2, executed: 2, denied: 1, errors: 0, attempts: 2, successes: 1, budgetBefore: 5, budgetAfter: 4, resultChars: 90 } }),
      rec({ round: 2, toolBatch: { requested: 2, granted: 2, executed: 2, denied: 0, errors: 0, attempts: 2, successes: 1, budgetBefore: 4, budgetAfter: 3, resultChars: 60 } }),
    ])
    expect(withNewStats.toolStats).toMatchObject({ attempts: 4, successes: 2 })
    expect(renderMarkdown(withNewStats)).toContain('获准尝试 4｜证据送达（成功） 2')

    const mixed = aggregate([
      rec({ toolBatch: { requested: 1, granted: 1, executed: 1, denied: 0, errors: 0, attempts: 1, successes: 1, budgetBefore: 5, budgetAfter: 4, resultChars: 10 } }),
      rec({ round: 2, toolBatch: { requested: 1, granted: 1, executed: 1, denied: 0, errors: 0, budgetBefore: 4, budgetAfter: 3, resultChars: 10 } }),
    ])
    expect(mixed.toolStats).toMatchObject({ attempts: null, successes: null })
  })

  it('历史记录有工具调用但缺整个 toolBatch 时尝试与成功数不可用', () => {
    const report = aggregate([rec({ tools: ['grep_search'] })])
    expect(report.toolStats).toMatchObject({ batches: 0, attempts: null, successes: null })
    expect(renderMarkdown(report)).toContain('获准尝试 不可用｜证据送达（成功） 不可用')
  })

  it('完全无工具调用的运行尝试与成功数为 0 而非不可用', () => {
    const report = aggregate([rec({})])
    expect(report.toolStats).toMatchObject({ batches: 0, attempts: 0, successes: 0 })
    expect(renderMarkdown(report)).toContain('获准尝试 0｜证据送达（成功） 0')
  })

  it('内部附带按查询、调用与去重卡次分别聚合，历史和异常观测不补零', () => {
    const fact = { term: '测试', start: 0, end: 2, matched: ['甲'], delivered: ['甲'], omittedReason: null, chars: 20, elapsedMs: 0, paths: [] }
    const current = rec({ tools: ['rag_search'], ragDelivery: [{ callId: 'a', status: 'success', fulltextRanges: [], attachedFacts: [fact, { ...fact, term: '别名' }] }] })
    expect(aggregate([current, { ...current, round: 2 }]).ragDeliveryStats).toEqual({
      internalFactsQueries: 4, attachedCalls: 2, omittedTerms: 0, deliveredCards: 2, expandedRanges: 0, linkedHints: null,
    })
    // 关联事实入口提示按「实际写入正文」计数；历史缺 linkedEntries 观测时判不可用，不补零。
    const linked = rec({
      tools: ['rag_search'],
      ragDelivery: [{
        callId: 'a', status: 'success', fulltextRanges: [], linkedEntries: [
          { sectionId: 'sec-1', file: 'base/甲.md', objectCount: 2, written: true },
          { sectionId: 'sec-2', file: 'base/甲.md', objectCount: 3, written: false },
        ],
      }],
    })
    expect(aggregate([linked]).ragDeliveryStats.linkedHints).toBe(1)
    expect(aggregate([current, rec({ tools: ['rag_search'] })]).ragDeliveryStats.internalFactsQueries).toBeNull()
    expect(aggregate([rec({ tools: ['rag_search'], ragDelivery: [{ callId: 'a', status: 'error' }] })]).ragDeliveryStats.internalFactsQueries).toBeNull()
    const omitted = { ...fact, delivered: [], omittedReason: '容量不足' }
    expect(aggregate([rec({ tools: ['rag_search'], ragDelivery: [{ callId: 'a', status: 'empty', fulltextRanges: [], attachedFacts: [omitted] }] })]).ragDeliveryStats).toMatchObject({ internalFactsQueries: 1, attachedCalls: 0, omittedTerms: 1, deliveredCards: 0 })
  })

  it('同批超量拒绝的 rag_search 请求不计入 RAG 台账完整性判据', () => {
    const fact = { term: '测试', start: 0, end: 2, matched: ['甲'], delivered: ['甲'], omittedReason: null, chars: 20, elapsedMs: 0, paths: [] }
    // 首项送达一张卡、第二项同批超量拒绝：ragDelivery 仅含已准入的首项，不应判整轮不可用。
    const mixed = rec({
      tools: ['rag_search', 'rag_search'],
      ragDelivery: [{ callId: 'a', status: 'success', fulltextRanges: [], attachedFacts: [fact] }],
    })
    expect(aggregate([mixed]).ragDeliveryStats).toEqual({
      internalFactsQueries: 1, attachedCalls: 1, omittedTerms: 0, deliveredCards: 1, expandedRanges: 0, linkedHints: null,
    })
    // 请求过 rag_search 却缺整套台账（历史/异常）仍判不可用，不伪造成零送达。
    expect(aggregate([rec({ tools: ['rag_search'] })]).ragDeliveryStats).toEqual({
      internalFactsQueries: null, attachedCalls: null, omittedTerms: null, deliveredCards: null, expandedRanges: null, linkedHints: null,
    })
  })

  it('仅 facts 送达的 rag_search 计入证据送达，但不计入旧 chunk 命中口径', () => {
    // facts-only 成功：hitIds 为空（hitCount 0），但 status=success（successes 1）。
    const report = aggregate([
      rec({ toolBatch: { requested: 1, granted: 1, executed: 1, denied: 0, errors: 0, attempts: 1, successes: 1, hitCount: 0, hitUnknown: 0, budgetBefore: 5, budgetAfter: 4, resultChars: 30 } }),
    ])
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('证据送达（成功） 1')
    expect(markdown).toContain('有命中（旧 chunk 口径，不含 facts-only 送达） 0')
  })

  it('部分 usage 仍汇总已知费用，并把重试未知用量标为不完整而非无用量', () => {
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
    // 该记录仍保留已知小计，属部分用量，不得计入「完全无用量」。
    expect(report.unknownUsageCalls).toBe(0)
    expect(report.costComplete).toBe(false)
    expect(renderMarkdown(report)).toContain('费用状态：不完整｜用量不完整调用：1（其中完全无用量：0）')
    expect(renderCsv(report)).toContain('costComplete')
    expect(renderCsv(report)).toContain('false')
  })

  it('整次调用无任何可用 usage 时计入完全无用量', () => {
    const report = aggregate([rec({
      input: null,
      output: null,
      knownInput: null,
      knownOutput: null,
      costIn: null,
      costOut: null,
      costTotal: null,
      usageCompleteness: 'unknown',
    })])

    expect(report.incompleteUsageCalls).toBe(1)
    expect(report.unknownUsageCalls).toBe(1)
    expect(report.costComplete).toBe(false)
    expect(renderMarkdown(report)).toContain('费用状态：不完整｜用量不完整调用：1（其中完全无用量：1）')
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

  it('read 计入工具调用统计，但不进入搜索命中口径', () => {
    const report = aggregate([
      rec({
        tools: ['read'],
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
        readDelivery: [readDeliveryRecord({ status: 'success' })],
      }),
    ], [], READ_RUN)
    expect(report.toolUsage).toEqual(expect.arrayContaining([{ tool: 'read', calls: 1 }]))
    expect(report.toolStats).toMatchObject({ executed: 1, hitCount: 0, hitUnknown: 0 })
    expect(renderMarkdown(report)).toContain('read 送达：调用 1')
  })

  it('readDeliveryStats 从台账重算，提示与实际证据分开；旧 read_section 运行与未声明支持新观测的运行都不补零', () => {
    const report = aggregate([
      rec({
        tools: ['read'],
        readDelivery: [readDeliveryRecord({ status: 'success', bodyChars: 100, deliveredCards: 2, deliveredConcepts: 1 })],
      }),
      rec({ round: 2, tools: ['read'], readDelivery: [readDeliveryRecord({ callId: 'read-2', status: 'empty' })] }),
      rec({ round: 3, tools: ['read'], readDelivery: [readDeliveryRecord({ callId: 'read-3', status: 'error' })] }),
    ], [], READ_RUN)
    expect(report.readDeliveryStats).toEqual({
      calls: 3,
      successes: 1,
      empty: 1,
      errors: 1,
      bodyChars: 100,
      deliveredCards: 2,
      deliveredConcepts: 1,
    })

    // 同批超量拒绝的 read 不产生台账条目：首项是 rag_search 时整体仍为已观察的 0。
    const rejectedSameBatch = aggregate([
      rec({ tools: ['rag_search', 'read'], readDelivery: [] }),
    ], [], READ_RUN)
    expect(rejectedSameBatch.readDeliveryStats).toMatchObject({ calls: 0, successes: 0, empty: 0, errors: 0, bodyChars: 0, deliveredCards: 0, deliveredConcepts: 0 })

    // 历史运行使用 read_section，新观测未覆盖：保持不可用，不写成 0。
    const legacy = aggregate([rec({ tools: ['read_section'] })], [], { toolNames: ['rag_search', 'read_section'] })
    expect(legacy.readDeliveryStats.calls).toBeNull()

    // 请求过 read 却缺台账同样不可用。
    const missing = aggregate([rec({ tools: ['read'] })], [], READ_RUN)
    expect(missing.readDeliveryStats.calls).toBeNull()

    // 明确下发 read 且没有任何 read 调用时记 0，不把未调用与未观测混同。
    const none = aggregate([rec({ tools: ['rag_search'] })], [], READ_RUN)
    expect(none.readDeliveryStats).toMatchObject({ calls: 0, successes: 0, empty: 0, errors: 0, bodyChars: 0, deliveredCards: 0, deliveredConcepts: 0 })
  })

  it('无法证明下发过 read 的运行（无声明）即使没有 read 调用也不记 0', () => {
    // 正式旧快照（toolSchemaVersion 12、只下发 read_section）与无 meta 的裸 records 都无法证明支持新观测。
    const undeclared = aggregate([rec({ tools: ['rag_search'] })])
    expect(undeclared.readDeliveryStats).toEqual({
      calls: null, successes: null, empty: null, errors: null, bodyChars: null, deliveredCards: null, deliveredConcepts: null,
    })
    expect(renderMarkdown(undeclared)).toContain('read 送达：调用 不可用')
  })

  it('read 台账条目数与实际准入的调用不一致时整体不可用，不按残缺台账出数', () => {
    // 请求了 read（首项即被准入）却留下空台账：覆盖不完整。
    const shortLedger = aggregate([rec({ tools: ['read'], readDelivery: [] })], [], READ_RUN)
    expect(shortLedger.readDeliveryStats.calls).toBeNull()

    // 未请求 read 却出现台账条目：记录自相矛盾。
    const extraLedger = aggregate([
      rec({ tools: ['rag_search'], readDelivery: [readDeliveryRecord({ status: 'success' })] }),
    ], [], READ_RUN)
    expect(extraLedger.readDeliveryStats.calls).toBeNull()

    // 首项 read 的第二步 read 属同批超量拒绝：只应有一条台账，合计 1 次调用。
    const sameBatchSecond = aggregate([
      rec({ tools: ['read', 'read'], readDelivery: [readDeliveryRecord({ status: 'success', bodyChars: 10 })] }),
    ], [], READ_RUN)
    expect(sameBatchSecond.readDeliveryStats).toMatchObject({ calls: 1, successes: 1, bodyChars: 10 })
  })

  it('readDeliveryStats 的字段不完整时整体不可用，不把缺失观测记成零送达', () => {
    const partial = {
      callId: 'read-2',
      status: 'error',
      sectionId: null,
      factsResultVersion: 8,
      resultChars: 40,
    } as ReadDeliveryRecord
    const report = aggregate([
      rec({
        tools: ['read'],
        readDelivery: [readDeliveryRecord({ status: 'success', bodyChars: 100, deliveredCards: 2 })],
      }),
      rec({ round: 2, tools: ['read'], readDelivery: [partial] }),
    ], [], READ_RUN)

    // 调用次数与状态口径仍可用；缺实际范围的这页只影响对应字段。
    expect(report.readDeliveryStats).toMatchObject({
      calls: 2,
      successes: 1,
      errors: 1,
      bodyChars: null,
      deliveredCards: null,
      deliveredConcepts: null,
    })

    const withObjects = aggregate([
      rec({
        tools: ['read'],
        readDelivery: [{ ...readDeliveryRecord({ status: 'success', bodyChars: 0, deliveredCards: 1 }), bodyRange: undefined }],
      }),
    ], [], READ_RUN)
    expect(withObjects.readDeliveryStats).toMatchObject({ bodyChars: null, deliveredCards: 1, deliveredConcepts: 0 })
  })

  it('预算拒绝的 read 台账计入调用但没有实际范围', () => {
    const report = aggregate([
      rec({
        tools: ['read'],
        readDelivery: [{
          callId: 'read-1',
          status: 'budget_exhausted',
          sectionId: null,
          factsResultVersion: 8,
          resultChars: 30,
        }],
      }),
    ], [], READ_RUN)

    expect(report.readDeliveryStats).toMatchObject({ calls: 1, successes: 0, empty: 0, errors: 1, bodyChars: null, deliveredCards: null })
  })

  it('Markdown 渲染含表头与总数', () => {
    const report = aggregate([rec({})])
    const md = renderMarkdown(report)
    expect(md).toContain('LLM 查询输出成本基准报告')
    expect(md).toContain('| 档位 |')
    expect(md).toContain('| 查询 ID |')
  })
})
