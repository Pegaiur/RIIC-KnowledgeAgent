import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  it('只保留白名单字段并对文本脱敏，重复写入幂等且冲突拒绝覆盖', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-snapshot-'))
    try {
      const recordWithExtraToolBatch = record() as CostRecord & { toolBatch?: Record<string, unknown> }
      recordWithExtraToolBatch.toolBatch = {
        requested: 1, granted: 1, executed: 1, denied: 0, errors: 0,
        budgetBefore: 5, budgetAfter: 4, resultChars: 10, unexpected: 'drop-me',
      }
      const snapshot = createSnapshot({
        runId: 'run-1',
        topic: 'rag-facts',
        meta: {
          model: 'qwen3.7-flash', apiKey: 'sk-should-not-survive',
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
      expect(() => writeSnapshot(path, { ...snapshot, topic: 'conflict' })).toThrow('拒绝覆盖')
      expect(readSnapshot(path).records[0]?.httpAttempts?.[0]?.error).toBeUndefined()
      expect(readSnapshot(path).records[0]?.toolBatch).toEqual({
        requested: 1, granted: 1, executed: 1, denied: 0, errors: 0,
        budgetBefore: 5, budgetAfter: 4, resultChars: 10,
      })
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
        { id: 'Q1', category: 'fact', question: '有记录的问题' },
        { id: 'Q2', category: 'system', question: '没有记录的问题' },
      ]))
      writeFileSync(join(dir, 'records.jsonl'), `${JSON.stringify(record())}\n`)
      writeFileSync(join(dir, 'injected.json'), JSON.stringify({ Q1: ['facts/Q1'] }))
      writeFileSync(join(dir, 'answers.md'), [
        '# 查询回答记录', '',
        '## Q1（fact）', '',
        '- 问题：有记录的问题',
        '- 状态：completed｜终止：answer',
        '- 模型步骤：1｜工具批次：0｜预算：0/5｜工具序列：无',
        '- 宿主回馈：否', '',
        '最终答案第一段', '',
        '最终答案第二段',
      ].join('\n'))

      const snapshot = snapshotFromRunDir(dir, { root: dir })
      expect(snapshot.queries).toHaveLength(2)
      expect(snapshot.queries[0]).toMatchObject({ id: 'Q1', answer: '最终答案第一段\n\n最终答案第二段', injectedIds: ['facts/Q1'] })
      expect(snapshot.queries[1]).toMatchObject({ id: 'Q2', status: 'unknown', answer: null })
      expect(aggregateSnapshot(snapshot)).toMatchObject({ totalQueries: 2, totalCalls: 1 })
      expect(aggregateSnapshot(snapshot).byQuery.find((query) => query.queryId === 'Q2')).toMatchObject({ rounds: 0, costComplete: false })
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
})
