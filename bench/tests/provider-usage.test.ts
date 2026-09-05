import { describe, expect, it } from 'vitest'
import { parseUsage } from '../src/provider.js'

describe('provider：usage 完整性', () => {
  it('明确的零值是有效用量，缺省的可选明细按契约为零', () => {
    expect(parseUsage({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({
      input: 0,
      output: 0,
      cached: 0,
      reasoning: 0,
      completeness: 'complete',
    })
  })

  it('缺失必需字段时保留已知值并标记 partial', () => {
    expect(parseUsage({ prompt_tokens: 12 })).toEqual({
      input: 12,
      output: null,
      cached: 0,
      reasoning: 0,
      completeness: 'partial',
    })
  })

  it('完全缺失或显式无效时不伪装成零费用', () => {
    expect(parseUsage(undefined)).toEqual({
      input: null,
      output: null,
      cached: 0,
      reasoning: 0,
      completeness: 'unknown',
    })
    expect(parseUsage({ prompt_tokens: -1, completion_tokens: 'bad' })).toMatchObject({
      input: null,
      output: null,
      completeness: 'partial',
    })
  })

  it('显式无效的可选明细保留未知状态，不覆盖为零', () => {
    expect(parseUsage({ prompt_tokens: 2, completion_tokens: 3, prompt_tokens_details: { cached_tokens: -1 } })).toEqual({
      input: 2,
      output: 3,
      cached: null,
      reasoning: 0,
      completeness: 'partial',
    })
  })
})
