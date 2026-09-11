import { describe, expect, it } from 'vitest'
import { loadConfig, validateBenchConfig } from '../src/config.js'

describe('配置：工具预算与单题生命周期', () => {
  it('DeepSeek 使用官方端点和精确实验型号', () => {
    const config = loadConfig('deepseek')
    expect(config.baseUrl).toBe('https://api.deepseek.com')
    expect(config.model).toBe('deepseek-v4-flash-vision-exp')
    expect(config.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
  })
  it('GLM 使用国内官方端点且未知 provider 不回退', () => {
    const config = loadConfig('glm')
    expect(config.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(config.model).toBe('glm-5.3-flash')
    expect(() => loadConfig('invalid' as 'glm')).toThrow('不支持的 provider')
  })
  it('默认每题 5 点、5 分钟总超时并开启未调用工具回馈', () => {
    const config = loadConfig()

    expect(config.toolBudget).toBe(5)
    expect(config.sessionTimeoutMs).toBe(300_000)
    expect(config.feedbackOnNoToolAnswer).toBe(true)
  })

  it('默认检索模式为 hybrid，显式 bm25 仍作为对照通过校验', () => {
    expect(loadConfig().retriever).toBe('hybrid')
    expect(() => validateBenchConfig({ ...loadConfig(), retriever: 'hybrid' })).not.toThrow()
    expect(() => validateBenchConfig({ ...loadConfig(), retriever: 'bm25' })).not.toThrow()
  })

  it.each(['grep', 'both', 'facts', 'unknown'])('已删除或未知的检索模式 %s 被校验拒绝', (value) => {
    expect(() => validateBenchConfig({ ...loadConfig(), retriever: value as 'hybrid' }))
      .toThrow('不支持的检索模式')
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
