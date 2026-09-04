import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { collectMarkdownFiles, corpusStats, loadCorpusManifest, splitChunks } from '../src/corpus.js'

const tmp = mkdtempSync(join(tmpdir(), 'rag-test-corpus-'))
const docsDir = join(tmp, 'docs')

mkdirSync(docsDir, { recursive: true })

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function writeDoc(rel: string, content: string): string {
  const full = join(docsDir, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
  return full
}

function writeManifest(files: readonly string[]): void {
  writeFileSync(join(docsDir, 'corpus-manifest.json'), JSON.stringify({ files }, null, 2), 'utf-8')
}

function docIds(files: readonly string[]): string[] {
  return files.map((file) => relative(docsDir, file).split(sep).join('/'))
}

describe('corpus：语料收集与分块', () => {
  it('只收集显式白名单中的 Markdown，不递归扫描目录', () => {
    writeDoc('base/发电站机制.md', '# 发电站\n## 无人机\n正文A\n## 充能\n正文B\n')
    writeDoc('recommendation/组合知识库.md', '# 组合\n## 体系\n正文C\n')
    writeDoc('recommendation/实现TODO提示.md', '# TODO\n不应进入检索\n')
    writeDoc('SKILL.md', '# 技能手册\n不应进入检索\n')
    writeDoc('未登记.md', '# 未登记\n不应进入检索\n')
    writeManifest(['base/发电站机制.md', 'recommendation/组合知识库.md'])

    const files = collectMarkdownFiles(docsDir)
    expect(docIds(files)).toEqual(['base/发电站机制.md', 'recommendation/组合知识库.md'])
    expect(docIds(files)).not.toContain('recommendation/实现TODO提示.md')
    expect(docIds(files)).not.toContain('SKILL.md')
    expect(docIds(files)).not.toContain('未登记.md')
  })

  it('白名单文件集合与 corpusStats 一致', () => {
    const allowed = ['base/stats-a.md', 'references/stats-b.md']
    const files = allowed.map((file) => writeDoc(file, `# ${file}\n正文\n`))
    writeManifest(allowed)

    const collected = collectMarkdownFiles(docsDir)
    const stats = corpusStats(docsDir)
    const expectedSize = files.reduce((sum, file) => sum + statSync(file).size, 0)

    expect(stats).toEqual({ files: collected.length, size: expectedSize })
    expect(docIds(collected)).toEqual(allowed)
    expect(loadCorpusManifest(docsDir)).toEqual(allowed)
  })

  it('兼容 Windows 清单分隔符，并生成使用 / 的文档 ID', () => {
    const file = writeDoc('base/跨平台.md', '# 跨平台\n## 正文\n内容\n')
    writeManifest(['base\\跨平台.md'])
    const files = collectMarkdownFiles(docsDir)

    expect(files).toEqual([file])
    const chunk = splitChunks(files[0], docsDir).find((item) => item.heading === '正文')
    expect(chunk?.file).toBe('base/跨平台.md')
    expect(chunk?.id.startsWith('base/跨平台.md#')).toBe(true)
  })

  it('白名单条目缺失时快速失败并给出中文错误', () => {
    writeManifest(['base/不存在.md'])
    expect(() => collectMarkdownFiles(docsDir)).toThrowError('语料白名单项不存在：base/不存在.md')
  })

  it('白名单存在重复条目时快速失败', () => {
    writeDoc('base/重复.md', '# 重复\n正文\n')
    writeManifest(['base/重复.md', 'base/重复.md'])
    expect(() => collectMarkdownFiles(docsDir)).toThrowError('语料白名单存在重复条目：base/重复.md')
  })

  it('白名单路径越出语料根目录时快速失败', () => {
    writeManifest(['../越界.md'])
    expect(() => collectMarkdownFiles(docsDir)).toThrowError('语料白名单路径越出语料根目录：../越界.md')
  })

  it('白名单非 Markdown 条目时快速失败', () => {
    writeDoc('base/说明.txt', '不是 Markdown\n')
    writeManifest(['base/说明.txt'])
    expect(() => collectMarkdownFiles(docsDir)).toThrowError('语料白名单第 1 项不是 Markdown 文件：base/说明.txt')
  })

  it('SKILL.md 大小写变体也禁止登记', () => {
    writeDoc('SKILL.md', '# 技能手册\n不应进入检索\n')
    writeManifest(['skill.md'])
    expect(() => collectMarkdownFiles(docsDir)).toThrowError('语料白名单禁止登记 SKILL.md：skill.md')
  })

  it('按 ## 标题切分，front matter 与注释剔除', () => {
    const file = writeDoc(
      '散件速查.md',
      '---\nfrontmatter: true\n---\n# 散件干员速查\n[//]: # 模板注释\n## 贸易锚点\n焰狐龙梓兰 +10%\n## 办公室\n无',
    )
    const chunks = splitChunks(file, docsDir)
    const headings = chunks.map((c) => c.heading)
    expect(headings).toContain('贸易锚点')
    expect(headings).toContain('办公室')
    expect(headings).not.toContain('散件干员速查')
    const anchor = chunks.find((c) => c.heading === '贸易锚点')!
    expect(anchor.text).toContain('焰狐龙梓兰')
    expect(anchor.text).not.toContain('模板注释')
    // 标题后紧接正文，行号应指向正文实际行（跳过标题行与其后空行）
    expect(anchor.startLine).toBe(7)
    expect(anchor.endLine).toBe(7)
    // 检索锚点取 H1 体系名（文档无 operators frontmatter）
    expect(anchor.anchor).toBe('散件干员速查')
  })

  it('无标题文档归入（未分段）', () => {
    const file = writeDoc('无标题.md', '只有正文没有标题。\n第二行。\n')
    const chunks = splitChunks(file, docsDir)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].heading).toBe('（未分段）')
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].endLine).toBe(2)
    // 无 H1 / 无 operators → 不设锚点
    expect(chunks[0].anchor).toBeUndefined()
  })
})
