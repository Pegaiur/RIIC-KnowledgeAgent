import { describe, expect, it } from 'vitest'
import { loadConfig, validateBenchConfig } from '../src/config.js'

describe('配置：工具预算与单题生命周期', () => {
  it('默认每题 5 点、5 分钟总超时并开启未调用工具回馈', () => {
    const config = loadConfig()

    expect(config.toolBudget).toBe(5)
    expect(config.sessionTimeoutMs).toBe(300_000)
    expect(config.feedbackOnNoToolAnswer).toBe(true)
  })

  it.each([
    ['toolBudget', { toolBudget: 0 }],
    ['toolBudget', { toolBudget: 1.5 }],
    ['sessionTimeoutMs', { sessionTimeoutMs: 0 }],
    ['sessionTimeoutMs', { sessionTimeoutMs: Number.NaN }],
  ] as const)('%s 非正整数或非有限值时拒绝配置', (_field, patch) => {
    const config = { ...loadConfig(), ...patch }

    expect(() => validateBenchConfig(config)).toThrow('必须是正整数')
  })

  it('有效的正整数配置通过校验', () => {
    const config = loadConfig()
    config.toolBudget = 2
    config.sessionTimeoutMs = 1_000

    expect(() => validateBenchConfig(config)).not.toThrow()
  })
})
