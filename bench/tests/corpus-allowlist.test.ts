import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectMarkdownFiles, loadCorpus, loadCorpusManifest } from '../src/corpus.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const KNOWLEDGE_ROOT = join(ROOT, 'knowledge')

function toDocIds(files: readonly string[]): Set<string> {
  return new Set(files.map((file) => relative(KNOWLEDGE_ROOT, file).split(sep).join('/')))
}

describe('真实 knowledge 语料白名单', () => {
  it('检索文件集合严格等于批准白名单，并排除实现污染文档', () => {
    const actual = toDocIds(collectMarkdownFiles(KNOWLEDGE_ROOT))
    const approved = new Set(loadCorpusManifest(KNOWLEDGE_ROOT))
    const loadedChunks = new Set(loadCorpus(KNOWLEDGE_ROOT).map((chunk) => chunk.file))

    expect(actual).toEqual(approved)
    expect(loadedChunks).toEqual(approved)
    expect(actual.size).toBe(31)
    expect([...actual].filter((file) => file.startsWith('base/'))).toHaveLength(12)
    expect([...actual].filter((file) => file.startsWith('references/'))).toHaveLength(14)
    expect([...actual].filter((file) => file.startsWith('guides/'))).toHaveLength(5)
    expect([...actual].filter((file) => file.startsWith('raw/'))).toHaveLength(0)
    expect(actual.has('AGENTS.md')).toBe(false)
    expect(actual.has('base/机制-基建总览.md')).toBe(true)
    expect(actual.has('references/名册.md')).toBe(true)
    expect(actual.has('guides/贸易站组合.md')).toBe(true)
    expect(actual.has('guides/新手培养.md')).toBe(true)

    const baseChunks = loadCorpus(KNOWLEDGE_ROOT).filter((chunk) => chunk.file.startsWith('base/'))
    expect(baseChunks.every((chunk) => chunk.anchor && chunk.anchor.length > 0)).toBe(true)
    expect(baseChunks.some((chunk) => chunk.heading === '公式与规则')).toBe(false)

    const unlockText = baseChunks
      .filter((chunk) => chunk.file === 'base/机制-技能解锁与练度.md')
      .map((chunk) => chunk.text)
      .join('\n')
    expect(unlockText).toContain('一星、二星')
    expect(unlockText).toContain('30 级')
    expect(unlockText).toContain('三星、四星')
    expect(unlockText).toContain('精一阶段')
    expect(unlockText).toContain('具体解锁阶段仍以该技能在 references 中的解锁字段为准')
    expect(unlockText).not.toContain('一至三星')

    const pollutedDocuments = [
      'SKILL.md',
      'raw/组合成员练度审阅稿.md',
      'raw/玩家输出口径.md',
      'raw/玩家报告实现计划.md',
      'raw/实现TODO提示.md',
      'raw/精英干员组后端缺口.md',
      'raw/自然语言推荐层设计.md',
      'raw/自然语言推荐层实现交接与验收.md',
      'raw/组合知识库.md',
      'raw/高效率散件与搓玉名单.md',
      'raw/新手必练与必收集名单.md',
      'raw/心情消耗恢复与工休时间.md',
    ]
    expect(pollutedDocuments.filter((file) => actual.has(file))).toEqual([])
  })
})
