import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { collectMarkdownFiles, splitChunks } from '../src/corpus.js'
import { buildIndex } from '../src/retriever.js'
import { buildSectionDirectory, type SectionDirectory } from '../src/sections.js'
import { createKnowledgeToolExecutor } from '../src/tool-executor.js'
import type { ProseLinkIndex, ResolvedProseObject } from '../src/prose-links.js'
import type { DocChunk, ToolCall } from '../src/types.js'

const MAIN_DOC = [
  '# 甲文档',
  '',
  '甲文档前言。',
  '',
  '## 甲节',
  '',
  '甲关键字正文。',
  '',
  '## 甲空节',
  '',
  '甲空正文。',
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

function objectFor(canonical: string): ResolvedProseObject {
  return { ref: `operator:${canonical}`, canonical }
}

/** 用真实小节目录构造关联索引，避免直接依赖解析器实现。 */
function linkIndexFor(heading: string, objects: ResolvedProseObject[]): ProseLinkIndex {
  const section = directory.sections.find((item) => item.heading === heading)!
  const link = {
    sectionId: section.sectionId,
    file: section.file,
    headingPath: [...section.ancestors, section.heading],
    occurrence: section.occurrence,
    objects,
    unresolved: [],
  }
  return { links: [link], bySection: new Map([[section.sectionId, link]]), issues: [] }
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
    query: { id: 'PROSE-HINT', category: 'fact', question: '甲关键字' },
    chunks,
    index: buildIndex(chunks),
    sections: directory,
    ...(links ? { links } : {}),
  }, 5)
}

describe('RAG 关联事实入口提示', () => {
  it('对登记了关联的命中小节给出可调用入口，并记录提示观测', async () => {
    const index = linkIndexFor('甲节', [objectFor('干员甲'), objectFor('干员乙')])
    const item = (await makeExecutor(index).executeStep([call('a', { query: '甲关键字' })])).results[0]!
    const section = directory.sections.find((item) => item.heading === '甲节')!

    expect(item.status).toBe('success')
    expect(item.data).toContain('【关联事实入口】')
    expect(item.data).toContain(`- ${section.sectionId}｜base/甲.md｜标题路径：甲文档 > 甲节｜关联 2 个对象`)
    expect(item.linkedEntries).toEqual([
      { sectionId: section.sectionId, file: 'base/甲.md', objectCount: 2, written: true },
    ])
    // 提示只做导航，不进入 chunk 注入记录，也不改变成功判定之外的口径。
    expect(item.injectedIds?.every((id) => !id.startsWith('sec-'))).toBe(true)
    expect(item.hitIds?.some((id) => id.includes('甲.md'))).toBe(true)
  })

  it('无关联索引或空关联时不出现提示，也不产生观测', async () => {
    const withoutLinks = (await makeExecutor().executeStep([call('a', { query: '甲关键字' })])).results[0]!
    expect(withoutLinks.data).not.toContain('【关联事实入口】')
    expect(withoutLinks.linkedEntries).toBeUndefined()

    const emptyObjects = linkIndexFor('甲节', [])
    const empty = (await makeExecutor(emptyObjects).executeStep([call('b', { query: '甲关键字' })])).results[0]!
    expect(empty.data).not.toContain('【关联事实入口】')
    expect(empty.linkedEntries).toBeUndefined()
  })

  it('只提示实际命中文件内的关联小节，不含其它文件的关联', async () => {
    const section = directory.sections.find((item) => item.heading === '甲节')!
    const other = directory.sections.find((item) => item.heading === '乙节')!
    const index: ProseLinkIndex = {
      links: [
        { sectionId: section.sectionId, file: 'base/甲.md', headingPath: ['甲文档', '甲节'], occurrence: 1, objects: [objectFor('干员甲')], unresolved: [] },
        { sectionId: other.sectionId, file: 'base/乙.md', headingPath: ['乙文档', '乙节'], occurrence: 1, objects: [objectFor('干员乙')], unresolved: [] },
      ],
      bySection: new Map(),
      issues: [],
    }
    const item = (await makeExecutor(index).executeStep([call('a', { query: '甲关键字' })])).results[0]!

    expect(item.data).toContain(section.sectionId)
    expect(item.data).not.toContain(`- ${other.sectionId}｜`)
    expect(item.linkedEntries?.map((entry) => entry.sectionId)).toEqual([section.sectionId])
  })

  it('按文件扩展原文时仍逐小节标明关联所属小节', async () => {
    const index = linkIndexFor('甲节', [objectFor('干员甲')])
    const item = (await makeExecutor(index, { expandFulltext: true }).executeStep([call('a', { query: '甲关键字' })])).results[0]!
    const section = directory.sections.find((item) => item.heading === '甲节')!

    expect(item.data).toContain('原文扩展')
    expect(item.data).toContain(`- ${section.sectionId}｜base/甲.md｜标题路径：甲文档 > 甲节｜关联 1 个对象`)
    expect(item.linkedEntries).toEqual([
      { sectionId: section.sectionId, file: 'base/甲.md', objectCount: 1, written: true },
    ])
  })

  it('预算不足时含 ID 的提示行整行省略，观测标记未写入且不挤占正文', async () => {
    const index = linkIndexFor('甲节', [objectFor('干员甲'), objectFor('干员乙')])
    const full = (await makeExecutor(index).executeStep([call('a', { query: '甲关键字' })])).results[0]!.data
    const marker = '关联 2 个对象'
    const lineStart = full.lastIndexOf('\n', full.indexOf(marker)) + 1
    expect(lineStart).toBeGreaterThan(0)

    const tight = (await makeExecutor(index, { maxContextChars: lineStart }).executeStep([
      call('b', { query: '甲关键字' }),
    ])).results[0]!

    expect(tight.data).not.toContain(marker)
    expect(tight.data).not.toContain('…（截断）')
    expect(tight.linkedEntries).toEqual([
      { sectionId: directory.sections.find((item) => item.heading === '甲节')!.sectionId, file: 'base/甲.md', objectCount: 2, written: false },
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
