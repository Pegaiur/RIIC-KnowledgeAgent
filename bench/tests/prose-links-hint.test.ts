import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { collectMarkdownFiles, splitChunks } from '../src/corpus.js'
import { buildIndex } from '../src/retriever.js'
import { buildSectionDirectory, type SectionDirectory, type SectionEntry } from '../src/sections.js'
import { createKnowledgeToolExecutor } from '../src/tool-executor.js'
import type { ProseLinkIndex, ResolvedProseLink, ResolvedProseObject } from '../src/prose-links.js'
import type { DocChunk, ToolCall } from '../src/types.js'

/** 命中词只出现在甲子节正文：其它小节的正文与其无共同字，避免被 BM25 一并命中而进入显示范围。 */
const HIT_QUERY = '关键语'

const MAIN_DOC = [
  '# 甲文档',
  '',
  '甲文档前言。',
  '',
  '## 甲节',
  '',
  '甲节引导。',
  '',
  '### 甲子节',
  '',
  '关键语正文。',
  '',
  '### 甲另子节',
  '',
  '额外信息一段。',
  '',
  '## 甲远端节',
  '',
  '远端角落的记录。',
  '',
].join('\n')

const OTHER_DOC = [
  '# 乙文档',
  '',
  '## 乙节',
  '',
  '乙独有正文。',
  '',
].join('\n')

let root: string
let docsDir: string
let chunks: DocChunk[]
let directory: SectionDirectory

function sectionFor(heading: string): SectionEntry {
  const section = directory.sections.find((item) => item.heading === heading)
  if (!section) throw new Error(`测试语料缺少小节：${heading}`)
  return section
}

function objectFor(canonical: string): ResolvedProseObject {
  return { kind: 'card', ref: `operator:${canonical}`, canonical }
}

/** 用真实小节目录构造一条 v2 登记，避免直接依赖解析器实现。 */
function linkFor(heading: string, objects: ResolvedProseObject[], scope: 'section' | 'subtree' = 'section'): ResolvedProseLink {
  const section = sectionFor(heading)
  return {
    sectionId: section.sectionId,
    file: section.file,
    headingPath: [...section.ancestors, section.heading],
    occurrence: section.occurrence,
    scope,
    documentRoot: false,
    objects,
    unresolved: [],
  }
}

function indexFor(...links: ResolvedProseLink[]): ProseLinkIndex {
  return { links, bySection: new Map(links.map((link) => [link.sectionId, link])), issues: [] }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rag-prose-hint-'))
  docsDir = join(root, 'knowledge')
  mkdirSync(join(docsDir, 'base'), { recursive: true })
  writeFileSync(join(docsDir, 'base', '甲.md'), MAIN_DOC, 'utf-8')
  writeFileSync(join(docsDir, 'base', '乙.md'), OTHER_DOC, 'utf-8')
  writeFileSync(join(docsDir, 'corpus-manifest.json'), JSON.stringify({ files: ['base/甲.md', 'base/乙.md'] }), 'utf-8')
  chunks = collectMarkdownFiles(docsDir).flatMap((file) => splitChunks(file, docsDir))
  directory = buildSectionDirectory(docsDir)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function call(id: string, params: unknown): ToolCall {
  return { id, name: 'rag_search', arguments: JSON.stringify(params) }
}

function makeExecutor(links?: ProseLinkIndex, overrides: Partial<BenchConfig> = {}) {
  const config = { ...loadConfig(), retriever: 'bm25' as const, expandFulltext: false, ...overrides }
  return createKnowledgeToolExecutor({
    config,
    query: { id: 'PROSE-HINT', category: 'fact', question: HIT_QUERY },
    chunks,
    index: buildIndex(chunks),
    sections: directory,
    ...(links ? { links } : {}),
  }, 5)
}

describe('RAG 关联事实入口提示', () => {
  it('面向实际显示的命中节点与导航项给出可复制入口与 read 示例', async () => {
    const hit = sectionFor('甲子节')
    const nav = sectionFor('甲另子节')
    const index = indexFor(linkFor('甲子节', [objectFor('干员甲'), objectFor('干员乙')]), linkFor('甲另子节', [objectFor('干员丙')]))
    const item = (await makeExecutor(index).executeStep([call('a', { query: HIT_QUERY })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('【关联事实入口】')
    expect(item.data).toContain(`- ${hit.sectionId}｜base/甲.md｜标题路径：甲文档 > 甲节 > 甲子节｜关联 2 个对象｜示例：read(section_id="${hit.sectionId}")`)
    expect(item.data).toContain(`- ${nav.sectionId}｜base/甲.md｜标题路径：甲文档 > 甲节 > 甲另子节｜关联 1 个对象｜示例：read(section_id="${nav.sectionId}")`)
    expect(item.linkedEntries).toEqual([
      { sectionId: hit.sectionId, file: 'base/甲.md', objectCount: 2, written: true },
      { sectionId: nav.sectionId, file: 'base/甲.md', objectCount: 1, written: true },
    ])
    // 提示只做导航，不进入 chunk 注入记录，也不改变成功判定之外的口径。
    expect(item.injectedIds?.every((id) => !id.startsWith('sec-'))).toBe(true)
    expect(item.hitIds?.some((id) => id.includes('甲.md'))).toBe(true)
  })

  it('无关联索引或空关联时不出现提示，也不产生观测', async () => {
    const withoutLinks = (await makeExecutor().executeStep([call('a', { query: HIT_QUERY })])).results[0]!
    expect(withoutLinks.data).not.toContain('【关联事实入口】')
    expect(withoutLinks.linkedEntries).toBeUndefined()

    const emptyObjects = indexFor(linkFor('甲子节', []))
    const empty = (await makeExecutor(emptyObjects).executeStep([call('b', { query: HIT_QUERY })])).results[0]!
    expect(empty.data).not.toContain('【关联事实入口】')
    expect(empty.linkedEntries).toBeUndefined()
  })

  it('命中文件内未被显示的登记不再列出', async () => {
    const hit = sectionFor('甲子节')
    const far = sectionFor('甲远端节')
    const index = indexFor(linkFor('甲子节', [objectFor('干员甲')]), linkFor('甲远端节', [objectFor('干员丁')]))
    const item = (await makeExecutor(index).executeStep([call('a', { query: HIT_QUERY })])).results[0]!

    expect(item.data).toContain(`- ${hit.sectionId}｜`)
    expect(item.data).not.toContain(`- ${far.sectionId}｜`)
    expect(item.linkedEntries?.map((entry) => entry.sectionId)).toEqual([hit.sectionId])
  })

  it('其它文件的关联不进入提示', async () => {
    const hit = sectionFor('甲子节')
    const other = sectionFor('乙节')
    const index = indexFor(linkFor('甲子节', [objectFor('干员甲')]), linkFor('乙节', [objectFor('干员乙')]))
    const item = (await makeExecutor(index).executeStep([call('a', { query: HIT_QUERY })])).results[0]!

    expect(item.data).not.toContain(`- ${other.sectionId}｜`)
    expect(item.linkedEntries?.map((entry) => entry.sectionId)).toEqual([hit.sectionId])
  })

  it('按文件扩展原文时仍逐小节标明关联所属小节', async () => {
    const hit = sectionFor('甲子节')
    const index = indexFor(linkFor('甲子节', [objectFor('干员甲')]))
    const item = (await makeExecutor(index, { expandFulltext: true }).executeStep([call('a', { query: HIT_QUERY })])).results[0]!

    expect(item.data).toContain('原文扩展')
    expect(item.data).toContain(`- ${hit.sectionId}｜base/甲.md｜标题路径：甲文档 > 甲节 > 甲子节｜关联 1 个对象｜示例：read(section_id="${hit.sectionId}")`)
    expect(item.linkedEntries).toEqual([
      { sectionId: hit.sectionId, file: 'base/甲.md', objectCount: 1, written: true },
    ])
  })

  it('预算不足时含 ID 的提示行整行省略，观测标记未写入且不挤占正文', async () => {
    const hit = sectionFor('甲子节')
    const index = indexFor(linkFor('甲子节', [objectFor('干员甲'), objectFor('干员乙')]))
    const full = (await makeExecutor(index).executeStep([call('a', { query: HIT_QUERY })])).results[0]!.data
    const marker = '关联 2 个对象'
    const lineStart = full.lastIndexOf('\n', full.indexOf(marker)) + 1
    expect(lineStart).toBeGreaterThan(0)

    const tight = (await makeExecutor(index, { maxContextChars: lineStart }).executeStep([
      call('b', { query: HIT_QUERY }),
    ])).results[0]!

    expect(tight.data).not.toContain(marker)
    expect(tight.data).not.toContain('…（截断）')
    expect(tight.linkedEntries).toEqual([
      { sectionId: hit.sectionId, file: 'base/甲.md', objectCount: 2, written: false },
    ])
  })
})

describe('关联元数据不进入检索输入', () => {
  it('白名单 Markdown 收集不包含旁挂 JSON，正文分块与索引不受其影响', () => {
    const files = collectMarkdownFiles(join(process.cwd(), 'knowledge'))
    expect(files.some((file) => file.includes('prose-links'))).toBe(false)
    expect(chunks.every((chunk) => !chunk.file.includes('prose-links'))).toBe(true)
  })
})
