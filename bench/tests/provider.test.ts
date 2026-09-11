import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { aggregateAttemptCosts } from '../src/pricing.js'
import { buildChatBody, callLLM, type ChatMessage, type ProviderCallLedger, type ProviderOptions } from '../src/provider.js'

const messages: ChatMessage[] = [{ role: 'user', content: '测试' }]
const tools: unknown[] = [{ type: 'function', function: { name: 'rag_search' } }]

function opts(provider: 'hy3' | 'qwen' | 'glm' | 'deepseek', thinking: 'off' | 'low' | 'high'): ProviderOptions {
  return { config: loadConfig(provider), thinking, dry: true }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('provider：请求体参数映射', () => {
  it('DeepSeek 使用指定型号及显式 off，拒绝未支持的思考历史模式', () => {
    const body = buildChatBody(messages, tools, opts('deepseek', 'off'))
    expect(body).toMatchObject({ model: 'deepseek-v4-flash-vision-exp', thinking: { type: 'disabled' }, max_tokens: 4096 })
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('temperature')
    expect(() => buildChatBody(messages, tools, opts('deepseek', 'low'))).toThrow('仅支持显式 off')
  })
  it('GLM 显式 low 且拒绝 off，不静默回退', () => {
    expect(buildChatBody(messages, tools, opts('glm', 'low'))).toMatchObject({
      model: 'glm-5.3-flash', thinking: { type: 'enabled' }, reasoning_effort: 'low',
    })
    expect(() => buildChatBody(messages, tools, opts('glm', 'off'))).toThrow('不支持关闭思考')
  })
  it('hy3 off 显式关闭，其余传 reasoning_effort + thinking.enabled', () => {
    expect(buildChatBody(messages, tools, opts('hy3', 'off'))).not.toHaveProperty('reasoning_effort')
    expect(buildChatBody(messages, tools, opts('hy3', 'off')).thinking).toEqual({ type: 'disabled' })

    const low = buildChatBody(messages, tools, opts('hy3', 'low'))
    expect(low.reasoning_effort).toBe('low')
    expect(low.thinking).toEqual({ type: 'enabled' })

    const high = buildChatBody(messages, tools, opts('hy3', 'high'))
    expect(high.reasoning_effort).toBe('high')
  })

  it('qwen off 显式 enable_thinking=false，low/high 为 true', () => {
    expect(buildChatBody(messages, tools, opts('qwen', 'off')).enable_thinking).toBe(false)
    expect(buildChatBody(messages, tools, opts('qwen', 'low')).enable_thinking).toBe(true)
    expect(buildChatBody(messages, tools, opts('qwen', 'high')).enable_thinking).toBe(true)
    // qwen 不使用 reasoning_effort
    expect(buildChatBody(messages, tools, opts('qwen', 'low'))).not.toHaveProperty('reasoning_effort')
  })

  it('显式 temperature 时写入请求体，未设置时保持服务端默认行为', () => {
    const config = loadConfig('qwen')
    const base = { config, thinking: 'off' as const, dry: true }
    expect(buildChatBody(messages, tools, base)).not.toHaveProperty('temperature')

    config.temperature = 0.2
    expect(buildChatBody(messages, tools, base).temperature).toBe(0.2)
  })

  it('model 按 provider 取值', () => {
    expect(buildChatBody(messages, tools, opts('hy3', 'off')).model).toBe('hy3')
    expect(buildChatBody(messages, tools, opts('qwen', 'off')).model).toBe('qwen3.7-flash')
  })

  it('Qwen 显式开启并行工具调用，Hy3 不套用未实测参数', () => {
    expect(buildChatBody(messages, tools, opts('qwen', 'off')).parallel_tool_calls).toBe(true)
    expect(buildChatBody(messages, tools, opts('hy3', 'off'))).not.toHaveProperty('parallel_tool_calls')
  })

  it.each([
    ['bm25', 'rag_search', '占位查询'],
    ['hybrid', 'rag_search', '发电站 充能机制'],
  ] as const)('dry %s 使用独立函数工具与扁平参数', async (retriever, operation, query) => {
    const config = loadConfig('qwen')
    config.retriever = retriever
    const result = await callLLM(messages, [], { config, thinking: 'off', dry: true })
    expect(result.toolCalls[0]).toMatchObject({ name: operation })
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toMatchObject({ query })
  })

  it('响应头已返回但正文挂起时，取消仍传播到真实请求信号并拒绝读取', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    const session = new AbortController()
    const ledger: ProviderCallLedger = { attempts: [] }
    let requestSignal: AbortSignal | undefined
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Response(new ReadableStream<Uint8Array>({
        start(next) {
          controller = next
          init?.signal?.addEventListener('abort', () => next.error(init.signal?.reason), { once: true })
        },
      }))
    }))

    const pending = callLLM(messages, [], { config, thinking: 'off', dry: false, signal: session.signal, ledger })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ledger.usage).toMatchObject({ cached: null, reasoning: null })
    session.abort(new Error('测试取消'))
    const outcome = await Promise.race([
      pending.then(() => 'resolved', () => 'rejected'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
    ])
    expect(outcome).toBe('rejected')
    expect(requestSignal?.aborted).toBe(true)
    if (outcome === 'pending') controller?.error(new Error('测试结束'))
    await expect(pending).rejects.toMatchObject({
      usage: { cached: null, reasoning: null, completeness: 'unknown' },
      httpAttempts: [{ outcome: 'aborted', usage: { cached: null, reasoning: null } }],
    })
    expect(ledger.usage).toMatchObject({ cached: null, reasoning: null })
  })

  it('DeepSeek 缺失缓存分项经响应与台账传递后总费用仍未知', async () => {
    const config = loadConfig('deepseek')
    config.apiKey = 'test-key'
    const ledger: ProviderCallLedger = { attempts: [] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      model: config.model,
      choices: [{ message: { content: '答案' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }), { status: 200 })))

    const result = await callLLM(messages, [], { config, thinking: 'off', dry: false, ledger })
    expect(result.usage).toMatchObject({ cached: null, completeness: 'partial' })
    expect(ledger.usage).toMatchObject({ cached: null, completeness: 'partial' })
    expect(result.httpAttempts).toMatchObject([{ usage: { cached: null, completeness: 'partial' } }])
    expect(aggregateAttemptCosts(ledger.attempts.map(attempt => attempt.usage), config.prices).costTotal).toBeNull()
  })

  it('协议结构错误仍携带已观察 usage 和 HTTP 尝试台账', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 123, completion_tokens: 45 },
    }), { status: 200 })))

    await expect(callLLM(messages, [], { config, thinking: 'off', dry: false })).rejects.toMatchObject({
      usage: { input: 123, output: 45, completeness: 'complete' },
      httpAttempts: [{ attempt: 1, status: 200, outcome: 'accepted' }],
    })
  })

  it('HTTP 重试保留每次尝试及首次未知用量状态', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '暂时不可用' }), { status: 503, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: 'offline',
        choices: [{ message: { content: '答案' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }), { status: 200 })))

    const result = await callLLM(messages, [], { config, thinking: 'off', dry: false })
    expect(result.httpAttempts).toMatchObject([
      { attempt: 1, status: 503, outcome: 'retry', usage: { completeness: 'unknown' } },
      { attempt: 2, status: 200, outcome: 'accepted', usage: { input: 10, output: 2 } },
    ])
  })

  it('HTTP 重试的共享台账保留各次已知 usage', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    const ledger: ProviderCallLedger = { attempts: [] }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '暂时不可用', usage: { prompt_tokens: 123, completion_tokens: 45 } }), { status: 503, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: 'offline',
        choices: [{ message: { content: '答案' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }), { status: 200 })))

    const result = await callLLM(messages, [], { config, thinking: 'off', dry: false, ledger })

    expect(ledger.attempts).toHaveLength(2)
    expect(ledger.usage).toMatchObject({ input: 223, output: 55, completeness: 'complete' })
    expect(result.usage).toMatchObject({ input: 100, output: 10 })
  })

  it('退避期间取消时 provider 错误保留已有 usage 而不虚增 HTTP 尝试', async () => {
    const config = loadConfig('qwen')
    config.apiKey = 'test-key'
    const session = new AbortController()
    const ledger: ProviderCallLedger = { attempts: [] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: '暂时不可用',
      usage: { prompt_tokens: 123, completion_tokens: 45 },
    }), { status: 503, headers: { 'retry-after': '1' } })))

    const pending = callLLM(messages, [], { config, thinking: 'off', dry: false, signal: session.signal, ledger })
    await new Promise((resolve) => setTimeout(resolve, 0))
    session.abort(new Error('测试取消'))

    await expect(pending).rejects.toMatchObject({
      usage: { input: 123, output: 45, completeness: 'complete' },
      httpAttempts: [{ attempt: 1, status: 503, outcome: 'retry' }],
    })
    expect(ledger.attempts).toHaveLength(1)
  })
})
