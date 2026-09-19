import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectMarkdownFiles, loadCorpus, loadCorpusManifest, loadGoldAnchorChunks } from '../src/corpus.js'
import { FACTS_SOURCE_DOC_IDS } from '../src/facts/references.js'

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
    expect(actual.size).toBe(26)
    expect([...actual].filter((file) => file.startsWith('base/'))).toHaveLength(16)
    expect([...actual].filter((file) => file.startsWith('guides/'))).toHaveLength(10)
    expect([...actual].filter((file) => file.startsWith('raw/') || file.startsWith('facts/'))).toHaveLength(0)
    expect(actual.has('AGENTS.md')).toBe(false)
    expect(actual.has('base/机制-基建总览.md')).toBe(true)
    expect(actual.has('guides/类别.md')).toBe(true)
    expect(actual.has('guides/歧义.md')).toBe(true)
    expect(actual.has('guides/组合/贸易站组合.md')).toBe(true)
    expect(actual.has('guides/用人/新手培养.md')).toBe(true)
    expect(actual.has('guides/布局/布局选择.md')).toBe(true)
    expect(actual.has('guides/操作/无人机使用.md')).toBe(true)

    const baseChunks = loadCorpus(KNOWLEDGE_ROOT).filter((chunk) => chunk.file.startsWith('base/'))
    expect(baseChunks.every((chunk) => chunk.anchor && chunk.anchor.length > 0)).toBe(true)
    expect(baseChunks.some((chunk) => chunk.heading === '公式与规则')).toBe(false)

    const unlockText = baseChunks
      .filter((chunk) => chunk.file === 'base/通则/机制-技能解锁与练度.md')
      .map((chunk) => chunk.text)
      .join('\n')
    expect(unlockText).toContain('一星、二星')
    expect(unlockText).toContain('30 级')
    expect(unlockText).toContain('三星、四星')
    expect(unlockText).toContain('精一阶段')
    expect(unlockText).toContain('具体解锁阶段仍以该技能在 facts 返回记录中的解锁字段为准')
    expect(unlockText).not.toContain('一至三星')

    const pollutedDocuments = [
      'SKILL.md',
      'raw/心情消耗恢复与工休时间.md',
    ]
    expect(pollutedDocuments.filter((file) => actual.has(file))).toEqual([])
  })
})

describe('gold 完整定位目录（ADR-021 步骤 6）', () => {
  it('等于 manifest 原文分块加声明的 11 份 facts 正式输入，且 facts 不进检索', () => {
    const manifest = new Set(loadCorpusManifest(KNOWLEDGE_ROOT))
    const manifestChunks = loadCorpus(KNOWLEDGE_ROOT)
    const anchors = loadGoldAnchorChunks(KNOWLEDGE_ROOT, FACTS_SOURCE_DOC_IDS)
    const anchorFiles = new Set(anchors.map((chunk) => chunk.file))
    const declaredFacts = [...anchorFiles].filter((file) => file.startsWith('facts/'))

    expect(FACTS_SOURCE_DOC_IDS).toHaveLength(11)
    expect(declaredFacts).toHaveLength(11)
    expect(new Set(manifestChunks.map((chunk) => chunk.file))).toEqual(manifest)
    expect(anchors.length).toBe(manifestChunks.length + 621)
    expect(anchorFiles.size).toBe(manifest.size + 11)
    expect(manifestChunks.filter((chunk) => chunk.file.startsWith('facts/') || chunk.file.startsWith('raw/'))).toEqual([])
  })

  it('声明的真源缺失、越界或指向 raw 临时稿即失败，不静默降级为空库', () => {
    const root = mkdtempSync(join(tmpdir(), 'gold-anchor-'))
    try {
      mkdirSync(join(root, 'base'), { recursive: true })
      mkdirSync(join(root, 'facts'), { recursive: true })
      mkdirSync(join(root, 'raw'), { recursive: true })
      writeFileSync(join(root, 'corpus-manifest.json'), JSON.stringify({ files: ['base/机制-甲.md'] }), 'utf8')
      writeFileSync(join(root, 'base', '机制-甲.md'), '# 甲\n\n## 小节\n\n正文', 'utf8')
      writeFileSync(join(root, 'facts', '名册.md'), '# 名册\n\n- 甲 | ☆1 | 近卫', 'utf8')
      writeFileSync(join(root, 'raw', '临时稿.md'), '# 临时稿\n\n## 小节\n\n正文', 'utf8')

      expect(() => loadGoldAnchorChunks(root, ['facts/名册.md', 'facts/技能-制造站.md'])).toThrow(/技能-制造站/)
      expect(() => loadGoldAnchorChunks(root, ['../越界.md'])).toThrow(/facts\//)
      expect(() => loadGoldAnchorChunks(root, ['guides/类别.md'])).toThrow(/facts\//)
      // raw 只是临时落点，不被接受为 gold 定位真源
      expect(() => loadGoldAnchorChunks(root, ['raw/临时稿.md'])).toThrow(/facts\//)

      const anchors = loadGoldAnchorChunks(root, ['facts/名册.md'])
      expect(new Set(anchors.map((chunk) => chunk.file))).toEqual(new Set(['base/机制-甲.md', 'facts/名册.md']))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
