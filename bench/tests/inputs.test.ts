import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { EXPERIMENT, loadConfig } from '../src/config.js'
import { buildIndex } from '../src/retriever.js'
import { buildSectionDirectory } from '../src/sections.js'
import {
  captureJson,
  captureText,
  collectSourceMetadata,
  createRunInputs,
  hashCanonical,
  markFactsCaptured,
  markFactsLoadFailed,
  writeRunInputs,
} from '../src/inputs.js'
import { runBenchmark } from '../src/runner.js'
import type { ProviderResult } from '../src/types.js'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))
vi.mock('../src/provider.js', () => ({ callLLM: mockCall }))

function providerResult(partial: Partial<ProviderResult>): ProviderResult {
  return {
    content: '答案',
    toolCalls: [],
    usage: { input: 20, output: 5, cached: 0, reasoning: 0 },
    model: 'qwen3.7-flash',
    truncated: false,
    ...partial,
  }
}

describe('运行输入记录', () => {
  afterEach(() => {
    mockCall.mockReset()
    EXPERIMENT.tokenizer = 'bigram'
    EXPERIMENT.entityBoost = 0
  })

  it('首个模型调用前已经写入 inputs，且 prompt/schema 与实际调用一致', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'rag-inputs-run-'))
    try {
      const config = loadConfig('qwen')
      config.retriever = 'facts'
      config.feedbackOnNoToolAnswer = false
      config.apiKey = 'synthetic-secret'
      mockCall.mockImplementation(async (
        messages: Array<{ role: string; content: string }>,
        tools: unknown[],
        providerOptions: { config: { maxTokens: number; temperature?: number } },
      ) => {
        const runDirs = readdirSync(outDir)
        expect(runDirs).toHaveLength(1)
        const inputs = JSON.parse(readFileSync(join(outDir, runDirs[0]!, 'inputs.json'), 'utf-8')) as Record<string, any>
        expect(inputs.captureStatus).toBe('pending')
        expect(inputs.systemPrompt.text).toBe(messages[0]?.content)
        expect(inputs.toolSchema.definitions).toEqual(tools)
        expect(messages[0]?.role).toBe('system')
        expect(tools).toHaveLength(1)
        expect(providerOptions.config.maxTokens).toBe(4096)
        expect(providerOptions.config.temperature).toBeUndefined()
        return providerResult({ content: '完成' })
      })
      const output = await runBenchmark(
        [{ id: 'INPUT-1', category: 'fact', question: '普通问题' }],
        { thinking: 'off', dry: false, outDir, config },
      )

      const inputs = JSON.parse(readFileSync(output.inputsPath, 'utf-8')) as Record<string, any>
      expect(inputs.captureStatus).toBe('complete')
      expect(inputs.systemPrompt.text).toBe((mockCall.mock.calls[0]?.[0] as Array<{ role: string; content: string }>)[0]?.content)
      expect(inputs.toolSchema.definitions).toEqual(mockCall.mock.calls[0]?.[1])
      expect(inputs.config).toMatchObject({ maxTokens: 4096, temperature: null, retriever: 'facts' })
      expect(inputs.facts).toEqual({ status: 'not_used' })
      const meta = JSON.parse(readFileSync(output.metaPath, 'utf-8')) as Record<string, unknown>
      expect(meta).toMatchObject({ maxTokens: 4096, inputsSchemaVersion: 1 })
      expect(meta.inputsFileSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(meta.inputsFileSha256).toBe(requireHash(output.inputsPath))
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it('配置声明值与实际有效 tokenizer/entityBoost 分开记录', () => {
    const config = loadConfig()
    config.tokenizer = 'jieba'
    config.entityBoost = 1.5
    EXPERIMENT.tokenizer = 'bigram'
    EXPERIMENT.entityBoost = 0
    const inputs = createRunInputs({
      config,
      thinking: 'off',
      dry: true,
      agentInstructions: '规则',
      systemPrompt: '规则\n能力',
      toolSchema: { toolSchemaVersion: 5, toolSchemaSha256: 'a'.repeat(64), toolNames: ['rag_search'] },
      toolDefinitions: [{ name: 'rag_search' }],
      questions: [{ id: 'Q', category: 'fact', question: '问题' }],
      chunks: [],
      sourceAtStart: collectSourceMetadata(process.cwd(), () => ''),
    })
    expect(inputs.config).toMatchObject({ tokenizer: 'bigram', entityBoost: 0, declaredTokenizer: 'jieba', declaredEntityBoost: 1.5 })
  })

  it('可选小节指纹只在提供目录时写入，且与目录指纹一致', () => {
    const corpusDir = mkdtempSync(join(tmpdir(), 'rag-inputs-sections-'))
    try {
      mkdirSync(join(corpusDir, 'base'), { recursive: true })
      writeFileSync(join(corpusDir, 'base', 'a.md'), '# 总览\n\n## 制造站\n\n制造站正文。\n', 'utf-8')
      writeFileSync(join(corpusDir, 'corpus-manifest.json'), JSON.stringify({ files: ['base/a.md'] }), 'utf-8')
      const directory = buildSectionDirectory(corpusDir)
      const config = loadConfig()
      const base = {
        config,
        thinking: 'off' as const,
        dry: true,
        agentInstructions: '规则',
        systemPrompt: '规则',
        toolSchema: { toolSchemaVersion: 6, toolSchemaSha256: 'a'.repeat(64), toolNames: ['rag_search'] },
        toolDefinitions: [],
        questions: [],
        chunks: [],
        sourceAtStart: collectSourceMetadata(process.cwd(), () => ''),
      }
      expect(createRunInputs({ ...base, sections: directory }).sections).toEqual({
        version: 1,
        sectionCount: 2,
        sectionsSha256: directory.fingerprint(),
        orderPreserved: true,
      })
      writeFileSync(join(corpusDir, 'base', 'a.md'), '# 总览\n\n## 制造站\n\n制造站正文（改）。\n', 'utf-8')
      expect(buildSectionDirectory(corpusDir).fingerprint()).not.toBe(directory.fingerprint())
      expect(createRunInputs(base).sections).toBeUndefined()
    } finally {
      rmSync(corpusDir, { recursive: true, force: true })
    }
  })

  it('LF/CRLF 保持原字符串指纹，敏感正文脱敏但保留原始哈希', () => {
    const secret = 'sk-test-secret-1234'
    const lf = captureText(`规则\nAuthorization: Bearer ${secret}`, [secret])
    const crlf = captureText(`规则\r\nAuthorization: Bearer ${secret}`, [secret])
    expect(lf.text).not.toContain(secret)
    expect(lf.redacted).toBe(true)
    expect(lf.exactTextRecoverable).toBe(false)
    expect(lf.sha256).toBe(requireHashValue(`规则\nAuthorization: Bearer ${secret}`))
    expect(crlf.sha256).toBe(requireHashValue(`规则\r\nAuthorization: Bearer ${secret}`))
    expect(lf.sha256).not.toBe(crlf.sha256)
    const schema = captureJson([{ description: secret }], [secret])
    expect(JSON.stringify(schema.value)).not.toContain(secret)
    expect(schema.redacted).toBe(true)
  })

  it('密钥进入配置、问题或指令时不进入 inputs 正文', () => {
    const secret = 'sk-config-secret-9876'
    const config = loadConfig()
    config.apiKey = secret
    config.model = `model-${secret}`
    config.baseUrl = `https://example.invalid/${secret}`
    const inputs = createRunInputs({
      config,
      thinking: 'off',
      dry: true,
      agentInstructions: `规则 ${secret}`,
      systemPrompt: `问题前置 ${secret}`,
      toolSchema: { toolSchemaVersion: 5, toolSchemaSha256: 'a'.repeat(64), toolNames: ['rag_search'] },
      toolDefinitions: [{ description: secret }],
      questions: [{ id: 'Q', category: 'fact', question: `问题 ${secret}` }],
      chunks: [],
      sourceAtStart: collectSourceMetadata(process.cwd(), () => ''),
    })
    const serialized = JSON.stringify(inputs)
    expect(serialized).not.toContain(secret)
    expect(inputs.agentInstructions.redacted).toBe(true)
    expect(inputs.agentInstructions.exactTextRecoverable).toBe(false)
    expect(inputs.agentInstructions.sha256).toBe(requireHashValue(`规则 ${secret}`))
    expect(inputs.systemPrompt.redacted).toBe(true)
    expect(inputs.systemPrompt.exactTextRecoverable).toBe(false)
    expect(inputs.systemPrompt.sha256).toBe(requireHashValue(`问题前置 ${secret}`))
    expect(inputs.questions[0]?.questionRedacted).toBe(true)
    expect(inputs.questions[0]?.questionExactTextRecoverable).toBe(false)
    expect(inputs.questions[0]?.questionSha256).toBe(requireHashValue(`问题 ${secret}`))
    expect(inputs.toolSchema.redacted).toBe(true)
    expect(inputs.toolSchema.exactTextRecoverable).toBe(false)
    expect(inputs.toolSchema.sha256).toBe(hashCanonical([{ description: secret }]))
    expect(inputs.config.model).not.toContain(secret)
    expect(inputs.config.stringCaptures.model).toMatchObject({
      text: `model-[已脱敏]`,
      sha256: requireHashValue(`model-${secret}`),
      redacted: true,
      exactTextRecoverable: false,
    })
    expect(inputs.config.stringCaptures.baseUrl).toMatchObject({ redacted: true, exactTextRecoverable: false })
    expect(inputs.agentInstructions.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('chunk/card 数组顺序或内容变化都会改变指纹', () => {
    const chunks = [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }]
    expect(hashCanonical(chunks)).not.toBe(hashCanonical([...chunks].reverse()))
    expect(hashCanonical(chunks)).not.toBe(hashCanonical([{ id: 'a', text: '改' }, { id: 'b', text: '乙' }]))

    const config = loadConfig()
    const create = (items: typeof chunks) => createRunInputs({
      config,
      thinking: 'off',
      dry: true,
      agentInstructions: '规则',
      systemPrompt: '规则',
      toolSchema: { toolSchemaVersion: 5, toolSchemaSha256: 'a'.repeat(64), toolNames: ['rag_search'] },
      toolDefinitions: [],
      questions: [],
      chunks: items as any,
      sourceAtStart: collectSourceMetadata(process.cwd(), () => ''),
    })
    expect(create(chunks).rag.chunksSha256).toBe(hashCanonical(chunks))
    expect(create(chunks).rag.chunksSha256).not.toBe(create([...chunks].reverse()).rag.chunksSha256)

    const cardsA = [{ canonical: '甲' }, { canonical: '乙' }]
    const cardsB = [{ canonical: '丙' }, { canonical: '丁' }]
    const capturedA = create([])
    const capturedReversed = create([])
    const capturedB = create([])
    markFactsCaptured(capturedA, { cards: cardsA } as any)
    markFactsCaptured(capturedReversed, { cards: [...cardsA].reverse() } as any)
    markFactsCaptured(capturedB, { cards: cardsB } as any)
    expect(capturedA.facts.cardsSha256).toBe(hashCanonical(cardsA))
    expect(capturedA.facts.cardsSha256).not.toBe(capturedReversed.facts.cardsSha256)
    expect(capturedA.facts.cardsSha256).not.toBe(capturedB.facts.cardsSha256)
  })

  it('facts 未使用不主动初始化，使用后捕获卡指纹，失败不伪造指纹', () => {
    const config = loadConfig()
    const inputs = createRunInputs({
      config,
      thinking: 'off',
      dry: true,
      agentInstructions: '规则',
      systemPrompt: '规则',
      toolSchema: { toolSchemaVersion: 5, toolSchemaSha256: 'a'.repeat(64), toolNames: ['facts_search'] },
      toolDefinitions: [],
      questions: [{ id: 'Q', category: 'fact', question: '问题' }],
      chunks: [],
      sourceAtStart: collectSourceMetadata(process.cwd(), () => ''),
    })
    expect(inputs.facts).toEqual({ status: 'not_used' })
    const store = { cards: [{ canonical: '甲' }] } as any
    markFactsCaptured(inputs, store)
    expect(inputs.facts).toMatchObject({ status: 'captured', cardCount: 1, cardsSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    markFactsLoadFailed(inputs, new Error('加载失败'))
    expect(inputs.facts.status).toBe('captured')

    const failed = { ...inputs, facts: { status: 'not_used' as const } }
    const opaqueSecret = 'opaque-secret-1234'
    markFactsLoadFailed(failed, new Error(`加载失败 ${opaqueSecret}`), [opaqueSecret])
    expect(failed.facts).toMatchObject({ status: 'load_failed' })
    expect(failed.facts).not.toHaveProperty('cardsSha256')
    expect((failed.facts as { error?: string }).error).not.toContain(opaqueSecret)
  })

  it('RAG 不触发 facts 加载，facts 加载失败保留原错误且吞掉观测回调异常', async () => {
    vi.resetModules()
    const loadError = new Error('模拟 facts 加载失败')
    vi.doMock('../src/facts/final.js', () => ({
      loadValidatedRecordCards: () => { throw loadError },
    }))
    try {
      const { createKnowledgeToolExecutor } = await import('../src/tool-executor.js')
      const config = loadConfig()
      const used: unknown[] = []
      const failures: unknown[] = []
      const rag = createKnowledgeToolExecutor({
        config: { ...config, retriever: 'bm25' },
        query: { id: 'LAZY-RAG', category: 'fact', question: '检索' },
        chunks: [{ id: 'a', file: 'a.md', heading: 'a', text: '检索内容', startLine: 1, endLine: 1 }],
        index: buildIndex([{ id: 'a', file: 'a.md', heading: 'a', text: '检索内容', startLine: 1, endLine: 1 }]),
        onFactsStoreUsed: (store) => used.push(store),
        onFactsStoreLoadFailed: (error) => failures.push(error),
      }, 1)
      const ragResult = await rag.executeBatch([{ id: 'rag', name: 'rag_search', arguments: JSON.stringify({ query: '检索' }) }])
      expect(ragResult.results[0]).toMatchObject({ status: 'success', executed: true })
      expect(used).toHaveLength(0)
      expect(failures).toHaveLength(0)

      const facts = createKnowledgeToolExecutor({
        config: { ...config, retriever: 'facts' },
        query: { id: 'LAZY-FACTS', category: 'fact', question: '事实' },
        chunks: [],
        index: buildIndex([]),
        onFactsStoreUsed: () => { throw new Error('成功观测不应触发') },
        onFactsStoreLoadFailed: (error) => { failures.push(error); throw new Error('失败观测异常') },
      }, 1)
      const factsResult = await facts.executeBatch([{ id: 'facts', name: 'facts_search', arguments: JSON.stringify({ query: '刻俄柏' }) }])
      expect(factsResult.results[0]).toMatchObject({ status: 'error', executed: true, message: loadError.message, actualParams: { query: '刻俄柏' } })
      expect(failures).toHaveLength(1)
      expect(failures[0]).toBe(loadError)
    } finally {
      vi.doUnmock('../src/facts/final.js')
    }
  })

  it('runner 将 facts 加载失败状态写入 inputs，且不落盘已知密钥或伪造卡片指纹', async () => {
    vi.resetModules()
    const loadError = new Error('加载失败 opaque-runner-secret')
    vi.doMock('../src/facts/final.js', () => ({
      loadValidatedRecordCards: () => { throw loadError },
    }))
    vi.doMock('../src/provider.js', () => ({ callLLM: mockCall }))
    const outDir = mkdtempSync(join(tmpdir(), 'rag-inputs-failure-'))
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const { runBenchmark: isolatedRunBenchmark } = await import('../src/runner.js')
      const config = loadConfig()
      config.retriever = 'facts'
      config.feedbackOnNoToolAnswer = false
      config.apiKey = 'opaque-runner-secret'
      mockCall
        .mockResolvedValueOnce(providerResult({ content: null, toolCalls: [{ id: 'facts-1', name: 'facts_search', arguments: JSON.stringify({ query: '刻俄柏' }) }] }))
        .mockResolvedValueOnce(providerResult({ content: '结束' }))
      const output = await isolatedRunBenchmark(
        [{ id: 'INPUT-FAILURE', category: 'fact', question: '事实' }],
        { thinking: 'off', dry: false, outDir, config },
      )
      const inputs = JSON.parse(readFileSync(output.inputsPath, 'utf-8')) as Record<string, any>
      expect(inputs.facts).toMatchObject({ status: 'load_failed', error: expect.stringContaining('加载失败') })
      expect(inputs.facts).not.toHaveProperty('cardsSha256')
      expect(JSON.stringify(inputs)).not.toContain('opaque-runner-secret')
      expect(stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain('opaque-runner-secret')
      expect(readFileSync(output.answersPath, 'utf-8')).not.toContain('opaque-runner-secret')
      const trace = readFileSync(output.tracePath, 'utf-8')
      expect(trace).not.toContain('opaque-runner-secret')
      expect(trace).toContain('加载失败')
    } finally {
      stderrSpy.mockRestore()
      mockCall.mockReset()
      vi.doUnmock('../src/facts/final.js')
      vi.doUnmock('../src/provider.js')
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it('源码状态分别支持 clean、dirty 和 Git 不可用', () => {
    const clean = collectSourceMetadata(process.cwd(), (args) => args[0] === 'rev-parse' ? 'abc\n' : '')
    expect(clean.gitHead).toBe('abc')
    expect(clean.gitDirty).toBe(false)
    const dirty = collectSourceMetadata(process.cwd(), (args) => args[0] === 'rev-parse' ? 'abc\n' : ' M file')
    expect(dirty.gitDirty).toBe(true)
    const unavailable = collectSourceMetadata(process.cwd(), () => { throw new Error('git unavailable') })
    expect(unavailable.gitHead).toBeNull()
    expect(unavailable.gitDirty).toBeNull()
  })

  it('写入哈希按最终 UTF-8 字节计算', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-inputs-write-'))
    try {
      const config = loadConfig()
      const inputs = createRunInputs({
        config,
        thinking: 'off',
        dry: true,
        agentInstructions: '规则',
        systemPrompt: '规则',
        toolSchema: { toolSchemaVersion: 5, toolSchemaSha256: 'a'.repeat(64), toolNames: ['rag_search'] },
        toolDefinitions: [],
        questions: [],
        chunks: [],
        sourceAtStart: collectSourceMetadata(process.cwd(), () => ''),
      })
      const path = join(dir, 'inputs.json')
      const hash = writeRunInputs(path, inputs)
      expect(hash).toBe(requireHash(path))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function requireHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function requireHashValue(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex')
}
