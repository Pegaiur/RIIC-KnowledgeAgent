import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { collectMarkdownFiles, loadCorpus, splitChunks } from '../src/corpus.js'
import { buildIndex } from '../src/retriever.js'
import { buildSectionDirectory, type SectionDirectory } from '../src/sections.js'
import { createKnowledgeToolExecutor } from '../src/tool-executor.js'
import { getCardStore } from '../src/facts/store.js'
import { buildProseLinkIndex, type ProseLinkIndex, type ResolvedProseObject, type UnresolvedProseObject } from '../src/prose-links.js'
import type { DocChunk, ToolCall } from '../src/types.js'

const DOC = [
  '# 甲文档',
  '',
  '## 甲节',
  '',
  '甲节原文正文。',
  '',
  '## 空关联节',
  '',
  '空关联节正文。',
  '',
].join('\n')

let root: string
let docsDir: string
let chunks: DocChunk[]
let directory: SectionDirectory

function objectFor(canonical: string): ResolvedProseObject {
  return { kind: 'card', ref: `operator:${canonical}`, canonical }
}

/** 用真实小节目录构造关联索引；canonical 取仓库真实记录卡，便于复用真实 facts store。 */
function linkIndexFor(heading: string, objects: ResolvedProseObject[], unresolved: UnresolvedProseObject[] = []): ProseLinkIndex {
  const section = directory.sections.find((item) => item.heading === heading)!
  const link = {
    sectionId: section.sectionId,
    file: section.file,
    headingPath: [...section.ancestors, section.heading],
    occurrence: section.occurrence,
    scope: 'section' as const,
    documentRoot: false,
    objects,
    unresolved,
  }
  return { links: [link], bySection: new Map([[section.sectionId, link]]), issues: [] }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rag-prose-read-'))
  docsDir = join(root, 'knowledge')
  mkdirSync(join(docsDir, 'base'), { recursive: true })
  writeFileSync(join(docsDir, 'base', '甲.md'), DOC, 'utf-8')
  writeFileSync(join(docsDir, 'corpus-manifest.json'), JSON.stringify({ files: ['base/甲.md'] }), 'utf-8')
  chunks = collectMarkdownFiles(docsDir).flatMap((file) => splitChunks(file, docsDir))
  directory = buildSectionDirectory(docsDir)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(root, { recursive: true, force: true })
})

function call(id: string, params: unknown): ToolCall {
  return { id, name: 'read', arguments: JSON.stringify(params) }
}

function makeExecutor(links?: ProseLinkIndex, overrides: Partial<BenchConfig> = {}) {
  const config = { ...loadConfig(), retriever: 'bm25' as const, expandFulltext: false, ...overrides }
  return createKnowledgeToolExecutor({
    config,
    query: { id: 'PROSE-READ', category: 'fact', question: '甲节' },
    chunks,
    index: buildIndex(chunks),
    sections: directory,
    ...(links ? { links } : {}),
  }, 5)
}

function sectionId(heading: string): string {
  return directory.sections.find((item) => item.heading === heading)!.sectionId
}

describe('read 关联事实送达', () => {
  it('读取贸易站散件范围时同时送达候选的精确技能', async () => {
    const corpusDir = join(process.cwd(), 'knowledge')
    const corpus = loadCorpus(corpusDir)
    const sections = buildSectionDirectory(corpusDir)
    const links = buildProseLinkIndex({ root: process.cwd() })
    const section = sections.sections.find((item) => item.file === 'guides/用人/高效率散件.md' && item.heading === '贸易站散件')!
    const executor = createKnowledgeToolExecutor({
      config: { ...loadConfig(), retriever: 'hybrid', expandFulltext: false },
      query: { id: 'PROSE-READ', category: 'fact', question: '会客室等级改变后如何计算伺夜的技能加成？' },
      chunks: corpus,
      index: buildIndex(corpus),
      sections,
      links,
    }, 5)
    const item = (await executor.executeStep([call('trade', { section_id: section.sectionId })])).results[0]!
    expect(item.status).toBe('success')
    expect(item.data).toContain('会客室每级额外提供5%获取效率')
    expect(item.readDelivery?.deliveredObjects?.filter((object) => object.kind === 'card').map((object) => object.canonical).sort())
      .toEqual(['吉星', '伺夜', '空弦'].sort())
    expect(item.readDelivery?.factsPage?.complete).toBe(true)
  })

  it('损坏索引的失效定位在 read 中显式报错，不伪装成未登记', async () => {
    const index: ProseLinkIndex = { links: [], bySection: new Map(), issues: ['未找到登记小节'] }
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节') })])).results[0]!
    expect(item.status).toBe('error')
    expect(item.data).toContain('未找到登记小节')
    expect(item.data).not.toContain('没有登记')
  })

  it('不同标题出现序号的同名概念分别送达，同一精确位置只送一次', async () => {
    const concept = {
      kind: 'concept' as const, ref: 'concept:guides/类别.md#重复｜同名词', name: '同名词',
      file: 'guides/类别.md', headingPath: ['重复'], occurrence: 1, term: '同名词', termOccurrence: 1,
      startLine: 2, endLine: 2, definition: '- **同名词**：第一份定义。',
    }
    const second = { ...concept, occurrence: 2, startLine: 6, endLine: 6, definition: '- **同名词**：第二份定义。' }
    const index = linkIndexFor('甲节', [concept, second, second])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节') })])).results[0]!
    expect(item.status).toBe('success')
    expect(item.data).toContain('第一份定义。')
    expect(item.data).toContain('第二份定义。')
    expect(item.data.match(/【概念：同名词】/gu)).toHaveLength(2)
    expect(item.injectedIds).toEqual([])
    expect(item.readDelivery?.deliveredObjects).toHaveLength(2)
  })

  it('同一页同时返回原文与登记记录卡，命中与注入只记记录卡', async () => {
    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托'), objectFor('斥罪')])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节') })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('甲节原文正文。')
    expect(item.data).toContain('【凯尔希·思衡托】')
    expect(item.data).toContain('【斥罪】')
    expect(item.hitIds).toEqual(['凯尔希·思衡托', '斥罪'])
    expect(item.injectedIds).toEqual(['凯尔希·思衡托', '斥罪'])
    expect(item.readDelivery?.deliveredObjects).toEqual([
      { kind: 'card', canonical: '凯尔希·思衡托', projection: 'full', grantIds: expect.any(Array), origins: [{ sectionId: sectionId('甲节'), objectIndex: 0 }] },
      { kind: 'card', canonical: '斥罪', projection: 'full', grantIds: expect.any(Array), origins: [{ sectionId: sectionId('甲节'), objectIndex: 1 }] },
    ])
  })

  it('登记对象取不到记录卡时显式报告，不返回其余对象的半页结果', async () => {
    const store = getCardStore()
    const original = store.byCanonical.get.bind(store.byCanonical)
    vi.spyOn(store.byCanonical, 'get').mockImplementation((key: string) => (key === '斥罪' ? undefined : original(key)))

    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托'), objectFor('斥罪')])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节') })])).results[0]!

    expect(item.status).toBe('error')
    expect(item.data).toContain('记录卡缺失')
    expect(item.data).toContain('斥罪')
    expect(item.hitIds).toEqual([])
    expect(item.readDelivery?.deliveredObjects).toBeUndefined()
  })

  it('解析失败的登记引用在装配层就被拒绝，read 显式报错', async () => {
    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托')], [
      { ref: '办公室｜「不存在技能」｜凯尔希·思衡托', reason: '未找到关联技能' },
    ])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节') })])).results[0]!

    expect(item.status).toBe('error')
    expect(item.data).toContain('未找到关联技能')
  })

  it('无登记关联的小节只返回原文，不猜测其它对象', async () => {
    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托')])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('空关联节') })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('空关联节正文。')
    expect(item.data).toContain('（无本页内容）')
    expect(item.hitIds).toEqual([])
    expect(item.readDelivery?.factsPage).toMatchObject({ total: 0, returned: 0 })
  })

  it('概念引用按固定格式返回名称、来源与定义', async () => {
    const index = linkIndexFor('甲节', [
      objectFor('凯尔希·思衡托'),
      {
        kind: 'concept',
        ref: 'concept:guides/类别.md#官方术语与类别｜心情落差',
        name: '心情落差',
        file: 'guides/类别.md',
        headingPath: ['官方术语与类别'],
        occurrence: 1,
        term: '心情落差',
        termOccurrence: 1,
        startLine: 12,
        endLine: 13,
        definition: '- **心情落差**：示例定义原文。',
      },
    ])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节') })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('【概念：心情落差】')
    expect(item.data).toContain('来源：guides/类别.md#官方术语与类别（条目序号 1）｜L12-13')
    expect(item.data).toContain('定义：- **心情落差**：示例定义原文。')
    expect(item.hitIds).toEqual(['凯尔希·思衡托'])
    expect(item.injectedIds).toEqual(['凯尔希·思衡托'])
    expect(item.readDelivery?.deliveredObjects).toHaveLength(2)
  })

  it('无小节目录时明确返回本运行无法读取', async () => {
    const config = { ...loadConfig(), retriever: 'bm25' as const, expandFulltext: false }
    const executor = createKnowledgeToolExecutor({
      config,
      query: { id: 'PROSE-READ', category: 'fact', question: '甲节' },
      chunks,
      index: buildIndex(chunks),
    }, 5)
    const item = (await executor.executeStep([call('a', { section_id: 'sec-任意' })])).results[0]!
    expect(item).toMatchObject({ status: 'empty', executed: true })
    expect(item.data).toContain('未启用小节阅读')
  })
})
