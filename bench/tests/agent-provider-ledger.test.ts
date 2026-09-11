import { afterEach, describe, expect, it, vi } from 'vitest'
import { runQuery } from '../src/agent.js'
import { loadConfig } from '../src/config.js'
import { aggregate } from '../src/report.js'
import { buildIndex } from '../src/retriever.js'
import { createQueryTrace } from '../src/trace.js'

const query = { id: 'LEDGER-1', category: 'fact' as const, question: '取消台账' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runQuery：provider 台账与整题取消', () => {
  it('成功响应前的已知重试 usage 计入单次模型记录且不重复', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    config.retriever = 'hybrid'
    config.feedbackOnNoToolAnswer = false
    config.sessionTimeoutMs = 500
    let requests = 0
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(async () => {
        requests++
        return new Response(JSON.stringify({
        error: '暂时不可用',
        usage: { prompt_tokens: 123, completion_tokens: 45 },
        }), { status: 503, headers: { 'retry-after': '0' } })
      })
      .mockImplementationOnce(async () => {
        requests++
        return new Response(JSON.stringify({
        model: 'offline',
        choices: [{ message: { content: '完成' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
        }), { status: 200 })
      }))

    const result = await runQuery(query, { config, thinking: 'off', dry: false }, [], buildIndex([]))
    const report = aggregate(result.records)

    expect(requests).toBe(2)
    expect(result.finalAnswer).toBe('完成')
    expect(result.records[0]).toMatchObject({ input: 223, output: 55, costTotal: 0.000089, usageAggregation: 'http_attempts' })
    expect(report.totalInput).toBe(223)
    expect(report.totalOutput).toBe(55)
    expect(report.totalCost).toBe(0.000089)
    expect(report.costComplete).toBe(true)
  })

  it('退避等待超时时保留已发生的 HTTP 尝试、usage 和费用', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    config.retriever = 'hybrid'
    config.feedbackOnNoToolAnswer = false
    config.sessionTimeoutMs = 30
    let requests = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests++
      return new Response(JSON.stringify({
        error: '暂时不可用',
        usage: { prompt_tokens: 123, completion_tokens: 45 },
      }), { status: 503, headers: { 'retry-after': '1' } })
    }))

    const result = await runQuery(query, { config, thinking: 'off', dry: false }, [], buildIndex([]))
    const report = aggregate(result.records)

    expect(requests).toBe(1)
    expect(result.status).toBe('cancelled')
    expect(result.terminationReason).toBe('timeout')
    expect(result.modelSteps).toBe(1)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      input: 123,
      output: 45,
      usageCompleteness: 'complete',
      usageAggregation: 'http_attempts',
      httpAttempts: [{ attempt: 1, status: 503, outcome: 'retry' }],
    })
    expect(report.totalInput).toBe(123)
    expect(report.totalOutput).toBe(45)
    expect(report.totalHttpAttempts).toBe(1)
    expect(report.retryAttempts).toBe(1)
    expect(report.costComplete).toBe(true)
  })

  it('未知重试后保留已知 token 小计，trace 与报告不伪造 exact 总量', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    config.retriever = 'hybrid'
    config.feedbackOnNoToolAnswer = false
    let requests = 0
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(async () => {
        requests++
        return new Response(JSON.stringify({ error: '暂时不可用' }), { status: 503, headers: { 'retry-after': '0' } })
      })
      .mockImplementationOnce(async () => {
        requests++
        return new Response(JSON.stringify({
          model: 'offline',
          choices: [{ message: { content: '完成' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }), { status: 200 })
      }))
    const trace = createQueryTrace(query)

    const result = await runQuery(query, { config, thinking: 'off', dry: false, trace }, [], buildIndex([]))
    const report = aggregate(result.records)
    const usage = trace.events.find((event) => event.type === 'llm_call')?.usage

    expect(requests).toBe(2)
    expect(result.records[0]).toMatchObject({ input: null, output: null, knownInput: 100, knownOutput: 10, costTotal: null, usageCompleteness: 'partial' })
    expect(usage).toMatchObject({ input: null, output: null, knownInput: 100, knownOutput: 10, completeness: 'partial' })
    expect(report.totalInput).toBe(100)
    expect(report.totalOutput).toBe(10)
    expect(report.totalInputExact).toBeNull()
    expect(report.totalOutputExact).toBeNull()
    expect(report.totalCost).toBe(0.000028)
    expect(report.costComplete).toBe(false)
  })

  it('报告沿用本次记录的自定义价格，不重算为内置价格', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    config.retriever = 'hybrid'
    config.feedbackOnNoToolAnswer = false
    config.prices = { inPerM: 1, outPerM: 4, cachePerM: 0.25 }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      model: 'offline',
      choices: [{ message: { content: '完成' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    }), { status: 200 })))

    const result = await runQuery(query, { config, thinking: 'off', dry: false }, [], buildIndex([]))
    const report = aggregate(result.records)

    expect(result.records[0]?.costTotal).toBe(0.00014)
    expect(report.totalCost).toBe(0.00014)
    expect(report.costComplete).toBe(true)
  })

  it('响应正文读取被取消时保留 aborted 尝试且不启动重试', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    config.retriever = 'hybrid'
    config.feedbackOnNoToolAnswer = false
    config.sessionTimeoutMs = 30
    let requests = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests++
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true })
        },
      }), { status: 200 })
    }))

    const result = await runQuery(query, { config, thinking: 'off', dry: false }, [], buildIndex([]))

    expect(requests).toBe(1)
    expect(result.status).toBe('cancelled')
    expect(result.terminationReason).toBe('timeout')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.httpAttempts).toMatchObject([
      { attempt: 1, status: 200, outcome: 'aborted', usage: { completeness: 'unknown' } },
    ])
    expect(result.records[0]?.usageCompleteness).toBe('unknown')
  })

  it('fetch 尚未结算时取消也登记 in-flight 尝试，并冻结迟到拒绝前的快照', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    config.retriever = 'hybrid'
    config.feedbackOnNoToolAnswer = false
    config.sessionTimeoutMs = 30
    let requests = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests++
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          setTimeout(() => reject(init?.signal?.reason), 120)
        }, { once: true })
      })
    }))

    const result = await runQuery(query, { config, thinking: 'off', dry: false }, [], buildIndex([]))
    const beforeRecords = JSON.stringify(result.records)
    const beforeReport = aggregate(result.records)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const afterReport = aggregate(result.records)

    expect(requests).toBe(1)
    expect(result.status).toBe('cancelled')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.httpAttempts).toMatchObject([
      { attempt: 1, status: null, outcome: 'aborted', usage: { completeness: 'unknown' } },
    ])
    expect(beforeRecords).toBe(JSON.stringify(result.records))
    expect(beforeReport.totalHttpAttempts).toBe(1)
    expect(afterReport).toEqual(beforeReport)
  })
})
