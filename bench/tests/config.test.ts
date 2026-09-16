import { describe, expect, it } from 'vitest'
import { effectiveAttachFacts, loadConfig, validateBenchConfig } from '../src/config.js'

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
  it('默认 provider 为 GLM-5.3-Flash', () => {
    const config = loadConfig()
    expect(config.provider).toBe('glm')
    expect(config.providerLabel).toBe('GLM-5.3-Flash')
  })
  it('默认每题 5 点成功额度、10 次获准尝试上限、5 分钟总超时、facts 词条上限 3 并开启未调用工具回馈', () => {
    const config = loadConfig()

    expect(config.toolBudget).toBe(5)
    expect(config.toolAttemptLimit).toBe(10)
    expect(config.sessionTimeoutMs).toBe(300_000)
    expect(config.feedbackOnNoToolAnswer).toBe(true)
    expect(config.factsQueryListLimit).toBe(3)
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
    ['toolAttemptLimit', { toolAttemptLimit: 0 }],
    ['toolAttemptLimit', { toolAttemptLimit: Number.NaN }],
    ['sessionTimeoutMs', { sessionTimeoutMs: 0 }],
    ['sessionTimeoutMs', { sessionTimeoutMs: Number.NaN }],
    ['factsQueryListLimit', { factsQueryListLimit: 0 }],
    ['factsQueryListLimit', { factsQueryListLimit: 1.5 }],
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

describe('配置：检索范围、原文扩展与 facts 附带（ADR-021）', () => {
  it('默认不携带已退役的技能表开关，按命中小节送达，hybrid 有效附带 facts', () => {
    const config = loadConfig()

    // 检索范围由 manifest 决定（仅 base/guides），运行配置不再持有 includeSkillTables（ADR-021）
    expect('includeSkillTables' in config).toBe(false)
    // 默认送达命中小节原文与阅读入口，不再按文件扩展整篇（ADR-022 决策 7、8）
    expect(config.expandFulltext).toBe(false)
    expect(config.attachFacts).toBeUndefined()
    expect(effectiveAttachFacts(config)).toBe(true)
  })

  it('默认不注入关键词目录，显式开启可作为回退', () => {
    expect(loadConfig().injectKeywordCatalog).toBe(false)
    expect({ ...loadConfig(), injectKeywordCatalog: true }.injectKeywordCatalog).toBe(true)
  })

  it('bm25 未显式附带时校验通过且有效附带为关', () => {
    const bm25 = { ...loadConfig(), retriever: 'bm25' as const }

    expect(effectiveAttachFacts(bm25)).toBe(false)
    expect(() => validateBenchConfig(bm25)).not.toThrow()
    expect(effectiveAttachFacts({ ...bm25, attachFacts: false })).toBe(false)
  })

  it('显式在 bm25 请求附带 facts 报中文参数错误', () => {
    const bm25 = { ...loadConfig(), retriever: 'bm25' as const, attachFacts: true }

    expect(() => validateBenchConfig(bm25)).toThrow('bm25 模式不支持 RAG 自动附带 facts')
  })
})
