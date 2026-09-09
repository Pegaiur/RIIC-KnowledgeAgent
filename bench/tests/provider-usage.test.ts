import { describe, expect, it } from 'vitest'
import { parseUsage } from '../src/provider.js'

describe('provider：usage 完整性', () => {
  it('DeepSeek 必需缓存分项缺失或不一致时不判作完整用量', () => {
    const base = { prompt_tokens: 100, completion_tokens: 20 }
    for (const fields of [
      {},
      { prompt_tokens_details: { cached_tokens: 80 } },
      { prompt_cache_hit_tokens: 80 },
      { prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 10 },
      { prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20, prompt_tokens_details: { cached_tokens: null } },
    ]) {
      expect(parseUsage({ ...base, ...fields }, 'deepseek')).toMatchObject({ cached: null, completeness: 'partial' })
    }
    expect(parseUsage({ ...base, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 }, 'deepseek'))
      .toMatchObject({ cached: 80, completeness: 'complete' })
    expect(parseUsage({ ...base, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 }, 'deepseek'))
      .toMatchObject({ cached: 0, completeness: 'complete' })
    expect(parseUsage(base, 'qwen')).toMatchObject({ cached: 0, completeness: 'complete' })
    expect(parseUsage({})).toMatchObject({ cached: null, reasoning: null, completeness: 'unknown' })
  })
  it('DeepSeek 顶层缓存字段计入用量，不把缓存漏算为零', () => {
    expect(parseUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 })).toMatchObject({ input: 100, output: 20, cached: 80, reasoning: null, completeness: 'complete' })
    expect(parseUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: -1 })).toMatchObject({ cached: null, completeness: 'partial' })
    expect(parseUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: null }, prompt_cache_hit_tokens: 80 })).toMatchObject({ cached: null, completeness: 'partial' })
  })
  it('思考分项有显式值时保留，包括零', () => {
    expect(parseUsage({ prompt_tokens: 2, completion_tokens: 3,
      completion_tokens_details: { reasoning_tokens: 0 } }).reasoning).toBe(0)
    expect(parseUsage({ prompt_tokens: 2, completion_tokens: 3,
      completion_tokens_details: { reasoning_tokens: 2 } }).reasoning).toBe(2)
  })
  it('明确的零值是有效用量，缺省思考分项为未知但总用量有效', () => {
    expect(parseUsage({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({
      input: 0,
      output: 0,
      cached: 0,
      reasoning: null,
      completeness: 'complete',
    })
  })

  it('缺失必需字段时保留已知值并标记 partial', () => {
    expect(parseUsage({ prompt_tokens: 12 })).toEqual({
      input: 12,
      output: null,
      cached: 0,
      reasoning: null,
      completeness: 'partial',
    })
  })

  it('完全缺失或显式无效时不伪装成零费用', () => {
    expect(parseUsage(undefined)).toEqual({
      input: null,
      output: null,
      cached: null,
      reasoning: null,
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
      reasoning: null,
      completeness: 'partial',
    })
  })
})
