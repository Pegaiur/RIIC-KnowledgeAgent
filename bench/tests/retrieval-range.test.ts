import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSkillTableFile, loadCorpus, selectRetrievalChunks } from '../src/corpus.js'
import type { DocChunk } from '../src/types.js'

function chunk(file: string, heading = '小节'): DocChunk {
  return { id: `${file}#${heading}`, file, heading, text: '正文', startLine: 1, endLine: 1 }
}

describe('检索范围装配：技能表退出（ADR-013）', () => {
  it('isSkillTableFile 只匹配 references/技能-*.md，不误伤技能等价组与 base/guides', () => {
    expect(isSkillTableFile('references/技能-制造站.md')).toBe(true)
    expect(isSkillTableFile('references/技能-技能训练室.md')).toBe(true)
    expect(isSkillTableFile('references/技能等价组.md')).toBe(false)
    expect(isSkillTableFile('references/名册.md')).toBe(false)
    expect(isSkillTableFile('base/机制-制造站.md')).toBe(false)
    expect(isSkillTableFile('guides/制造站组合.md')).toBe(false)
  })

  it('默认排除九份技能表，保留其余 references 与 base/guides', () => {
    const chunks = [
      chunk('references/技能-制造站.md'),
      chunk('references/技能-贸易站.md'),
      chunk('references/技能等价组.md'),
      chunk('references/名册.md'),
      chunk('references/类别.md'),
      chunk('base/机制-制造站.md'),
      chunk('guides/制造站组合.md'),
    ]

    const selected = selectRetrievalChunks(chunks, { includeSkillTables: false })

    expect(selected.map((c) => c.file)).toEqual([
      'references/技能等价组.md',
      'references/名册.md',
      'references/类别.md',
      'base/机制-制造站.md',
      'guides/制造站组合.md',
    ])
  })

  it('includeSkillTables=true 时保留全部分块，范围可对照', () => {
    const chunks = [chunk('references/技能-制造站.md'), chunk('base/机制-制造站.md')]

    expect(selectRetrievalChunks(chunks, { includeSkillTables: true })).toHaveLength(2)
  })

  it('真实语料：默认范围剔除全部技能表且保留其余分块，两组范围均非全量或全排除', () => {
    const full = loadCorpus(join(process.cwd(), 'knowledge'))
    const excluded = selectRetrievalChunks(full, { includeSkillTables: false })

    const skillTableFiles = new Set(full.filter((c) => isSkillTableFile(c.file)).map((c) => c.file))
    expect(skillTableFiles.size).toBe(9)
    expect(excluded.length).toBeGreaterThan(0)
    expect(excluded.length).toBeLessThan(full.length)
    expect(excluded.every((c) => !isSkillTableFile(c.file))).toBe(true)

    const keptFiles = new Set(excluded.map((c) => c.file))
    for (const file of ['references/技能等价组.md', 'references/名册.md', 'references/类别.md', 'references/歧义.md', 'references/数据源.md', 'base/机制-制造站.md', 'guides/制造站组合.md']) {
      expect(keptFiles.has(file)).toBe(true)
    }
  })
})
