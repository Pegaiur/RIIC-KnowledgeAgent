import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateBenchmarkIntegrity } from '../src/benchmark-integrity.js'
import { createSnapshot, writeSnapshot } from '../src/snapshot.js'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\')

describe('20 题基准完整性', () => {
  it('questions、gold、spec 与 manifest/实际切块完全对齐', () => {
    expect(validateBenchmarkIntegrity(ROOT)).toMatchObject({
      questionCount: 20,
      goldCount: 20,
      specCount: 20,
      corpusFileCount: 31,
    })
  })

  it('在隔离快照集合中统计新增和移除后的数量与字节，并拒绝无效 JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-integrity-empty-'))
    try {
      copyIntegrityInputs(root)
      expect(validateBenchmarkIntegrity(root)).toMatchObject({ snapshotCount: 0, snapshotBytes: 0 })
      const resultsRoot = join(root, 'bench', 'results')
      mkdirSync(resultsRoot, { recursive: true })
      expect(validateBenchmarkIntegrity(root)).toMatchObject({ snapshotCount: 0, snapshotBytes: 0 })
      const first = join(resultsRoot, 'sample-a.json')
      const second = join(resultsRoot, 'sample-b.json')
      const sample = createSnapshot({
        runId: 'integrity-fixture',
        topic: 'integrity-test',
        meta: {},
        queries: [{
          id: 'F01', category: 'fact', question: '测试问题', answer: '测试答案',
          status: 'completed', terminationReason: 'answer', rounds: 0, toolRounds: 0,
          toolTrace: [], feedbackUsed: false, budgetUsed: 0, budgetRemaining: 0, injectedIds: [],
        }],
        records: [],
      })
      writeSnapshot(first, sample)
      const sampleBytes = statSync(first).size
      expect(validateBenchmarkIntegrity(root)).toMatchObject({ snapshotCount: 1, snapshotBytes: sampleBytes })

      writeSnapshot(second, sample)
      expect(validateBenchmarkIntegrity(root)).toMatchObject({ snapshotCount: 2, snapshotBytes: sampleBytes * 2 })

      rmSync(first)
      expect(validateBenchmarkIntegrity(root)).toMatchObject({ snapshotCount: 1, snapshotBytes: sampleBytes })

      writeFileSync(join(resultsRoot, 'invalid.json'), '{}', 'utf8')
      expect(() => validateBenchmarkIntegrity(root)).toThrow('共享快照 invalid.json 校验失败')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function copyIntegrityInputs(root: string): void {
  mkdirSync(join(root, 'bench'), { recursive: true })
  mkdirSync(join(root, 'docs', 'spec'), { recursive: true })
  cpSync(join(ROOT, 'bench', 'questions.json'), join(root, 'bench', 'questions.json'))
  cpSync(join(ROOT, 'bench', 'gold.json'), join(root, 'bench', 'gold.json'))
  cpSync(join(ROOT, 'docs', 'spec', 'rag-answer-baseline.md'), join(root, 'docs', 'spec', 'rag-answer-baseline.md'))
  cpSync(join(ROOT, 'knowledge'), join(root, 'knowledge'), { recursive: true })
}
