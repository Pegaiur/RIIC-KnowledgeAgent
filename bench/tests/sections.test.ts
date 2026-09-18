import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSectionDirectory } from '../src/sections.js'

let root: string
let docsDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rag-sections-'))
  docsDir = join(root, 'knowledge')
  mkdirSync(docsDir, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeDoc(rel: string, content: string): void {
  const full = join(docsDir, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
}

function writeManifest(files: readonly string[]): void {
  writeFileSync(join(docsDir, 'corpus-manifest.json'), JSON.stringify({ files }, null, 2), 'utf-8')
}

const DOC_A = [
  '---',
  'operators: [甲]',
  '---',
  '# 总览',
  '',
  '总览前言。',
  '',
  '## 制造站',
  '',
  '制造站引言。',
  '',
  '### 效率',
  '',
  '效率正文。',
  '',
  '### 排班',
  '',
  '排班正文。',
  '',
  '## 制造站',
  '',
  '重复同名正文。',
  '',
  '```text',
  '## 伪标题',
  '```',
  '',
  '# 附录',
  '',
  '附录正文。',
  '',
].join('\n')

const DOC_B = ['---', 'x: 1', '---', '只有正文。', '第二行。', ''].join('\n')

function setupCorpus(): void {
  writeDoc('base/a.md', DOC_A)
  writeDoc('base/b.md', DOC_B)
  writeManifest(['base/a.md', 'base/b.md'])
}

describe('sections：原文小节目录', () => {
  it('按 H1–H6 建立层级，保留祖先标题与正文范围（含下级小节）', () => {
    setupCorpus()
    const dir = buildSectionDirectory(docsDir)
    const headings = dir.sections.filter((s) => s.file === 'base/a.md').map((s) => s.heading)
    expect(headings).toEqual(['总览', '制造站', '效率', '排班', '制造站', '附录'])

    const overview = dir.sections[0]!
    expect(overview).toMatchObject({ file: 'base/a.md', level: 1, headingLine: 4, startLine: 6, endLine: 26 })
    expect(overview.ancestors).toEqual([])
    expect(overview.body).toContain('## 制造站')
    expect(overview.body).toContain('### 效率')

    const efficiency = dir.sections.find((s) => s.heading === '效率')!
    expect(efficiency).toMatchObject({ level: 3, headingLine: 12, startLine: 14, endLine: 14 })
    expect(efficiency.ancestors).toEqual(['总览', '制造站'])
    expect(efficiency.body).toBe('效率正文。')
    expect(efficiency.parentId).toBe(dir.sections.find((s) => s.heading === '制造站')!.sectionId)
  })

  it('同名标题按出现序号区分，ID 稳定且不重复', () => {
    setupCorpus()
    const dir = buildSectionDirectory(docsDir)
    const duplicates = dir.sections.filter((s) => s.heading === '制造站')
    expect(duplicates.map((s) => s.occurrence)).toEqual([1, 2])
    expect(new Set(duplicates.map((s) => s.sectionId)).size).toBe(2)
    expect(duplicates[0]!.body).toContain('效率正文。')
    expect(duplicates[1]!.body).toContain('重复同名正文。')

    const again = buildSectionDirectory(docsDir)
    expect(again.sections.map((s) => s.sectionId)).toEqual(dir.sections.map((s) => s.sectionId))
  })

  it('忽略 frontmatter 与 fenced code 内的伪标题', () => {
    setupCorpus()
    const dir = buildSectionDirectory(docsDir)
    expect(dir.sections.some((s) => s.heading === '伪标题')).toBe(false)
    expect(dir.sections.some((s) => s.heading === 'operators: [甲]')).toBe(false)
  })

  it('文件目录给出可展示标题与二级以下小节，一级标题不作为树节点', () => {
    setupCorpus()
    const dir = buildSectionDirectory(docsDir)
    const outline = dir.outlineFor('base/a.md')!
    expect(outline.title).toBe('总览')
    expect(outline.nodes.map((node) => [node.level, node.heading])).toEqual([
      [2, '制造站'],
      [3, '效率'],
      [3, '排班'],
      [2, '制造站'],
    ])

    // 无一级标题的文件回退为去扩展名的文件名，且没有树节点可展示。
    expect(dir.outlineFor('base/b.md')).toMatchObject({ title: 'b', nodes: [] })
    expect(dir.outlineFor('base/不存在.md')).toBeUndefined()
  })

  it('无标题文档提供文档根节点并排除 frontmatter', () => {
    setupCorpus()
    const dir = buildSectionDirectory(docsDir)
    const rootNode = dir.sections.find((s) => s.file === 'base/b.md')!
    expect(rootNode).toMatchObject({ level: 0, heading: '', headingLine: 0, startLine: 4, endLine: 5 })
    expect(rootNode.body).toBe('只有正文。\n第二行。')
  })

  it('按来源行把 chunk 映射回小节', () => {
    setupCorpus()
    const dir = buildSectionDirectory(docsDir)
    expect(dir.findByChunk('base/a.md', '效率', 14)?.heading).toBe('效率')
    const first = dir.findByChunk('base/a.md', '制造站', 10)!
    expect(first.occurrence).toBe(1)
    const second = dir.findByChunk('base/a.md', '制造站', 22)!
    expect(second.occurrence).toBe(2)
    expect(dir.findByChunk('base/a.md', '不存在', 1)).toBeUndefined()
  })

  it('导航优先列直接兄弟与子小节，按原文顺序去重并可标记省略', () => {
    setupCorpus()
    const dir = buildSectionDirectory(docsDir)
    const first = dir.sections.find((s) => s.heading === '制造站')!
    const nav = dir.navigationFor(first.sectionId)
    expect(nav.items.map((item) => item.heading)).toEqual(['效率', '排班', '制造站'])
    expect(nav.omitted).toBe(0)

    const limited = dir.navigationFor(first.sectionId, 1)
    expect(limited.items.map((item) => item.heading)).toEqual(['效率'])
    expect(limited.omitted).toBe(2)

    const efficiency = dir.sections.find((s) => s.heading === '效率')!
    expect(dir.navigationFor(efficiency.sectionId).items.map((item) => item.heading)).toEqual(['排班'])
  })
})
