import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateBenchmarkIntegrity } from '../src/benchmark-integrity.js'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\')

describe('20 题基准完整性', () => {
  it('questions、gold、spec 与 manifest/实际切块完全对齐', () => {
    expect(validateBenchmarkIntegrity(ROOT)).toMatchObject({
      questionCount: 20,
      goldCount: 20,
      specCount: 20,
      corpusFileCount: 31,
      snapshotCount: 3,
      snapshotBytes: 313133,
    })
  })

  it('共享快照目录缺失或为空时返回零数量和零字节', () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-integrity-empty-'))
    try {
      copyIntegrityInputs(root)
      expect(validateBenchmarkIntegrity(root)).toMatchObject({ snapshotCount: 0, snapshotBytes: 0 })
      mkdirSync(join(root, 'bench', 'results'), { recursive: true })
      expect(validateBenchmarkIntegrity(root)).toMatchObject({ snapshotCount: 0, snapshotBytes: 0 })
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
