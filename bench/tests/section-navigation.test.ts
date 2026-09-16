import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { collectMarkdownFiles, splitChunks } from '../src/corpus.js'
import { buildIndex, search } from '../src/retriever.js'
import { buildSectionDirectory, type SectionDirectory } from '../src/sections.js'
import { createKnowledgeToolExecutor } from '../src/tool-executor.js'
import type { DocChunk, ToolCall } from '../src/types.js'

const DOC = [
  '# 制造体系',
  '',
  '制造体系前言。',
  '',
  '## 制造站',
  '',
  '制造站引言。',
  '',
  '### 效率',
  '',
  '制造站效率由干员技能决定，效率上限为 25%。',
  '',
  '### 排班',
  '',
  '排班说明。',
  '',
].join('\n')

let root: string
let docsDir: string
let chunks: DocChunk[]
let directory: SectionDirectory

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rag-section-nav-'))
  docsDir = join(root, 'knowledge')
  mkdirSync(join(docsDir, 'base'), { recursive: true })
  writeFileSync(join(docsDir, 'base', '制造.md'), DOC, 'utf-8')
  writeFileSync(join(docsDir, 'corpus-manifest.json'), JSON.stringify({ files: ['base/制造.md'] }), 'utf-8')
  chunks = collectMarkdownFiles(docsDir).flatMap((file) => splitChunks(file, docsDir))
  directory = buildSectionDirectory(docsDir)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function call(id: string, name: string, params: unknown): ToolCall {
  return { id, name, arguments: JSON.stringify(params) }
}

function makeExecutor(overrides: Partial<BenchConfig> = {}, withSections = true) {
  // 这些用例隔离「小节上下文」行为，显式关闭原文扩展（ADR-013 对照组合之一）。
  const config = { ...loadConfig(), retriever: 'bm25' as const, expandFulltext: false, ...overrides }
  return createKnowledgeToolExecutor({
    config,
    query: { id: 'SECTION-NAV', category: 'fact', question: '制造站效率' },
    chunks,
    index: buildIndex(chunks),
    ...(withSections ? { sections: directory } : {}),
  }, 5)
}

/** 默认送达基线：块头含小节 ID、来源与原文范围，正文来自同一原文快照的块行范围。 */
function blockFor(chunk: DocChunk): string {
  // 无对应小节的标题前首部以同文件文档范围为阅读入口，与运行时的映射一致。
  const target = directory.findByChunk(chunk.file, chunk.heading, chunk.startLine) ?? directory.documentRange(chunk.file)
  const id = target ? ` | ${target.sectionId}` : ''
  return `【${chunk.file} | ${chunk.heading} | L${chunk.startLine}-${chunk.endLine}${id}】\n${chunk.text}`
}

function baselineFor(query: string): string {
  const hits = search(buildIndex(chunks), query, 5)
  return hits.map((index) => blockFor(chunks[index]!)).join('\n\n')
}

/** 用自定义文档重建同一临时语料，供分页与边界用例使用。 */
function rebuildCorpus(files: Record<string, string>): void {
  rmSync(docsDir, { recursive: true, force: true })
  mkdirSync(docsDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(docsDir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  writeFileSync(join(docsDir, 'corpus-manifest.json'), JSON.stringify({ files: Object.keys(files) }), 'utf-8')
  chunks = collectMarkdownFiles(docsDir).flatMap((file) => splitChunks(file, docsDir))
  directory = buildSectionDirectory(docsDir)
}

interface ParsedPage {
  page: string
  offset: number
  nextOffset: number | null
  complete: boolean
  nav?: string
}

/** 按固定分区解析 read 输出；分页元数据是「【分页】」下的单行合法 JSON。 */
function parsePage(data: string): ParsedPage {
  const segments = data.split(/\n(?=【(?:阅读范围|分页|原文|关联事实|导航)】)/u)
  let meta: Record<string, unknown> | undefined
  let page: string | undefined
  let nav: string | undefined
  for (const segment of segments) {
    if (segment.startsWith('【分页】')) meta = JSON.parse(segment.slice('【分页】'.length)) as Record<string, unknown>
    else if (segment.startsWith('【原文】\n')) page = segment.slice('【原文】\n'.length)
    else if (segment.startsWith('【导航】\n')) nav = segment.slice('【导航】\n'.length)
  }
  if (meta === undefined || page === undefined) throw new Error(`无法解析 read 输出：${data}`)
  return {
    page: page === '（无本页内容）' ? '' : page,
    offset: Number(meta.offset),
    nextOffset: meta.next_offset === null ? null : Number(meta.next_offset),
    complete: meta.complete === true,
    ...(nav === undefined ? {} : { nav }),
  }
}

describe('RAG 展示：标题上下文与导航', () => {
  it('命中片段带 sectionId，并附标题路径、父级引导与导航', async () => {
    const result = await makeExecutor().executeStep([call('a', 'rag_search', { query: '制造站效率' })])
    const item = result.results[0]!
    const efficiency = directory.sections.find((section) => section.heading === '效率')!

    expect(item.status).toBe('success')
    expect(item.data.startsWith(baselineFor('制造站效率'))).toBe(true)
    expect(item.data).toContain(`【base/制造.md | 效率 | L11-11 | ${efficiency.sectionId}】`)
    expect(item.data).toContain(efficiency.sectionId)
    expect(item.data).toContain('标题路径：制造体系 > 制造站 > 效率')
    expect(item.data).toContain('父级引导（L7-7）：制造站引言。')
    expect(item.data).toContain('【小节导航】base/制造.md')
    const scheduling = directory.sections.find((section) => section.heading === '排班')!
    expect(item.data).toContain(`- ${scheduling.sectionId}｜排班`)
    expect(item.injectedIds?.every((id) => !id.startsWith('sec-'))).toBe(true)
    expect(item.injectedIds?.every((id) => chunks.some((chunk) => chunk.id === id))).toBe(true)
  })

  it('同一来源快照：展示的小节正文与检索块一致', async () => {
    const result = await makeExecutor().executeStep([call('a', 'rag_search', { query: '制造站效率' })])
    const item = result.results[0]!
    const efficiency = directory.sections.find((section) => section.heading === '效率')!
    expect(efficiency.body).toBe('制造站效率由干员技能决定，效率上限为 25%。')
    expect(item.data).toContain(efficiency.body)
  })

  it('预算只够命中正文时不附加上下文，且 injectedIds 与真实送达一致', async () => {
    const hits = search(buildIndex(chunks), '制造站效率', 5)
    const firstBlock = blockFor(chunks[hits[0]!]!)
    const result = await makeExecutor({ maxContextChars: firstBlock.length }).executeStep([
      call('a', 'rag_search', { query: '制造站效率' }),
    ])
    const item = result.results[0]!

    expect(item.data).toBe(firstBlock)
    expect(item.data).not.toContain('【小节上下文】')
    expect(item.injectedIds).toEqual([chunks[hits[0]!]!.id])
    expect(item.data.length).toBeLessThanOrEqual(firstBlock.length)
  })

  it('附加信息只用剩余空间，不改变已送达正文的连续前缀', async () => {
    const baseline = baselineFor('制造站效率')
    const maxChars = baseline.length - 10
    const result = await makeExecutor({ maxContextChars: maxChars }).executeStep([
      call('a', 'rag_search', { query: '制造站效率' }),
    ])
    const item = result.results[0]!

    // 去掉截断块的续读元数据与末尾上下文后，已送达正文仍是各命中块的连续前缀，未做首尾压缩。
    const bodyOnly = item.data.split('\n\n【小节上下文】')[0]!.split('\n续读：')[0]!
    expect(baseline.startsWith(bodyOnly)).toBe(true)
    expect(item.data.length).toBeLessThanOrEqual(maxChars)
  })

  it('默认送达缺少小节目录时报错，不返回没有阅读 ID 的正文', async () => {
    const result = await makeExecutor({}, false).executeStep([call('a', 'rag_search', { query: '制造站效率' })])
    const item = result.results[0]!
    expect(item.status).toBe('error')
    expect(item.data).toContain('无法定位命中块的原文阅读范围')
    expect(item.data).not.toContain('sec-')
    expect(item.data).not.toContain('【小节上下文】')
    expect(item.data).not.toContain('制造站效率由干员技能决定')
    expect(item.fragmentRanges).toBeUndefined()
    expect(result.snapshot.successUsed).toBe(0)
  })

  it('上级范围入口映射直接父级，同父级按命中顺序去重', async () => {
    rebuildCorpus({
      'base/父章.md': [
        '# 父章',
        '',
        '父章正文。',
        '',
        '## 子甲',
        '',
        '共同关键词 甲。',
        '',
        '## 子乙',
        '',
        '共同关键词 乙。',
        '',
      ].join('\n'),
    })
    const parent = directory.sections.find((section) => section.heading === '父章')!
    const result = await makeExecutor().executeStep([call('a', 'rag_search', { query: '共同关键词' })])
    const data = result.results[0]!.data

    expect(data).toContain('【上级范围入口】以下为包含下级小节的原文范围')
    const entry = `- ${parent.sectionId}｜base/父章.md｜标题路径：父章｜正文 ${parent.body.length} 字符`
    expect(data).toContain(entry)
    expect(data.split(entry).length - 1).toBe(1)
    expect(result.results[0]!.hitIds?.every((id) => !id.startsWith('sec-'))).toBe(true)
    expect(result.results[0]!.injectedIds?.every((id) => !id.startsWith('sec-'))).toBe(true)
  })

  it('无父级小节不虚造上级范围入口', async () => {
    rebuildCorpus({ 'base/顶层.md': ['', '## 顶层', '', '顶层正文，独有关键词。', ''].join('\n') })
    const top = directory.sections.find((section) => section.heading === '顶层')!
    expect(top.parentId).toBeUndefined()
    const result = await makeExecutor().executeStep([call('a', 'rag_search', { query: '独有关键词' })])
    const data = result.results[0]!.data

    expect(data).toContain('【小节上下文】')
    expect(data).toContain(top.sectionId)
    expect(data).not.toContain('【上级范围入口】')
  })

  it('上级范围入口只整行送达：空间足够时完整可复制，不足时不挤占正文也不截断 ID', async () => {
    const full = await makeExecutor().executeStep([call('a', 'rag_search', { query: '制造站效率' })])
    const fullData = full.results[0]!.data
    const station = directory.sections.find((section) => section.heading === '制造站')!
    const efficiency = directory.sections.find((section) => section.heading === '效率')!
    expect(fullData).toContain(`- ${station.sectionId}｜base/制造.md｜标题路径：制造体系 > 制造站｜正文 ${station.body.length} 字符`)

    const start = fullData.indexOf('【上级范围入口】')
    expect(start).toBeGreaterThan(0)
    const tight = await makeExecutor({ maxContextChars: start - 1 }).executeStep([
      call('b', 'rag_search', { query: '制造站效率' }),
    ])
    const tightData = tight.results[0]!.data

    expect(tightData).toBe(fullData.slice(0, start - 1))
    expect(tightData).not.toContain('【上级范围入口】')
    expect(tightData).not.toContain('…（截断）')
    expect(tightData).toContain(`- ${efficiency.sectionId}｜base/制造.md｜标题路径：制造体系 > 制造站 > 效率`)
    expect(tightData.length).toBeLessThanOrEqual(start - 1)
  })

  it('首个可调用 ID 行放不下时整行省略，不输出截断 ID', async () => {
    const baseline = baselineFor('制造站效率')
    const efficiency = directory.sections.find((section) => section.heading === '效率')!
    const header = '【小节上下文】'
    const maxChars = baseline.length + 2 + header.length + 1
    const result = await makeExecutor({ maxContextChars: maxChars }).executeStep([
      call('a', 'rag_search', { query: '制造站效率' }),
    ])
    const item = result.results[0]!

    expect(item.data.startsWith(baseline)).toBe(true)
    expect(item.data.endsWith(header)).toBe(true)
    // 含 ID 的上下文行要么整行写入，要么整行省略，不出现被截断的 ID。
    expect(item.data).not.toContain(`- ${efficiency.sectionId}｜base/制造.md｜标题路径：`)
    expect(item.data).not.toContain('…（截断）')
    expect(item.data.length).toBeLessThanOrEqual(maxChars)
    expect(item.injectedIds?.every((id) => !id.startsWith('sec-'))).toBe(true)
  })
})

describe('read：按小节读取原文与关联事实', () => {
  function efficiencyId(): string {
    return directory.sections.find((section) => section.heading === '效率')!.sectionId
  }

  it('返回固定分区的原文页，含小节标识、标题路径、行范围与分页元数据', async () => {
    const sectionId = efficiencyId()
    const result = await makeExecutor().executeStep([call('read', 'read', { section_id: sectionId })])
    const item = result.results[0]!
    expect(item.status).toBe('success')
    expect(item.data).toContain('【阅读范围】base/制造.md｜标题路径：制造体系 > 制造站 > 效率')
    expect(item.data).toContain(`section_id：${sectionId}`)
    expect(item.data).toContain('原文行范围：L11-11')
    expect(item.data).toContain('【原文】\n制造站效率由干员技能决定，效率上限为 25%。')
    expect(item.data).toContain('【关联事实】\n（无本页内容）')
    expect(parsePage(item.data)).toMatchObject({ page: '制造站效率由干员技能决定，效率上限为 25%。', offset: 0, nextOffset: null, complete: true })
    expect(item.hitIds).toEqual([])
    expect(item.injectedIds).toEqual([])
  })

  it('offset 等于正文长度返回空页（empty，不扣成功额度），超过长度返回参数错误', async () => {
    const sectionId = efficiencyId()
    const bodyLength = directory.get(sectionId)!.body.length
    const endExecutor = makeExecutor()
    const exact = await endExecutor.executeStep([call('end', 'read', { section_id: sectionId, offset: bodyLength })])
    expect(exact.results[0]).toMatchObject({ status: 'empty', executed: true })
    expect(parsePage(exact.results[0]!.data)).toMatchObject({ page: '', nextOffset: null, complete: true })
    expect(endExecutor.snapshot()).toMatchObject({ successUsed: 0, attemptUsed: 1, remaining: 5 })

    const overflow = await makeExecutor().executeStep([call('over', 'read', { section_id: sectionId, offset: bodyLength + 1 })])
    expect(overflow.results[0]).toMatchObject({ status: 'invalid_params', executed: false })
  })

  it('正常正文页计为成功并扣 1 成功额度，空正文小节不扣', async () => {
    rebuildCorpus({
      'base/空节.md': ['# 空节', '', '## 空小节', '', '## 有正文', '', '有正文内容。', ''].join('\n'),
    })
    const emptySection = directory.sections.find((section) => section.heading === '空小节')!
    const bodySection = directory.sections.find((section) => section.heading === '有正文')!
    expect(emptySection.body).toBe('')
    const executor = makeExecutor()
    // 每步只准入一个调用，两次读取拆成两个独立模型步骤。
    const first = await executor.executeStep([call('empty', 'read', { section_id: emptySection.sectionId })])
    const second = await executor.executeStep([call('body', 'read', { section_id: bodySection.sectionId })])
    expect(first.results[0]).toMatchObject({ status: 'empty', executed: true })
    expect(second.results[0]).toMatchObject({ status: 'success', executed: true })
    expect(executor.snapshot()).toMatchObject({ successUsed: 1, attemptUsed: 2, remaining: 4 })
  })

  it('maxContextChars 无法容纳分页元数据时明确返回错误，不静默放宽上限', async () => {
    const sectionId = efficiencyId()
    const result = await makeExecutor({ maxContextChars: 80 }).executeStep([call('a', 'read', { section_id: sectionId })])
    expect(result.results[0]).toMatchObject({ status: 'error' })
    expect(result.results[0]!.data).toContain('maxContextChars=80')
  })

  it('未知小节 ID 返回 empty，不退回模糊搜索', async () => {
    const result = await makeExecutor().executeStep([call('missing', 'read', { section_id: 'sec-不存在' })])
    expect(result.results[0]).toMatchObject({ status: 'empty', executed: true })
    expect(result.results[0]!.data).toContain('没有该小节')
  })

  it('非法参数拒绝执行：缺 section_id、多余字段、非整数或负 offset', async () => {
    const sectionId = efficiencyId()
    const executor = makeExecutor()
    const calls = [
      call('a', 'read', {}),
      call('b', 'read', { section_id: sectionId, extra: 1 }),
      call('c', 'read', { section_id: sectionId, offset: -1 }),
      call('d', 'read', { section_id: sectionId, offset: 1.5 }),
      call('e', 'read', { section_id: sectionId, offset: '0' }),
      call('f', 'read', { section_id: sectionId, facts_offset: -1 }),
    ]
    const statuses: string[] = []
    for (const single of calls) {
      const step = await executor.executeStep([single])
      statuses.push(step.results[0]!.status)
      expect(step.results[0]!.executed).toBe(false)
    }
    expect(statuses).toEqual(['invalid_params', 'invalid_params', 'invalid_params', 'invalid_params', 'invalid_params', 'invalid_params'])
    expect(executor.snapshot()).toMatchObject({ successUsed: 0, attemptUsed: 6, executed: 0 })
  })

  it('长小节连续分页无中段丢失，且每次续读占用共享预算', async () => {
    const longLine = '甲'.repeat(100)
    const bodyLines = Array.from({ length: 70 }, () => longLine)
    rebuildCorpus({ 'base/长节.md': ['# 长节', '', ...bodyLines, ''].join('\n') })
    const section = directory.sections.find((item) => item.heading === '长节')!
    const executor = makeExecutor()

    let offset = 0
    let collected = ''
    for (let page = 0; page < 10; page++) {
      const result = await executor.executeStep([call(`p${page}`, 'read', { section_id: section.sectionId, offset })])
      const item = result.results[0]!
      expect(item.status).toBe('success')
      const parsed = parsePage(item.data)
      expect(parsed.page.length).toBeLessThanOrEqual(6000)
      expect(parsed.offset).toBe(offset)
      collected += parsed.page
      if (parsed.complete) {
        expect(parsed.nextOffset).toBeNull()
        break
      }
      expect(parsed.nextOffset).toBeGreaterThan(offset)
      offset = parsed.nextOffset!
    }
    expect(collected).toBe(section.body)
    expect(executor.snapshot().successUsed).toBeGreaterThanOrEqual(2)
  })

  it('无小节目录时明确返回本运行无法读取', async () => {
    const result = await makeExecutor({}, false).executeStep([call('a', 'read', { section_id: 'sec-任意' })])
    expect(result.results[0]).toMatchObject({ status: 'empty', executed: true })
    expect(result.results[0]!.data).toContain('未启用小节阅读')
  })

  it('导航分区附加直接父级 ID、标题路径与正文长度', async () => {
    const efficiency = directory.sections.find((section) => section.heading === '效率')!
    const station = directory.sections.find((section) => section.heading === '制造站')!
    const result = await makeExecutor().executeStep([call('a', 'read', { section_id: efficiency.sectionId })])
    const data = result.results[0]!.data

    expect(data).toContain('【导航】\n')
    expect(data).toContain(`父级范围：${station.sectionId}｜base/制造.md｜标题路径：制造体系 > 制造站｜正文 ${station.body.length} 字符（包含下级小节的原文范围）`)
    expect(parsePage(data)).toMatchObject({ page: efficiency.body, nextOffset: null, complete: true })
  })

  it('导航只用余量：省略导航分区不改变正文页、next_offset 与工具计费', async () => {
    const efficiency = directory.sections.find((section) => section.heading === '效率')!
    const withParent = await makeExecutor().executeStep([call('a', 'read', { section_id: efficiency.sectionId })])
    const full = withParent.results[0]!.data
    const navStart = full.indexOf('\n【导航】')
    expect(navStart).toBeGreaterThan(0)
    const withoutNav = full.slice(0, navStart)

    const tight = await makeExecutor({ maxContextChars: withoutNav.length }).executeStep([
      call('b', 'read', { section_id: efficiency.sectionId }),
    ])
    const tightData = tight.results[0]!.data

    expect(tightData).not.toContain('【导航】')
    expect(tightData).toBe(withoutNav)
    const fullPage = parsePage(full)
    expect(parsePage(tightData)).toMatchObject({ page: fullPage.page, offset: fullPage.offset, nextOffset: fullPage.nextOffset, complete: fullPage.complete })
    expect(parsePage(tightData).page).toBe(efficiency.body)
    expect(withParent.snapshot).toMatchObject({ successUsed: 1, attemptUsed: 1, executed: 1 })
    expect(tight.snapshot).toMatchObject({ successUsed: 1, attemptUsed: 1, executed: 1 })
  })

  it('通过上级范围入口读取含多个子节的原文并连续续读', async () => {
    const longLine = '甲'.repeat(100)
    const bodyLines = Array.from({ length: 70 }, () => longLine)
    rebuildCorpus({
      'base/长父章.md': [
        '# 长父章',
        '',
        ...bodyLines,
        '',
        '## 子一',
        '',
        '子一正文。',
        '',
        '## 子二',
        '',
        '子二正文。',
        '',
      ].join('\n'),
    })
    const parent = directory.sections.find((section) => section.heading === '长父章')!
    expect(parent.body).toContain('子一正文。')
    expect(parent.body).toContain('子二正文。')

    const rag = await makeExecutor().executeStep([call('r', 'rag_search', { query: '子一正文' })])
    const entry = new RegExp(
      `- (sec-[0-9a-f]{16})｜base/长父章\\.md｜标题路径：长父章｜正文 ${parent.body.length} 字符`,
    ).exec(rag.results[0]!.data)
    expect(entry).not.toBeNull()
    expect(entry![1]).toBe(parent.sectionId)

    const executor = makeExecutor()
    let offset = 0
    let collected = ''
    let pages = 0
    for (let page = 0; page < 10; page++) {
      const result = await executor.executeStep([
        call(`p${page}`, 'read', { section_id: entry![1], offset }),
      ])
      expect(result.results[0]!.status).toBe('success')
      const parsed = parsePage(result.results[0]!.data)
      expect(parsed.offset).toBe(offset)
      collected += parsed.page
      pages++
      if (parsed.complete) break
      offset = parsed.nextOffset!
    }

    expect(pages).toBeGreaterThan(1)
    expect(collected).toBe(parent.body)
    expect(collected).toContain('子一正文。')
    expect(collected).toContain('子二正文。')
    expect(executor.snapshot().successUsed).toBe(pages)
  })
})
