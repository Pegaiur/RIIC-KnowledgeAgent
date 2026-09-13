import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBaselineResults, validateQualityBaseline } from '../src/quality-baseline.js'
import { createSnapshot, writeSnapshot } from '../src/snapshot.js'

/** 与基准完整性夹具同风格的最小合法快照。 */
function fixtureSnapshot(): ReturnType<typeof createSnapshot> {
  return createSnapshot({
    runId: 'quality-fixture',
    topic: 'quality-test',
    meta: {},
    queries: [{
      id: 'F01', category: 'fact', question: '测试问题', answer: '测试答案',
      status: 'completed', terminationReason: 'answer', rounds: 0, toolRounds: 0,
      toolTrace: [], feedbackUsed: false, budgetUsed: 0, budgetRemaining: 0, injectedIds: [],
    }],
    records: [],
  })
}

/** 写入表格版 AGENTS.md：表体登记给定的结果文件名。 */
function writeAgentsMd(root: string, names: string[]): void {
  const rows = names.map((name) => `| \`${name}\` | \`hash\` | 说明 |`).join('\n')
  writeFileSync(
    join(root, 'AGENTS.md'),
    `# 夹具\n\n## 质量基线\n\n> 说明\n\n` +
      `| 结果（\`bench/results/\` 下） | SHA-256 | 简短说明 |\n| ---- | ---- | ---- |\n${rows}\n`,
    'utf-8',
  )
}

/** 构造隔离夹具：表格版 AGENTS.md + 一份 base.json 快照。 */
function setupFixture(root: string, registered: string[] = ['base.json']): void {
  mkdirSync(join(root, 'bench', 'results'), { recursive: true })
  writeSnapshot(join(root, 'bench', 'results', 'base.json'), fixtureSnapshot())
  writeAgentsMd(root, registered)
}

function collect(root: string): { errors: string[]; summary: ReturnType<typeof validateQualityBaseline> } {
  const errors: string[] = []
  return { errors, summary: validateQualityBaseline(root, errors) }
}

/** 每个用例独立的临时夹具目录；回调结束后清理。 */
function withFixture(registered: string[], run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'rag-quality-baseline-'))
  try {
    setupFixture(root, registered)
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('正式质量基线机械校验', () => {
  it('全部结果均已登记：通过并返回结果数', () => {
    withFixture(['base.json'], (root) => {
      expect(readBaselineResults(root)).toEqual(new Set(['base.json']))
      const { errors, summary } = collect(root)
      expect(errors).toEqual([])
      expect(summary).toEqual({ resultCount: 1 })
    })
  })

  it('存在未登记结果：报错并含文件名', () => {
    withFixture(['base.json'], (root) => {
      writeSnapshot(join(root, 'bench', 'results', 'orphan.json'), fixtureSnapshot())
      const { errors, summary } = collect(root)
      expect(summary).toBeNull()
      expect(errors.join('\n')).toContain('未登记')
      expect(errors.join('\n')).toContain('orphan.json')
    })
  })

  it('缺 AGENTS.md：报错', () => {
    withFixture(['base.json'], (root) => {
      rmSync(join(root, 'AGENTS.md'))
      const { errors, summary } = collect(root)
      expect(summary).toBeNull()
      expect(errors.join('\n')).toContain('AGENTS.md')
    })
  })

  it('缺「## 质量基线」段：报错', () => {
    withFixture(['base.json'], (root) => {
      writeFileSync(join(root, 'AGENTS.md'), '# 没有质量基线段\n', 'utf-8')
      const { errors, summary } = collect(root)
      expect(summary).toBeNull()
      expect(errors.join('\n')).toContain('质量基线')
    })
  })

  it('质量基线表为空：报错', () => {
    withFixture([], (root) => {
      const { errors, summary } = collect(root)
      expect(summary).toBeNull()
      expect(errors.join('\n')).toContain('质量基线表为空')
    })
  })

  it('bench/results 为空：通过且结果数为 0', () => {
    withFixture(['base.json'], (root) => {
      rmSync(join(root, 'bench', 'results', 'base.json'))
      const { errors, summary } = collect(root)
      expect(errors).toEqual([])
      expect(summary).toEqual({ resultCount: 0 })
    })
  })
})
