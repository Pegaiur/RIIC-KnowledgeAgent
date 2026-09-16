import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { collectMarkdownFiles, splitChunks } from '../src/corpus.js'
import { buildIndex } from '../src/retriever.js'
import { buildSectionDirectory, type SectionDirectory } from '../src/sections.js'
import { createKnowledgeToolExecutor, toolsForRetriever } from '../src/tool-executor.js'
import { getCardStore } from '../src/facts/store.js'
import type { ProseLinkIndex, ResolvedProseObject, UnresolvedProseObject } from '../src/prose-links.js'
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
  return { id, name: 'read_section', arguments: JSON.stringify(params) }
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

describe('read_section 显式展开关联事实', () => {
  it('损坏索引的失效定位不能在 linked 中伪装成未登记', async () => {
    const index: ProseLinkIndex = { links: [], bySection: new Map(), issues: ['未找到登记小节'] }
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节'), linked: true })])).results[0]!
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
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节'), linked: true })])).results[0]!
    expect(item.status).toBe('success')
    expect(item.data).toContain('第一份定义。')
    expect(item.data).toContain('第二份定义。')
    expect(item.data.match(/【概念：同名词】/gu)).toHaveLength(2)
    expect(item.linkedFacts?.deliveredConcepts).toEqual(['同名词', '同名词'])
    expect(item.injectedIds).toEqual([])
  })

  it('linked=true 只返回登记对象的记录卡，区分原文与关联事实且标明返回对象', async () => {
    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托'), objectFor('斥罪')])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节'), linked: true })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain(`【read_section｜关联事实】${sectionId('甲节')}`)
    expect(item.data).toContain('标题路径：甲文档 > 甲节')
    expect(item.data).toContain('关联对象：2 个｜已返回记录卡：2 张')
    expect(item.data).toContain('- operator:凯尔希·思衡托 → 凯尔希·思衡托')
    expect(item.data).toContain('【凯尔希·思衡托】')
    expect(item.data).toContain('【斥罪】')
    // 关联展开不重复返回原文正文，范围即登记对象。
    expect(item.data).not.toContain('甲节原文正文。')
    expect(item.hitIds).toEqual(['凯尔希·思衡托', '斥罪'])
    expect(item.injectedIds).toEqual(['凯尔希·思衡托', '斥罪'])
    expect(item.linkedFacts).toEqual({
      sectionId: sectionId('甲节'),
      requested: ['operator:凯尔希·思衡托', 'operator:斥罪'],
      delivered: ['凯尔希·思衡托', '斥罪'],
      deliveredConcepts: [],
      omitted: [],
    })
  })

  it('skill 引用经 linked 展开返回持有者整卡并保留设施/解锁/替换，同卡引用去重', async () => {
    const index = linkIndexFor('甲节', [
      { kind: 'card', ref: '办公室｜「天灾信使·β」｜普罗旺斯', canonical: '普罗旺斯', grantId: 'g-x', skillId: 's-x' },
      objectFor('普罗旺斯'),
    ])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节'), linked: true })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.hitIds).toEqual(['普罗旺斯'])
    expect(item.data).toContain('【普罗旺斯】')
    expect(item.data).toContain('设施：办公室')
    expect(item.data).toContain('替换「天灾信使·α」')
    expect(item.data).toContain('- operator:普罗旺斯（与已返回卡同卡，去重）')
  })

  it('概念引用按固定格式返回名称、来源与定义，并计入概念送达', async () => {
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
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节'), linked: true })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('【概念：心情落差】')
    expect(item.data).toContain('来源：guides/类别.md#官方术语与类别（条目序号 1）｜L12-13')
    expect(item.data).toContain('定义：- **心情落差**：示例定义原文。')
    expect(item.hitIds).toEqual(['凯尔希·思衡托'])
    expect(item.injectedIds).toEqual(['凯尔希·思衡托'])
    expect(item.linkedFacts).toMatchObject({ delivered: ['凯尔希·思衡托'], deliveredConcepts: ['心情落差'] })
  })

  it('默认（不带 linked）保持读取原文行为且不产生关联观测', async () => {
    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托')])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节') })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('【read_section】')
    expect(item.data).toContain('甲节原文正文。')
    expect(item.data).not.toContain('关联事实')
    expect(item.linkedFacts).toBeUndefined()
  })

  it('无登记关联的小节按空结果处理，不扣成功额度、不猜测其它对象', async () => {
    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托')])
    const executor = makeExecutor(index)
    const item = (await executor.executeStep([call('a', { section_id: sectionId('空关联节'), linked: true })])).results[0]!

    expect(item.status).toBe('empty')
    expect(item.data).toContain('没有登记可展开的关联事实')
    expect(item.hitIds).toEqual([])
    expect(item.linkedFacts).toEqual({ sectionId: sectionId('空关联节'), requested: [], delivered: [], deliveredConcepts: [], omitted: [] })
    expect(executor.snapshot()).toMatchObject({ successUsed: 0, attemptUsed: 1 })
  })

  it('登记对象取不到记录卡时显式报告，其它合法对象仍返回', async () => {
    const store = getCardStore()
    const original = store.byCanonical.get.bind(store.byCanonical)
    vi.spyOn(store.byCanonical, 'get').mockImplementation((key: string) => (key === '斥罪' ? undefined : original(key)))

    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托'), objectFor('斥罪')])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节'), linked: true })])).results[0]!

    expect(item.status).toBe('error')
    expect(item.hitIds).toEqual(['凯尔希·思衡托'])
    expect(item.linkedFacts?.omitted).toEqual([{ ref: 'operator:斥罪', reason: '记录卡未找到' }])
    expect(item.data).toContain('未返回：operator:斥罪（记录卡未找到）')
  })

  it('解析失败的登记引用进入 requested 与 omitted，合法对象仍返回', async () => {
    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托')], [
      { ref: '办公室｜「不存在技能」｜凯尔希·思衡托', reason: '未找到关联技能' },
    ])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节'), linked: true })])).results[0]!

    expect(item.status).toBe('error')
    expect(item.hitIds).toEqual(['凯尔希·思衡托'])
    expect(item.data).toContain('关联对象：2 个｜已返回记录卡：1 张')
    expect(item.data).toContain('未返回：办公室｜「不存在技能」｜凯尔希·思衡托（未找到关联技能）')
    expect(item.linkedFacts).toEqual({
      sectionId: sectionId('甲节'),
      requested: ['operator:凯尔希·思衡托', '办公室｜「不存在技能」｜凯尔希·思衡托'],
      delivered: ['凯尔希·思衡托'],
      deliveredConcepts: [],
      omitted: [{ ref: '办公室｜「不存在技能」｜凯尔希·思衡托', reason: '未找到关联技能' }],
    })
  })

  it('仅有失效引用的小节报告未返回原因，不误报为无关联', async () => {
    const index = linkIndexFor('甲节', [], [{ ref: 'operator:不存在的干员', reason: '关联干员不在名册' }])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('甲节'), linked: true })])).results[0]!

    expect(item.status).toBe('error')
    expect(item.data).not.toContain('没有登记可展开的关联事实')
    expect(item.data).toContain('未返回：operator:不存在的干员（关联干员不在名册）')
    expect(item.linkedFacts?.requested).toEqual(['operator:不存在的干员'])
    expect(item.linkedFacts?.delivered).toEqual([])
    expect(item.linkedFacts?.omitted).toEqual([{ ref: 'operator:不存在的干员', reason: '关联干员不在名册' }])
  })

  it('linked 与 offset 互斥；linked 必须是布尔值；未知字段拒绝', async () => {
    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托')])
    const executor = makeExecutor(index)
    const invalid = [
      { section_id: sectionId('甲节'), linked: true, offset: 0 },
      { section_id: sectionId('甲节'), linked: 'true' },
      { section_id: sectionId('甲节'), linked: false, offset: 0, extra: 1 },
    ]
    for (const params of invalid) {
      const step = await executor.executeStep([call('bad', params)])
      expect(step.results[0]).toMatchObject({ status: 'invalid_params', executed: false })
    }
  })

  it('linked=false 等同默认读原文，并允许 offset 分页', async () => {
    const index = linkIndexFor('甲节', [objectFor('凯尔希·思衡托')])
    const item = (await makeExecutor(index).executeStep([
      call('a', { section_id: sectionId('甲节'), linked: false, offset: 0 }),
    ])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('【read_section】')
    expect(item.data).toContain('甲节原文正文。')
    expect(item.linkedFacts).toBeUndefined()
  })
})

describe('read_section 关联事实的 schema', () => {
  it('声明 linked 布尔参数，与 section_id/offset 并列', () => {
    const tools = toolsForRetriever('hybrid', 3)
    const readSection = tools.find((tool) => (tool.function as { name: string }).name === 'read_section')!
    const fn = readSection.function as { description: string; parameters: { properties: Record<string, Record<string, unknown>>; required: string[] } }
    expect(Object.keys(fn.parameters.properties)).toEqual(['section_id', 'offset', 'linked'])
    expect(fn.parameters.properties.linked).toMatchObject({ type: 'boolean' })
    expect(fn.parameters.required).toEqual(['section_id'])
    expect(fn.description).toContain('linked')
  })
})
