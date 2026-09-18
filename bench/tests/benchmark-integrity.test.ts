import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateBenchmarkIntegrity } from '../src/benchmark-integrity.js'
import { loadCorpus, loadGoldAnchorChunks } from '../src/corpus.js'
import { RAW_MACHINE_SOURCE_DOC_IDS } from '../src/facts/references.js'
import { checkGold, loadGold } from '../src/hitrate.js'
import { createSnapshot, writeSnapshot } from '../src/snapshot.js'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\')

describe('20 题基准完整性', () => {
  it('questions、gold、spec 与 manifest/实际切块完全对齐', () => {
    expect(validateBenchmarkIntegrity(ROOT)).toMatchObject({
      questionCount: 20,
      goldCount: 20,
      specCount: 20,
      corpusFileCount: 22,
      chunkCount: 156,
      // 定位目录 = manifest 22 份 + raw 机械真源 11 份
      anchorFileCount: 33,
      anchorChunkCount: 777,
    })
  })

  it('gold 的 raw 来源可在定位目录解析、但不进入检索范围', () => {
    const knowledgeRoot = join(ROOT, 'knowledge')
    const gold = loadGold(join(ROOT, 'bench', 'gold.json'))
    const keys = Object.values(gold).flatMap((entry) => entry.golden)
    const rawKeys = keys.filter((key) => key.startsWith('raw/'))

    expect(keys).toHaveLength(74)
    expect(rawKeys).toHaveLength(24)
    expect(checkGold(gold, loadGoldAnchorChunks(knowledgeRoot, RAW_MACHINE_SOURCE_DOC_IDS)).missing).toEqual([])

    const retrievalFiles = new Set(loadCorpus(knowledgeRoot).map((chunk) => chunk.file))
    const reachableRawKeys = rawKeys.filter((key) => retrievalFiles.has(key.slice(0, key.indexOf('#'))))
    expect(reachableRawKeys).toEqual([])
  })

  it('在隔离快照集合中统计新增和移除后的数量与字节，并拒绝无效 JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-integrity-fixture-'))
    try {
      copyIntegrityInputs(root)
      writeFixtureSnapshot(root, 'base')
      const sampleBytes = statSync(join(root, 'bench', 'results', 'base.json')).size
      writeBaselineAgentsMd(root, ['base.json'])
      expect(validateBenchmarkIntegrity(root)).toMatchObject({
        snapshotCount: 1,
        snapshotBytes: sampleBytes,
        baselineResults: 1,
      })

      writeFixtureSnapshot(root, 'extra')
      writeBaselineAgentsMd(root, ['base.json', 'extra.json'])
      expect(validateBenchmarkIntegrity(root)).toMatchObject({ snapshotCount: 2, snapshotBytes: sampleBytes * 2 })

      rmSync(join(root, 'bench', 'results', 'extra.json'))
      writeBaselineAgentsMd(root, ['base.json'])
      expect(validateBenchmarkIntegrity(root)).toMatchObject({ snapshotCount: 1, snapshotBytes: sampleBytes })

      writeFileSync(join(root, 'bench', 'results', 'invalid.json'), '{}', 'utf8')
      expect(() => validateBenchmarkIntegrity(root)).toThrow('共享快照 invalid.json 校验失败')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('质量基线表为空不再合法（至少登记 1 条结果）', () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-integrity-nobaseline-'))
    try {
      copyIntegrityInputs(root)
      writeBaselineAgentsMd(root, [])
      expect(() => validateBenchmarkIntegrity(root)).toThrow('质量基线表为空')
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

/** 写入内容一致的最小合法快照，保证两次写入的字节数相同。 */
function writeFixtureSnapshot(root: string, name: string): void {
  const snapshot = createSnapshot({
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
  writeSnapshot(join(root, 'bench', 'results', `${name}.json`), snapshot)
}

/** 让夹具 AGENTS.md 的质量基线表与当前快照集合保持同步。 */
function writeBaselineAgentsMd(root: string, names: string[]): void {
  const rows = names.map((name) => `| \`${name}\` | \`hash\` | 夹具登记 |`).join('\n')
  writeFileSync(
    join(root, 'AGENTS.md'),
    `# 夹具\n\n## 质量基线\n\n> 说明\n\n` +
      `| 结果（\`bench/results/\` 下） | SHA-256 | 简短说明 |\n| ---- | ---- | ---- |\n${rows}\n`,
    'utf8',
  )
}
