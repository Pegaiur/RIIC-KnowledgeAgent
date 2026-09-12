import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aggregateSnapshot } from '../src/report.js'
import { createSnapshot, readSnapshot, snapshotFromRunDir, writeSnapshot } from '../src/snapshot.js'
import type { CostRecord } from '../src/types.js'

function record(queryId = 'Q1'): CostRecord {
  return {
    ts: '2026-09-06T00:00:00.000Z',
    queryId,
    category: 'fact',
    round: 1,
    thinking: 'off',
    provider: 'qwen',
    model: 'qwen3.7-flash',
    input: 100,
    output: 20,
    knownInput: 100,
    knownOutput: 20,
    cached: 0,
    reasoning: 0,
    costIn: 0.00002,
    costOut: 0.000016,
    costTotal: 0.000036,
    usageCompleteness: 'complete',
    usageAggregation: 'response',
    truncated: false,
    httpAttempts: [{
      attempt: 1,
      status: 200,
      outcome: 'accepted',
      usage: { input: 100, output: 20, cached: 0, reasoning: 0, completeness: 'complete' },
      error: 'Authorization: Bearer sk-do-not-copy-this-value',
    }],
  }
}

describe('共享基准快照', () => {
  it('送达台账导出读回保留范围与解析成员，过滤未知字段并拒绝非法范围', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-delivery-snapshot-'))
    try {
      const range = { file: 'base/甲.md', docId: 'doc:base/甲.md', offset: 0, endOffset: 12, startLine: 1, endLine: 2, complete: false, nextOffset: 12 }
      const delivery = [{ callId: 'a', status: 'success', fulltextRanges: [range], attachedFacts: [{
        term: '甲', start: 0, end: 1, matched: ['甲'], delivered: ['甲'], omittedReason: null, chars: 20, elapsedMs: 0,
        paths: [{ kind: 'exact' as const, category: 'operator', term: '甲', memberIds: ['甲'] }],
      }], unexpected: 'must-drop' }]
      const input = { runId: 'delivery', topic: '送达', meta: {}, queries: [{
        id: 'Q1', category: 'fact', question: '甲', answer: '甲', status: 'completed' as const, terminationReason: 'answer' as const,
        rounds: 1, toolRounds: 1, toolTrace: ['rag_search'], feedbackUsed: false, budgetUsed: 1, budgetRemaining: 4, injectedIds: [],
      }], records: [{ ...record(), tools: ['rag_search' as const], ragDelivery: delivery }] }
      const snapshot = createSnapshot(input)
      const file = join(dir, 'snapshot.json')
      writeSnapshot(file, snapshot)
      const restored = readSnapshot(file)
      expect(restored.records[0]?.ragDelivery?.[0]?.fulltextRanges).toEqual([range])
      expect(restored.records[0]?.ragDelivery?.[0]?.attachedFacts).toEqual(delivery[0]!.attachedFacts)
      expect(readFileSync(file, 'utf8')).not.toContain('must-drop')
      expect(aggregateSnapshot(restored).ragDeliveryStats).toMatchObject({ internalFactsQueries: 1, attachedCalls: 1, deliveredCards: 1, expandedRanges: 1 })
      expect(createSnapshot({ ...input, records: [record()] }).records[0]).not.toHaveProperty('ragDelivery')
      range.nextOffset = 11
      expect(() => createSnapshot(input)).toThrow('原文范围与续读位置不一致')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('只保留白名单字段并对文本脱敏，重复写入幂等且冲突拒绝覆盖', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-snapshot-'))
    try {
      const recordWithExtraToolBatch = record() as CostRecord & { toolBatch?: Record<string, unknown> }
      recordWithExtraToolBatch.toolBatch = {
        requested: 1, granted: 1, executed: 1, denied: 0, errors: 0,
        attempts: 1, successes: 1,
        hitCount: 1, hitUnknown: 0,
        budgetBefore: 5, budgetAfter: 4, resultChars: 10, unexpected: 'drop-me',
      }
      const snapshot = createSnapshot({
        runId: 'run-1',
        topic: 'rag-facts',
        meta: {
          model: 'qwen3.7-flash', apiKey: 'sk-should-not-survive',
          corpusDir: 'C:\\private\\corpus',
          headers: { Cookie: 'synthetic-cookie' },
          unknownExtra: 'drop-me',
          maxTokens: 4096,
          inputsSchemaVersion: 1,
          factsQueryListLimit: 3,
          toolSchemaVersion: 2,
          toolSchemaSha256: 'a'.repeat(64),
          toolNames: ['rag_search'],
          toolHitCount: 1,
          toolHitUnknown: 0,
          totalCost: 99, inputTokens: 123, terminationReasons: { answer: 1 },
        },
        queries: [{
          id: 'Q1', category: 'fact', question: 'Authorization: Bearer sk-question-secret', answer: '答案 sk-answer-secret',
          status: 'completed', terminationReason: 'answer', rounds: 1, toolRounds: 0, toolTrace: [],
          feedbackUsed: false, budgetUsed: 0, budgetRemaining: 5, injectedIds: [],
        }],
        records: [recordWithExtraToolBatch],
      })
      const path = join(dir, 'run-1.json')
      writeSnapshot(path, snapshot)
      writeSnapshot(path, snapshot)
      expect(readFileSync(path, 'utf-8')).not.toContain('should-not-survive')
      expect(readFileSync(path, 'utf-8')).not.toContain('question-secret')
      expect(readFileSync(path, 'utf-8')).not.toContain('do-not-copy')
      expect(readSnapshot(path).meta).not.toHaveProperty('totalCost')
      expect(readSnapshot(path).meta).not.toHaveProperty('inputTokens')
      expect(readSnapshot(path).meta).not.toHaveProperty('terminationReasons')
      expect(readSnapshot(path).meta).not.toHaveProperty('toolHitCount')
      expect(readSnapshot(path).meta).not.toHaveProperty('toolHitUnknown')
      expect(readSnapshot(path).meta).not.toHaveProperty('corpusDir')
      expect(readSnapshot(path).meta).not.toHaveProperty('headers')
      expect(readSnapshot(path).meta).not.toHaveProperty('unknownExtra')
      expect(() => writeSnapshot(path, { ...snapshot, topic: 'conflict' })).toThrow('拒绝覆盖')
      expect(readSnapshot(path).records[0]?.httpAttempts?.[0]?.error).toBeUndefined()
      expect(readSnapshot(path).records[0]?.toolBatch).toEqual({
        requested: 1, granted: 1, executed: 1, denied: 0, errors: 0,
        attempts: 1, successes: 1,
        hitCount: 1, hitUnknown: 0,
        budgetBefore: 5, budgetAfter: 4, resultChars: 10,
      })
      expect(readSnapshot(path).meta).toMatchObject({
        maxTokens: 4096,
        inputsSchemaVersion: 1,
        factsQueryListLimit: 3,
        toolSchemaVersion: 2,
        toolSchemaSha256: 'a'.repeat(64),
        toolNames: ['rag_search'],
      })
      const unsafePath = join(dir, 'unsafe.json')
      writeFileSync(unsafePath, JSON.stringify({ ...snapshot, meta: { ...snapshot.meta, unknownExtra: 'must-reject' } }))
      expect(() => readSnapshot(unsafePath)).toThrow('meta.unknownExtra')
      writeFileSync(unsafePath, JSON.stringify({ ...snapshot, meta: { ...snapshot.meta, corpusDir: 'C:\\private\\corpus' } }))
      expect(() => readSnapshot(unsafePath)).toThrow('meta.corpusDir')
      expect(() => createSnapshot({
        ...snapshot,
        records: [{ ...record(), toolBatch: { requested: 'bad' } as unknown as CostRecord['toolBatch'] }],
      })).toThrow('toolBatch.requested 无效')
      expect(() => createSnapshot({
        ...snapshot,
        records: [{ ...record(), toolBatch: { requested: 1 } as unknown as CostRecord['toolBatch'] }],
      })).toThrow('toolBatch.granted 无效')
      expect(() => createSnapshot({
        ...snapshot,
        records: [{
          ...record(),
          httpAttempts: [{
            ...record().httpAttempts?.[0],
            usage: { input: 'bad' },
          }],
        } as unknown as CostRecord],
      })).toThrow('usage.input 无效')
      expect(() => createSnapshot({
        ...snapshot,
        records: [{
          ...record(),
          httpAttempts: [{ ...record().httpAttempts?.[0], usage: null }],
        } as unknown as CostRecord],
      })).toThrow('usage 必须是对象')
      expect(() => createSnapshot({
        ...snapshot,
        records: [{
          ...record(),
          httpAttempts: [{ ...record().httpAttempts?.[0], usage: { input: null, output: null, cached: null, reasoning: null, completeness: 'invalid' } }],
        } as unknown as CostRecord],
      })).toThrow('usage.completeness 无效')
      expect(() => createSnapshot({
        ...snapshot,
        records: [{
          ...record(),
          httpAttempts: [{ ...record().httpAttempts?.[0], outcome: 'bogus' }],
        } as unknown as CostRecord],
      })).toThrow('httpAttempts[0] 无效')
      expect(() => createSnapshot({ ...snapshot, meta: { ...snapshot.meta, maxTokens: 0 } })).toThrow('meta.maxTokens')
      expect(() => createSnapshot({ ...snapshot, meta: { ...snapshot.meta, maxTokens: 1.5 } })).toThrow('meta.maxTokens')
      expect(() => createSnapshot({ ...snapshot, meta: { ...snapshot.meta, inputsSchemaVersion: 2 } })).toThrow('meta.inputsSchemaVersion')
      expect(() => createSnapshot({ ...snapshot, meta: { ...snapshot.meta, inputsSchemaVersion: '1' } })).toThrow('meta.inputsSchemaVersion')
      expect(() => createSnapshot({
        ...snapshot,
        records: [{
          ...record(),
          httpAttempts: [{ ...record().httpAttempts?.[0], status: '200' }],
        } as unknown as CostRecord],
      })).toThrow('httpAttempts[0] 无效')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('从旧运行目录解析完整题集，并由 queries 补齐无记录失败题', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-run-export-'))
    try {
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ topic: 'rag-facts', questionsPath: join(dir, 'questions.json') }))
      writeFileSync(join(dir, 'questions.json'), JSON.stringify([
        { id: 'Q1', category: 'fact', question: '当前版本改名后的问题' },
        { id: 'Q2', category: 'system', question: '没有记录的问题' },
      ]))
      writeFileSync(join(dir, 'records.jsonl'), `${JSON.stringify(record())}\n${JSON.stringify(record('Q3'))}\n`)
      writeFileSync(join(dir, 'injected.json'), JSON.stringify({ Q1: ['facts/Q1'] }))
      writeFileSync(join(dir, 'answers.md'), [
        '# 查询回答记录', '',
        '## Q1（fact）', '',
        '- 问题：历史原始问题',
        '- 状态：completed｜终止：answer',
        '- 模型步骤：1｜工具批次：0｜预算：0/5｜工具序列：无',
        '- 宿主回馈：否', '',
        '最终答案第一段', '',
        '最终答案第二段',
      ].join('\n'))

      const snapshot = snapshotFromRunDir(dir, { root: dir })
      expect(snapshot.queries).toHaveLength(3)
      expect(snapshot.queries[0]).toMatchObject({ id: 'Q1', question: '历史原始问题', answer: '最终答案第一段\n\n最终答案第二段', injectedIds: ['facts/Q1'] })
      expect(snapshot.queries[1]).toMatchObject({ id: 'Q2', status: 'unknown', answer: null })
      expect(snapshot.queries[2]).toMatchObject({ id: 'Q3', question: '', status: 'unknown' })
      expect(aggregateSnapshot(snapshot)).toMatchObject({ totalQueries: 3, totalCalls: 2 })
      expect(aggregateSnapshot(snapshot).byQuery.find((query) => query.queryId === 'Q2')).toMatchObject({ rounds: 0, costComplete: false })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('新双预算行解析成功额度与获准尝试，旧预算行仍按原口径读取且不伪填 attempt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-dual-budget-'))
    try {
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({
        topic: 'rag-hybrid',
        questionIds: ['Q1', 'Q2'],
        toolAttemptLimit: 10,
        parallelToolCalls: false,
      }))
      writeFileSync(join(dir, 'records.jsonl'), '')
      writeFileSync(join(dir, 'answers.md'), [
        '# 查询回答记录', '',
        '## Q1（fact）', '',
        '- 问题：新格式',
        '- 状态：completed｜终止：answer',
        '- 模型步骤：3｜工具批次：2｜成功额度：2/5｜获准尝试：4/10｜工具序列：rag_search→facts_search',
        '- 宿主回馈：否', '',
        '答案一', '',
        '## Q2（fact）', '',
        '- 问题：旧格式',
        '- 状态：completed｜终止：answer',
        '- 模型步骤：2｜工具批次：1｜预算：3/5｜工具序列：rag_search',
        '- 宿主回馈：否', '',
        '答案二',
      ].join('\n'))

      const snapshot = snapshotFromRunDir(dir, { root: dir })
      expect(snapshot.meta).toMatchObject({ toolAttemptLimit: 10, parallelToolCalls: false })
      expect(snapshot.queries[0]).toMatchObject({ id: 'Q1', budgetUsed: 2, budgetRemaining: 3, attemptUsed: 4, attemptLimit: 10, toolTrace: ['rag_search', 'facts_search'] })
      expect(snapshot.queries[1]).toMatchObject({ id: 'Q2', budgetUsed: 3, budgetRemaining: 2, toolTrace: ['rag_search'] })
      expect(snapshot.queries[1]).not.toHaveProperty('attemptUsed')
      expect(snapshot.queries[1]).not.toHaveProperty('attemptLimit')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('保留自定义题集定义，并兼容旧版回答格式', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-legacy-export-'))
    try {
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({
        topic: 'custom',
        questionsPath: 'outside/questions.json',
        questionIds: ['F01'],
        questionDefinitions: [{ id: 'F01', category: 'fact', question: '自定义题目' }],
      }))
      writeFileSync(join(dir, 'answers.md'), [
        '# 查询回答记录', '',
        '## F01（fact）', '',
        '- 问题：自定义题目',
        '- 轮数：2｜检索次数：1｜工具序列：rag_search', '',
        '旧版回答第一段', '',
        '旧版回答第二段',
      ].join('\n'))

      const snapshot = snapshotFromRunDir(dir, { root: dir })
      expect(snapshot.queries).toHaveLength(1)
      expect(snapshot.queries[0]).toMatchObject({
        id: 'F01',
        question: '自定义题目',
        status: 'completed',
        terminationReason: 'unknown',
        rounds: 2,
        toolRounds: 1,
        toolTrace: ['rag_search'],
        answer: '旧版回答第一段\n\n旧版回答第二段',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('以嵌入题集和答案恢复历史题号，不用当前默认题集冒充历史', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-history-export-'))
    try {
      mkdirSync(join(dir, 'bench'), { recursive: true })
      writeFileSync(join(dir, 'bench', 'questions.json'), JSON.stringify([
        { id: 'CURRENT', category: 'fact', question: '当前默认问题' },
      ]))
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ questions: 1 }))
      writeFileSync(join(dir, 'records.jsonl'), '')
      writeFileSync(join(dir, 'answers.md'), [
        '# 查询回答记录', '',
        '## ORIGINAL（fact）', '',
        '- 问题：历史原始问题',
        '- 轮数：1｜检索次数：0｜工具序列：无', '',
        '历史答案', '',
        '## FAILED（system）', '',
        '- 问题：历史失败问题',
        '- 轮数：0｜检索次数：0｜工具序列：无', '',
        '（查询失败：服务不可用）',
      ].join('\n'))

      const snapshot = snapshotFromRunDir(dir, { root: dir })
      expect(snapshot.queries.map((query) => query.id)).toEqual(['ORIGINAL', 'FAILED'])
      expect(snapshot.queries[0]).toMatchObject({ id: 'ORIGINAL', question: '历史原始问题', status: 'completed' })
      expect(snapshot.queries[1]).toMatchObject({ id: 'FAILED', question: '历史失败问题', status: 'failed', terminationReason: 'llm_error', answer: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('外部题集只按可信历史题号受限匹配，正文冲突优先保留答案原文', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-drifted-questions-'))
    try {
      mkdirSync(join(dir, 'bench'), { recursive: true })
      mkdirSync(join(dir, 'history'), { recursive: true })
      writeFileSync(join(dir, 'bench', 'questions.json'), JSON.stringify([
        { id: 'A', category: 'fact', question: '当前版本 A' },
        { id: 'NEW', category: 'fact', question: '当前新增题目' },
        { id: 'B', category: 'system', question: '当前版本 B' },
      ]))
      writeFileSync(join(dir, 'history', 'meta.json'), JSON.stringify({
        questions: 2,
        questionIds: ['B', 'A'],
        questionsPath: 'bench/questions.json',
      }))
      writeFileSync(join(dir, 'history', 'records.jsonl'), `${JSON.stringify(record('B'))}\n`)
      writeFileSync(join(dir, 'history', 'answers.md'), [
        '# 查询回答记录', '',
        '## A（fact）', '',
        '- 问题：历史版本 A',
        '- 状态：completed｜终止：answer',
        '- 模型步骤：1｜工具批次：0｜预算：0/5｜工具序列：无',
        '- 宿主回馈：否', '',
        '历史答案 A',
      ].join('\n'))

      const snapshot = snapshotFromRunDir(join(dir, 'history'), { root: dir })
      expect(snapshot.queries.map((query) => query.id)).toEqual(['B', 'A'])
      expect(snapshot.queries.map((query) => query.id)).not.toContain('NEW')
      expect(snapshot.queries[0]).toMatchObject({ id: 'B', category: 'fact', question: '' })
      expect(snapshot.queries[1]).toMatchObject({ id: 'A', question: '历史版本 A', answer: '历史答案 A' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
