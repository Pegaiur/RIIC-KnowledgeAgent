/**
 * read 工具契约（ADR-022 决策 1–3、6）：双偏移分页、固定分区、容量边界与送达观测。
 * 这些用例只观察工具返回值与观测记录，不重写实现求期望值。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { collectMarkdownFiles, splitChunks } from '../src/corpus.js'
import { buildIndex } from '../src/retriever.js'
import { buildSectionDirectory, type SectionDirectory } from '../src/sections.js'
import { TOOL_SCHEMA_VERSION, createKnowledgeToolExecutor, toolsForRetriever } from '../src/tool-executor.js'
import { getCardStore, serializeCard, skillProjection } from '../src/facts/store.js'
import type { RecordCard } from '../src/facts/card.js'
import type { ProseLinkIndex, ResolvedProseObject } from '../src/prose-links.js'
import type { DocChunk, ToolCall } from '../src/types.js'

const LONG_LINE = '甲'.repeat(100)
const LONG_BODY = Array.from({ length: 80 }, () => LONG_LINE).join('\n')
const EMOJI_BODY = '😀'.repeat(400)

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
  '## 长节',
  '',
  LONG_BODY,
  '',
  '## 代理节',
  '',
  EMOJI_BODY,
  '',
  '## 空节',
  '',
  '## 有正文',
  '',
  '有正文内容。',
  '',
].join('\n')

/** 多并列小节文档：用于验证导航省略数量（同级条目超过导航上限）。 */
const SIBLINGS = Array.from({ length: 12 }, (_, index) => `## 并列节${index + 1}\n\n并列节${index + 1}正文。\n`)
const SIBLINGS_DOC = ['# 多节文档', '', ...SIBLINGS].join('\n')

/** 重复标题文档：同文件同标题路径出现两次，用于验证登记来源显示不被合并。 */
const DUPLICATE_DOC = ['# 重复文档', '', '## 重复节', '', '第一处重复小节。', '', '## 重复节', '', '第二处重复小节。', ''].join('\n')

let root: string
let docsDir: string
let chunks: DocChunk[]
let directory: SectionDirectory

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rag-read-'))
  docsDir = join(root, 'knowledge')
  mkdirSync(join(docsDir, 'base'), { recursive: true })
  writeFileSync(join(docsDir, 'base', '甲.md'), DOC, 'utf-8')
  writeFileSync(join(docsDir, 'base', '乙.md'), SIBLINGS_DOC, 'utf-8')
  writeFileSync(join(docsDir, 'base', '丙.md'), DUPLICATE_DOC, 'utf-8')
  writeFileSync(join(docsDir, 'corpus-manifest.json'), JSON.stringify({ files: ['base/甲.md', 'base/乙.md', 'base/丙.md'] }), 'utf-8')
  chunks = collectMarkdownFiles(docsDir).flatMap((file) => splitChunks(file, docsDir))
  directory = buildSectionDirectory(docsDir)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function call(id: string, params: unknown, name = 'read'): ToolCall {
  return { id, name, arguments: JSON.stringify(params) }
}

function makeExecutor(links?: ProseLinkIndex, overrides: Partial<BenchConfig> = {}, successLimit = 5) {
  const config = { ...loadConfig(), retriever: 'bm25' as const, expandFulltext: false, ...overrides }
  return createKnowledgeToolExecutor({
    config,
    query: { id: 'READ', category: 'fact', question: '甲节' },
    chunks,
    index: buildIndex(chunks),
    sections: directory,
    ...(links ? { links } : {}),
  }, successLimit)
}

function sectionId(heading: string): string {
  return directory.sections.find((item) => item.heading === heading)!.sectionId
}

function bodyOf(heading: string): string {
  return directory.sections.find((item) => item.heading === heading)!.body
}

/** 按固定分区解析 read 输出；分区名固定，正文里的卡片标题不会参与拆分。 */
function parseRead(data: string): {
  range: string
  meta: Record<string, unknown>
  body: string
  facts: string
  nav?: string
} {
  const segments = data.split(/\n(?=【(?:阅读范围|分页|原文|关联事实|导航)】)/u)
  let range = ''
  let meta: Record<string, unknown> | undefined
  let body: string | undefined
  let facts: string | undefined
  let nav: string | undefined
  for (const segment of segments) {
    if (segment.startsWith('【阅读范围】')) range = segment.slice('【阅读范围】'.length)
    else if (segment.startsWith('【分页】')) meta = JSON.parse(segment.slice('【分页】'.length)) as Record<string, unknown>
    else if (segment.startsWith('【原文】\n')) body = segment.slice('【原文】\n'.length)
    else if (segment.startsWith('【关联事实】\n')) facts = segment.slice('【关联事实】\n'.length)
    else if (segment.startsWith('【导航】\n')) nav = segment.slice('【导航】\n'.length)
  }
  if (meta === undefined || body === undefined || facts === undefined) {
    throw new Error(`无法解析 read 输出：${data}`)
  }
  return { range, meta, body, facts, ...(nav === undefined ? {} : { nav }) }
}

function skillLineCount(facts: string): number {
  return facts.split('\n').filter((line) => line.startsWith('- 【设施：')).length
}

function objectFor(canonical: string): ResolvedProseObject {
  return { kind: 'card', ref: `operator:${canonical}`, canonical }
}

function linkIndexFor(heading: string, objects: ResolvedProseObject[]): ProseLinkIndex {
  const section = directory.sections.find((item) => item.heading === heading)!
  const link = {
    sectionId: section.sectionId,
    file: section.file,
    headingPath: [...section.ancestors, section.heading],
    occurrence: section.occurrence,
    scope: 'section' as const,
    documentRoot: false,
    objects,
    unresolved: [],
  }
  return { links: [link], bySection: new Map([[section.sectionId, link]]), issues: [] }
}

/** 取若干真实记录卡，供宽关联分页用例使用。 */
function realCanonicals(count: number): string[] {
  return getCardStore().cards.slice(0, count).map((card) => card.canonical)
}

describe('read：工具定义与旧名退役', () => {
  it('以 read 取代 read_section，声明 section_id、offset 与 facts_offset', () => {
    const tools = toolsForRetriever('hybrid', 3)
    expect(tools.map((tool) => (tool.function as { name: string }).name))
      .toEqual(['rag_search', 'facts_search', 'read'])
    const fn = tools.find((tool) => (tool.function as { name: string }).name === 'read')!.function as {
      description: string
      parameters: { properties: Record<string, unknown>; required: string[] }
    }
    expect(Object.keys(fn.parameters.properties)).toEqual(['section_id', 'offset', 'facts_offset'])
    expect(fn.parameters.required).toEqual(['section_id'])
    expect(fn.description).toContain('facts_offset')
    expect(fn.description).not.toContain('linked')
    expect(TOOL_SCHEMA_VERSION).toBe(15)
  })

  it('bm25 也保留 read', () => {
    expect(toolsForRetriever('bm25', 3).map((tool) => (tool.function as { name: string }).name))
      .toEqual(['rag_search', 'read'])
  })

  it('旧工具名 read_section 按未知工具拒绝并给出新工具名，不静默改译', async () => {
    const item = (await makeExecutor().executeStep([
      call('a', { section_id: sectionId('甲节') }, 'read_section'),
    ])).results[0]!
    expect(item).toMatchObject({ status: 'unknown_operation', executed: false })
    expect(item.data).toContain('read_section')
    expect(item.data).toContain('read')
    expect(item.readDelivery).toBeUndefined()
  })
})

describe('read：参数校验', () => {
  it('缺 section_id、未知字段、非法偏移与取消的 linked 都是 invalid_params 且不执行', async () => {
    const id = sectionId('甲节')
    const executor = makeExecutor()
    const cases: unknown[] = [
      {},
      { section_id: '' },
      { section_id: id, linked: true },
      { section_id: id, offset: -1 },
      { section_id: id, offset: 1.5 },
      { section_id: id, offset: '0' },
      { section_id: id, facts_offset: -1 },
      { section_id: id, facts_offset: 2.5 },
      { section_id: id, offset: null },
    ]
    for (const params of cases) {
      const step = await executor.executeStep([call('bad', params)])
      expect(step.results[0]).toMatchObject({ status: 'invalid_params', executed: false })
    }
    expect(executor.snapshot()).toMatchObject({ successUsed: 0, attemptUsed: cases.length, executed: 0 })
  })

  it('未知 ID 返回 empty 并提示使用当前返回的 ID，不做模糊搜索', async () => {
    const item = (await makeExecutor().executeStep([call('a', { section_id: 'sec-不存在' })])).results[0]!
    expect(item).toMatchObject({ status: 'empty', executed: true })
    expect(item.data).toContain('没有该小节')
    expect(item.readDelivery).toMatchObject({ status: 'empty', sectionId: 'sec-不存在' })
  })

  it('未知 ID 的提示也遵守 maxContextChars，超预算的回显 ID 被截断', async () => {
    const longId = `sec-${'x'.repeat(2000)}`
    const item = (await makeExecutor(undefined, { maxContextChars: 400 }).executeStep([
      call('a', { section_id: longId }),
    ])).results[0]!
    expect(item.status).toBe('empty')
    expect(item.data.length).toBeLessThanOrEqual(400)
    expect(item.data).toContain('没有该小节')
    expect(item.data).toContain('（已截断）')
    expect(item.readDelivery).toMatchObject({ status: 'empty', sectionId: longId, resultChars: item.data.length })
  })

  it('参数包含空字符串键时同样按未知参数拒绝', async () => {
    const executor = makeExecutor()
    const step = await executor.executeStep([
      call('bad', { section_id: sectionId('甲节'), '': 'x' }),
    ])
    expect(step.results[0]).toMatchObject({ status: 'invalid_params', executed: false })
    expect(executor.snapshot()).toMatchObject({ successUsed: 0, executed: 0 })
  })

  it('offset 超过正文长度、facts_offset 超过对象数都是 invalid_params', async () => {
    const id = sectionId('甲节')
    const bodyLength = bodyOf('甲节').length
    const executor = makeExecutor()
    const overflow = await executor.executeStep([call('over', { section_id: id, offset: bodyLength + 1 })])
    expect(overflow.results[0]).toMatchObject({ status: 'invalid_params', executed: false })

    const index = linkIndexFor('甲节', [objectFor(realCanonicals(1)[0]!)])
    const withFacts = await makeExecutor(index).executeStep([
      call('facts-over', { section_id: sectionId('甲节'), facts_offset: 2 }),
    ])
    expect(withFacts.results[0]).toMatchObject({ status: 'invalid_params', executed: false })
  })

  it('offset 不能落在 UTF-16 代理对中间', async () => {
    const id = sectionId('代理节')
    const item = (await makeExecutor().executeStep([call('a', { section_id: id, offset: 1 })])).results[0]!
    expect(item).toMatchObject({ status: 'invalid_params', executed: false })
    expect(item.data).toContain('代理对')
  })
})

describe('read：分区格式与分页元数据', () => {
  it('固定分区顺序与完整分页字段，读完时 next_call=null', async () => {
    const id = sectionId('甲节')
    const item = (await makeExecutor().executeStep([call('a', { section_id: id })])).results[0]!

    expect(item.status).toBe('success')
    const parsed = parseRead(item.data)
    expect(Object.keys(parsed.meta)).toEqual([
      'section_id', 'offset', 'next_offset', 'body_complete', 'body_total_chars',
      'facts_offset', 'next_facts_offset', 'facts_complete', 'facts_total', 'facts_returned',
      'facts_result_version', 'complete', 'next_call',
    ])
    expect(parsed.meta).toMatchObject({
      section_id: id,
      offset: 0,
      next_offset: null,
      body_complete: true,
      body_total_chars: bodyOf('甲节').length,
      facts_offset: 0,
      next_facts_offset: null,
      facts_complete: true,
      facts_total: 0,
      facts_returned: 0,
      facts_result_version: 8,
      complete: true,
      next_call: null,
    })
    expect(parsed.range).toContain('base/甲.md')
    expect(parsed.range).toContain('标题路径：甲文档 > 甲节')
    expect(parsed.range).toContain(`section_id：${id}`)
    expect(parsed.range).toContain('原文行范围：L5-5')
    expect(parsed.body).toBe('甲节原文正文。')
    expect(parsed.facts).toBe('（无本页内容）')
    expect(item.hitIds).toEqual([])
    expect(item.injectedIds).toEqual([])
  })

  it('offset 等于正文长度且无关联事实时只返回完成元数据（empty，不扣成功额度）', async () => {
    const id = sectionId('甲节')
    const executor = makeExecutor()
    const exact = await executor.executeStep([
      call('end', { section_id: id, offset: bodyOf('甲节').length }),
    ])
    const item = exact.results[0]!
    expect(item).toMatchObject({ status: 'empty', executed: true })
    const parsed = parseRead(item.data)
    expect(parsed.body).toBe('（无本页内容）')
    expect(parsed.meta).toMatchObject({ offset: bodyOf('甲节').length, next_offset: null, complete: true, next_call: null })
    expect(executor.snapshot()).toMatchObject({ successUsed: 0, attemptUsed: 1 })
  })

  it('空正文小节返回 empty，有关联事实时仍算送达', async () => {
    const empty = sectionId('空节')
    const bodyOnly = (await makeExecutor().executeStep([call('a', { section_id: empty })])).results[0]!
    expect(bodyOnly).toMatchObject({ status: 'empty', executed: true })

    const index = linkIndexFor('空节', [objectFor(realCanonicals(1)[0]!)])
    const withFacts = (await makeExecutor(index).executeStep([call('b', { section_id: empty })])).results[0]!
    expect(withFacts.status).toBe('success')
    expect(withFacts.hitIds).toEqual(realCanonicals(1))
  })

  it('导航省略数量包含被导航上限截断的条目，不只看预算剩余', async () => {
    const id = sectionId('并列节1')
    const item = (await makeExecutor().executeStep([call('a', { section_id: id })])).results[0]!
    const parsed = parseRead(item.data)

    expect(parsed.nav).toBeDefined()
    // 同级共 11 条，导航上限 8：被上限截断的 3 条也必须计入省略数。
    expect(parsed.nav).toContain('（省略 3 项）')
  })

  it('长正文连续分页：每页不超过 6000 字符，续读无中段丢失且 next_call 可复制', async () => {
    const id = sectionId('长节')
    const executor = makeExecutor()
    let offset = 0
    let collected = ''
    let pages = 0
    for (let page = 0; page < 12; page++) {
      const item = (await executor.executeStep([call(`p${page}`, { section_id: id, offset })])).results[0]!
      expect(item.status).toBe('success')
      // 成功页必须整体遵守 maxContextChars（元数据、来源、原文与卡片合计）。
      expect(item.data.length).toBeLessThanOrEqual(loadConfig().maxContextChars)
      const parsed = parseRead(item.data)
      expect(parsed.body.length).toBeLessThanOrEqual(6000)
      expect(parsed.meta.offset).toBe(offset)
      collected += parsed.body
      pages++
      if (parsed.meta.complete === true) {
        expect(parsed.meta.next_call).toBeNull()
        break
      }
      const nextCall = parsed.meta.next_call as { name: string; arguments: Record<string, unknown> }
      expect(nextCall.name).toBe('read')
      expect(nextCall.arguments.section_id).toBe(id)
      expect(Number(parsed.meta.next_offset)).toBeGreaterThan(offset)
      // next_call 可以直接复制复用：参数与模型自己写的一致。
      expect(nextCall.arguments.offset).toBe(parsed.meta.next_offset)
      offset = Number(parsed.meta.next_offset)
    }
    expect(pages).toBeGreaterThan(1)
    expect(collected).toBe(bodyOf('长节'))
  })

  it('超长单行按字符切分且不拆代理对，续读拼回原文', async () => {
    const id = sectionId('代理节')
    const executor = makeExecutor(undefined, { maxContextChars: 1200 })
    let offset = 0
    let collected = ''
    for (let page = 0; page < 30; page++) {
      const item = (await executor.executeStep([call(`p${page}`, { section_id: id, offset })])).results[0]!
      expect(item.status).toBe('success')
      // 小预算下成功页也必须整体守住 maxContextChars。
      expect(item.data.length).toBeLessThanOrEqual(1200)
      const parsed = parseRead(item.data)
      const last = parsed.body.charCodeAt(parsed.body.length - 1)
      expect(Number.isNaN(last) || last < 0xd800 || last > 0xdbff).toBe(true)
      collected += parsed.body
      if (parsed.meta.complete === true) break
      offset = Number(parsed.meta.next_offset)
    }
    expect(collected).toBe(bodyOf('代理节'))
  })
})

describe('read：关联事实独立偏移与容量', () => {
  it('事实按完整对象分页，facts_offset 续读并给出 next_facts_offset', async () => {
    const canonicals = realCanonicals(60)
    const index = linkIndexFor('空节', canonicals.map((canonical) => objectFor(canonical)))
    // 正文为空，事实独用额度；容量只够前若干张卡，其余靠 facts_offset 续读。
    const executor = makeExecutor(index, { maxContextChars: 4000 })
    const first = (await executor.executeStep([call('a', { section_id: sectionId('空节') })])).results[0]!
    expect(first.status).toBe('success')
    const parsed = parseRead(first.data)
    expect(parsed.meta.facts_total).toBe(canonicals.length)
    expect(Number(parsed.meta.facts_returned)).toBeGreaterThan(0)
    expect(Number(parsed.meta.facts_returned)).toBeLessThan(canonicals.length)
    expect(parsed.meta.facts_complete).toBe(false)

    const second = (await executor.executeStep([call('b', {
      section_id: sectionId('空节'),
      facts_offset: Number(parsed.meta.next_facts_offset),
    })])).results[0]!
    const parsedSecond = parseRead(second.data)
    expect(parsedSecond.meta.facts_offset).toBe(parsed.meta.next_facts_offset)
    // 同一次装配快照内对象顺序稳定，续读不重复第一页的卡。
    const firstCards = first.readDelivery?.deliveredObjects ?? []
    const secondCards = second.readDelivery?.deliveredObjects ?? []
    expect(secondCards.length).toBeGreaterThan(0)
    expect(secondCards.some((object) => firstCards.some((prev) => prev.kind === 'card' && object.kind === 'card' && prev.canonical === object.canonical))).toBe(false)
  })

  it('正文未读完而事实已读完时，next_call 的事实参数用总对象数而不是 null', async () => {
    const canonicals = realCanonicals(3)
    const index = linkIndexFor('长节', canonicals.map((canonical) => objectFor(canonical)))
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('长节') })])).results[0]!
    const parsed = parseRead(item.data)
    expect(parsed.meta.body_complete).toBe(false)
    expect(parsed.meta.facts_complete).toBe(true)

    const nextCall = parsed.meta.next_call as { name: string; arguments: { section_id: string; offset: number; facts_offset: number } }
    expect(nextCall.name).toBe('read')
    expect(nextCall.arguments.section_id).toBe(sectionId('长节'))
    expect(nextCall.arguments.offset).toBe(parsed.meta.next_offset)
    // 事实已读完：参数用总对象数而不是 null，续读原文时不重复送达。
    expect(nextCall.arguments.facts_offset).toBe(parsed.meta.facts_total)
  })

  it('两侧都未完成时 next_call 分别带下一偏移', async () => {
    const canonicals = realCanonicals(60)
    const index = linkIndexFor('长节', canonicals.map((canonical) => objectFor(canonical)))
    const item = (await makeExecutor(index, { maxContextChars: 4000 }).executeStep([
      call('a', { section_id: sectionId('长节') }),
    ])).results[0]!
    const parsed = parseRead(item.data)
    expect(parsed.meta.body_complete).toBe(false)
    expect(parsed.meta.facts_complete).toBe(false)

    const nextCall = parsed.meta.next_call as { arguments: { offset: number; facts_offset: number } }
    expect(nextCall.arguments.offset).toBe(parsed.meta.next_offset)
    expect(nextCall.arguments.facts_offset).toBe(parsed.meta.next_facts_offset)
  })

  it('maxContextChars 放不下必要元数据时明确报错，不静默放宽', async () => {
    const item = (await makeExecutor(undefined, { maxContextChars: 80 }).executeStep([
      call('a', { section_id: sectionId('甲节') }),
    ])).results[0]!
    expect(item.status).toBe('error')
    expect(item.data).toContain('maxContextChars=80')
    expect(item.readDelivery).toMatchObject({ status: 'error' })
    expect(item.readDelivery?.bodyRange).toBeUndefined()
  })

  it('单个关联对象超过整页可用容量时报错，不返回半张卡也不给 next_call', async () => {
    const longest = getCardStore().cards
      .map((card) => ({ canonical: card.canonical, length: serializeCard(card, {}).length }))
      .sort((left, right) => right.length - left.length)[0]!
    expect(longest.length).toBeGreaterThan(800)
    const index = linkIndexFor('空节', [objectFor(longest.canonical)])
    // 800 字符足以容纳分页元数据，但整张最长卡远放不下（事实优先于正文，不能截半张）。
    const item = (await makeExecutor(index, { maxContextChars: 800 }).executeStep([
      call('a', { section_id: sectionId('空节') }),
    ])).results[0]!

    expect(item.status).toBe('error')
    expect(item.data).toContain('关联对象超过阅读容量')
    expect(item.readDelivery?.deliveredObjects).toBeUndefined()
    expect(item.data).not.toContain('next_call')
    // 对象序列已经取得：容量失败仍按契约登记事实页（returned=0、complete=false），不伪造下一调用。
    expect(item.readDelivery?.factsPage).toEqual({ offset: 0, nextOffset: null, total: 1, returned: 0, complete: false })
  })

  it('无事实或事实偏移已耗尽时，容量失败页仍记 complete=false', async () => {
    // 没有关联对象：事实侧不可能「已完成送达」，失败页不能标成完成。
    const noFacts = (await makeExecutor(undefined, { maxContextChars: 80 }).executeStep([
      call('a', { section_id: sectionId('甲节') }),
    ])).results[0]!
    expect(noFacts.status).toBe('error')
    expect(noFacts.readDelivery?.factsPage).toEqual({ offset: 0, nextOffset: null, total: 0, returned: 0, complete: false })

    // 事实已在上一页读完：本页因容量失败仍按失败页登记。
    const index = linkIndexFor('甲节', [objectFor(realCanonicals(1)[0]!)])
    const exhausted = (await makeExecutor(index, { maxContextChars: 80 }).executeStep([
      call('b', { section_id: sectionId('甲节'), offset: bodyOf('甲节').length, facts_offset: 1 }),
    ])).results[0]!
    expect(exhausted.status).toBe('error')
    expect(exhausted.readDelivery?.factsPage).toEqual({ offset: 1, nextOffset: null, total: 1, returned: 0, complete: false })
  })

  it('窄容量下不放行不可前进的页：未完整页至少推进一个偏移，空页只在读完后返回', async () => {
    const configs = [
      { heading: '空节', count: 20 },
      { heading: '甲节', count: 5 },
      { heading: '甲节', count: 1 },
    ]
    let succeeded = 0
    for (const { heading, count } of configs) {
      const id = sectionId(heading)
      const index = linkIndexFor(heading, realCanonicals(count).map((canonical) => objectFor(canonical)))
      for (let maxChars = 400; maxChars <= 900; maxChars += 1) {
        const item = (await makeExecutor(index, { maxContextChars: maxChars }).executeStep([
          call(`m${heading}${count}-${maxChars}`, { section_id: id }),
        ])).results[0]!
        if (item.status === 'error') {
          expect(item.data).toMatch(/阅读容量|maxContextChars/u)
          continue
        }
        const parsed = parseRead(item.data)
        expect(item.data.length, `${heading}｜${count} 卡｜${maxChars}`).toBeLessThanOrEqual(maxChars)
        expect(item.status, `${heading}｜${count} 卡｜${maxChars} 出现不可前进的空页`).toBe('success')
        if (parsed.meta.complete === true) continue
        const advanced = Number(parsed.meta.next_facts_offset) > 0 || Number(parsed.meta.next_offset) > 0
        expect(advanced).toBe(true)
        const nextCall = parsed.meta.next_call as { arguments: { offset: number; facts_offset: number } }
        // 已读完的一侧用总长度/总对象数续读另一侧，不重复送达。
        expect(nextCall.arguments.facts_offset).toBe(parsed.meta.next_facts_offset ?? parsed.meta.facts_total)
        succeeded++
      }
    }
    expect(succeeded).toBeGreaterThan(0)
  })

  it('登记来源随事实对象送入模型，且与对象一起占用本页容量', async () => {
    const canonical = getCardStore().cards
      .map((card) => ({ canonical: card.canonical, length: serializeCard(card, {}).length }))
      .sort((left, right) => right.length - left.length)[0]!.canonical
    const index = linkIndexFor('空节', [objectFor(canonical)])
    const id = sectionId('空节')

    // 正文为空的小节里，成功页只能靠这张卡：成功阈值就是「元数据 + 卡片 + 登记来源」的边界。
    let threshold: { maxChars: number; data: string; facts: string } | undefined
    for (let maxChars = 800; maxChars <= 2000 && threshold === undefined; maxChars += 1) {
      const item = (await makeExecutor(index, { maxContextChars: maxChars }).executeStep([
        call(`t${maxChars}`, { section_id: id }),
      ])).results[0]!
      if (item.status !== 'success') continue
      threshold = { maxChars, data: item.data, facts: parseRead(item.data).facts }
    }
    expect(threshold).toBeDefined()
    const facts = threshold!.facts
    expect(facts).toContain('- 【设施：')
    expect(facts).toContain('登记来源：base/甲.md#甲文档 > 空节')
    // 来源行在事实分区内，与对象一起计入同一个预算。
    expect(facts.indexOf('登记来源：')).toBeGreaterThan(facts.indexOf('- 【设施：'))
    expect(threshold!.data.length).toBeLessThanOrEqual(threshold!.maxChars)

    const below = (await makeExecutor(index, { maxContextChars: threshold!.maxChars - 1 }).executeStep([
      call('below', { section_id: id }),
    ])).results[0]!
    expect(below.status).toBe('error')
  })
})

describe('read：精确技能投影', () => {
  function provenceGrants() {
    const card = getCardStore().byCanonical.get('普罗旺斯')!
    const beta = card.skills.find((skill) => skill.name === '天灾信使·β')!
    const alpha = card.skills.find((skill) => skill.name === '天灾信使·α')!
    return { card, beta, alpha }
  }

  it('skill 引用只投影指定 grant 及被替换链，并标明明确引用与替换依据', async () => {
    const { beta, alpha } = provenceGrants()
    const index = linkIndexFor('空节', [
      { kind: 'card', ref: '办公室｜「天灾信使·β」｜普罗旺斯', canonical: '普罗旺斯', grantId: beta.grantId! },
    ])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('空节') })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('明确引用')
    expect(item.data).toContain('替换依据')
    expect(item.data).toContain(`替换「${alpha.name}」`)
    expect(skillLineCount(parseRead(item.data).facts)).toBe(2)
    const delivered = item.readDelivery!.deliveredObjects!
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({
      kind: 'card',
      canonical: '普罗旺斯',
      projection: 'skills',
      origins: [{ sectionId: sectionId('空节'), objectIndex: 0 }],
    })
    expect(new Set(delivered[0]!.kind === 'card' ? delivered[0]!.grantIds : [])).toEqual(new Set([beta.grantId, alpha.grantId]))
  })

  it('同卡多技能引用合并为一张投影卡，operator 引用覆盖为完整卡', async () => {
    const { card, beta, alpha } = provenceGrants()
    const skillOnly = linkIndexFor('空节', [
      { kind: 'card', ref: '办公室｜「天灾信使·β」｜普罗旺斯', canonical: '普罗旺斯', grantId: beta.grantId! },
      { kind: 'card', ref: '办公室｜「天灾信使·α」｜普罗旺斯', canonical: '普罗旺斯', grantId: alpha.grantId! },
    ])
    const merged = (await makeExecutor(skillOnly).executeStep([call('a', { section_id: sectionId('空节') })])).results[0]!
    expect(merged.readDelivery?.deliveredObjects).toHaveLength(1)
    expect(merged.readDelivery?.deliveredObjects?.[0]).toMatchObject({ projection: 'skills' })

    const withOperator = linkIndexFor('空节', [
      { kind: 'card', ref: '办公室｜「天灾信使·β」｜普罗旺斯', canonical: '普罗旺斯', grantId: beta.grantId! },
      objectFor('普罗旺斯'),
    ])
    const full = (await makeExecutor(withOperator).executeStep([call('b', { section_id: sectionId('空节') })])).results[0]!
    expect(skillLineCount(parseRead(full.data).facts)).toBe(card.skills.length)
    const delivered = full.readDelivery?.deliveredObjects?.[0]
    expect(delivered).toMatchObject({ projection: 'full', origins: [
      { sectionId: sectionId('空节'), objectIndex: 0 },
      { sectionId: sectionId('空节'), objectIndex: 1 },
    ] })
  })

  it('明确引用不受登记顺序影响：先引用 β 再引用 α，α 仍标为明确引用', async () => {
    const { alpha, beta } = provenceGrants()
    const index = linkIndexFor('空节', [
      { kind: 'card', ref: '办公室｜「天灾信使·β」｜普罗旺斯', canonical: '普罗旺斯', grantId: beta.grantId! },
      { kind: 'card', ref: '办公室｜「天灾信使·α」｜普罗旺斯', canonical: '普罗旺斯', grantId: alpha.grantId! },
    ])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('空节') })])).results[0]!
    const lines = parseRead(item.data).facts.split('\n').filter((line) => line.startsWith('- 【设施：'))

    const alphaLine = lines.find((line) => line.includes(`「${alpha.name}」`))
    expect(alphaLine).toBeDefined()
    expect(alphaLine).toContain('明确引用')
    expect(alphaLine).not.toContain('替换依据')
    const delivered = item.readDelivery!.deliveredObjects![0]!
    expect(new Set(delivered.kind === 'card' ? delivered.grantIds : [])).toEqual(new Set([beta.grantId, alpha.grantId]))
  })

  it('登记引用指向卡上不存在的 grant 时显式报错，不静默返回零技能的成功页', async () => {
    const index = linkIndexFor('空节', [
      { kind: 'card', ref: '办公室｜「不存在」｜普罗旺斯', canonical: '普罗旺斯', grantId: 'grant-不存在' },
    ])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('空节') })])).results[0]!

    expect(item.status).toBe('error')
    expect(item.data).toContain('grant-不存在')
    expect(item.readDelivery?.deliveredObjects).toBeUndefined()
    expect(item.fatal).toBe(true)
    expect(item.readDelivery?.factsPage).toEqual({ offset: 0, nextOffset: null, total: 1, returned: 0, complete: false })
  })

  it('缺失明确引用或被替换依据时 skillProjection 报错，不静默跳过该引用', () => {
    const card = {
      canonical: '干员甲',
      aliases: [],
      rarity: '5',
      class: '辅助',
      rooms: ['办公室'],
      factionGroups: [],
      skillGroups: [],
      notes: '',
      skills: [
        {
          grantId: 'g-升级',
          room: '办公室',
          name: '技能乙',
          unlockType: '精英2解锁',
          target: '',
          effectText: '效果原文',
          tags: [],
          products: [],
          professions: [],
          referencedTerms: [],
          skillCategories: [],
          replacesGrantId: 'g-缺失被替换',
        },
      ],
    } as RecordCard

    expect(() => skillProjection(card, ['g-不存在'])).toThrowError('明确引用')
    expect(() => skillProjection(card, ['g-升级'])).toThrowError('替换依据')
  })

  it('概念引用按精确位置送达并写入 readDelivery（不进入 injectedIds）', async () => {
    const concept = {
      kind: 'concept' as const,
      ref: 'concept:guides/类别.md#官方术语与类别｜心情落差',
      name: '心情落差',
      file: 'guides/类别.md',
      headingPath: ['官方术语与类别'],
      occurrence: 1,
      term: '心情落差',
      termOccurrence: 2,
      startLine: 12,
      endLine: 13,
      definition: '- **心情落差**：示例定义原文。',
    }
    const index = linkIndexFor('空节', [concept])
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: sectionId('空节') })])).results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('【概念：心情落差】')
    expect(item.injectedIds).toEqual([])
    expect(item.readDelivery?.deliveredObjects).toEqual([
      {
        kind: 'concept',
        file: 'guides/类别.md',
        headingPath: ['官方术语与类别'],
        occurrence: 1,
        term: '心情落差',
        termOccurrence: 2,
        startLine: 12,
        endLine: 13,
        origins: [{ sectionId: sectionId('空节'), objectIndex: 0 }],
      },
    ])
  })
})

describe('read：送达观测', () => {
  it('一次调用只计一次获准 attempt，错误与空页不扣成功额度', async () => {
    const id = sectionId('甲节')
    const bodyLength = bodyOf('甲节').length
    const executor = makeExecutor()
    const first = await executor.executeStep([call('ok', { section_id: id })])
    expect(first.results[0]).toMatchObject({ status: 'success', executed: true })
    const second = await executor.executeStep([call('end', { section_id: id, offset: bodyLength })])
    expect(second.results[0]).toMatchObject({ status: 'empty', executed: true })
    expect(executor.snapshot()).toMatchObject({ attemptUsed: 2, successUsed: 1, executed: 2, remaining: 4 })

    const tight = makeExecutor(undefined, { maxContextChars: 80 })
    const failed = await tight.executeStep([call('err', { section_id: id })])
    expect(failed.results[0]).toMatchObject({ status: 'error', executed: true })
    expect(tight.snapshot()).toMatchObject({ attemptUsed: 1, successUsed: 0, remaining: 5 })
  })

  it('正文与事实任一侧送达即成功，bodyRange 与文档坐标一致', async () => {
    const canonical = realCanonicals(1)[0]!
    const index = linkIndexFor('有正文', [objectFor(canonical)])
    const section = directory.sections.find((item) => item.heading === '有正文')!
    const doc = directory.documentRange(section.file)!
    const item = (await makeExecutor(index).executeStep([call('a', { section_id: section.sectionId })])).results[0]!

    expect(item.status).toBe('success')
    const delivery = item.readDelivery!
    expect(delivery.bodyRange).toMatchObject({
      file: 'base/甲.md',
      sectionId: section.sectionId,
      offset: 0,
      endOffset: section.body.length,
      complete: true,
      startLine: section.startLine,
      endLine: section.endLine,
    })
    expect(delivery.bodyRange!.docEndOffset - delivery.bodyRange!.docOffset).toBe(section.body.length)
    expect(doc.body.slice(delivery.bodyRange!.docOffset, delivery.bodyRange!.docEndOffset)).toBe(section.body)
    expect(delivery.factsPage).toEqual({
      offset: 0,
      nextOffset: null,
      total: 1,
      returned: 1,
      complete: true,
    })
    expect(delivery.factsResultVersion).toBe(8)
    expect(delivery.resultChars).toBe(item.data.length)
  })

  it('读到末尾且无事实时 bodyRange=null、deliveredObjects=[]，不写成空关联', async () => {
    const item = (await makeExecutor().executeStep([
      call('a', { section_id: sectionId('甲节'), offset: bodyOf('甲节').length }),
    ])).results[0]!
    const delivery = item.readDelivery!
    expect(delivery.status).toBe('empty')
    expect(delivery.bodyRange).toBeNull()
    expect(delivery.deliveredObjects).toEqual([])
    expect(delivery.factsPage).toMatchObject({ returned: 0, complete: true })
  })

  it('预算拒绝的 read 也留下台账：sectionId 为 null，不伪造实际范围', async () => {
    const executor = makeExecutor(undefined, {}, 1)
    const first = await executor.executeStep([call('a', { section_id: sectionId('有正文') })])
    expect(first.results[0]).toMatchObject({ status: 'success', executed: true })

    const denied = await executor.executeStep([call('b', { section_id: sectionId('有正文') })])
    expect(denied.results[0]).toMatchObject({ status: 'budget_exhausted', executed: false })
    expect(denied.results[0]!.readDelivery).toMatchObject({
      callId: 'b',
      status: 'budget_exhausted',
      sectionId: null,
      factsResultVersion: 8,
    })
    expect(denied.results[0]!.readDelivery?.bodyRange).toBeUndefined()
  })
})

describe('read：登记来源显示', () => {
  it('同文件同标题路径的重复标题保留出现序号，显示时不合并来源', async () => {
    const canonical = realCanonicals(1)[0]!
    const duplicated = directory.sections.filter((item) => item.heading === '重复节')
    expect(duplicated).toHaveLength(2)
    const links = duplicated.map((section) => ({
      sectionId: section.sectionId,
      file: section.file,
      headingPath: [...section.ancestors, section.heading],
      occurrence: section.occurrence,
      scope: 'section' as const,
      documentRoot: false,
      objects: [objectFor(canonical)],
      unresolved: [],
    }))
    const index: ProseLinkIndex = {
      links,
      bySection: new Map(links.map((link) => [link.sectionId, link])),
      issues: [],
    }

    // 读文档根：两处登记的同一张卡按 canonical 合并为一张，但来源定位必须保持可区分。
    const item = (await makeExecutor(index).executeStep([
      call('a', { section_id: 'doc:base/丙.md' }),
    ])).results[0]!

    expect(item.status).toBe('success')
    const facts = parseRead(item.data).facts
    expect(facts).toContain('登记来源：base/丙.md#重复文档 > 重复节（出现序号 1）；base/丙.md#重复文档 > 重复节（出现序号 2）')
    expect(item.readDelivery?.deliveredObjects?.[0]?.origins).toHaveLength(2)
  })
})
