import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { buildChatBody, type ChatMessage, type ProviderOptions } from '../src/provider.js'

const messages: ChatMessage[] = [{ role: 'user', content: '测试' }]
const tools: unknown[] = [{ type: 'function', function: { name: 'rag_search' } }]

function opts(provider: 'hy3' | 'qwen', thinking: 'off' | 'low' | 'high'): ProviderOptions {
  return { config: loadConfig(provider), thinking, dry: true }
}

describe('provider：请求体参数映射', () => {
  it('hy3 off 不传思考参数，其余传 reasoning_effort + thinking.enabled', () => {
    expect(buildChatBody(messages, tools, opts('hy3', 'off'))).not.toHaveProperty('reasoning_effort')
    expect(buildChatBody(messages, tools, opts('hy3', 'off'))).not.toHaveProperty('thinking')

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

  it('model 按 provider 取值', () => {
    expect(buildChatBody(messages, tools, opts('hy3', 'off')).model).toBe('hy3')
    expect(buildChatBody(messages, tools, opts('qwen', 'off')).model).toBe('qwen3.7-flash')
  })
})
