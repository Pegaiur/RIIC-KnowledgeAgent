import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { collectMarkdownFiles, splitChunks } from '../src/corpus.js'
import { buildIndex } from '../src/retriever.js'
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

/** 目录树表头：说明缩进、命中标记与带 ID 的行。 */
const TREE_HEADER = '【文件目录】缩进=标题层级；◆=检索命中；带 ID 的行可 read'

/** 文件根行：H1 标题、整篇入口 ID 与全文规模；命中标题前首部时追加命中标记。 */
function rootRowFor(file: string, hit = false): string {
  const doc = directory.documentRange(file)!
  const title = directory.outlineFor(file)!.title
  return `- ${title}｜${doc.sectionId}｜全文 ${doc.body.length} 字符${hit ? ' ◆' : ''}`
}

/** 命中节点行：可复制 ID、标题与命中标记。 */
function hitRowFor(section: { sectionId: string; heading: string }): string {
  return `- ${section.sectionId}｜${section.heading} ◆`
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

describe('RAG 展示：同文件目录树', () => {
  it('命中节点就地展开预览，非命中节点只给标题并按层级缩进', async () => {
    rebuildCorpus({
      'base/树.md': [
        '# 树体系',
        '',
        '## 甲节',
        '',
        '甲节引言。',
        '',
        '### 甲子节',
        '',
        '独有词汇正文。',
        '',
        '### 甲另子节',
        '',
        '无关正文一。',
        '',
        '## 乙节',
        '',
        '无关正文二。',
        '',
      ].join('\n'),
    })
    const parent = directory.sections.find((section) => section.heading === '甲节')!
    const hit = directory.sections.find((section) => section.heading === '甲子节')!
    const sibling = directory.sections.find((section) => section.heading === '甲另子节')!
    const result = await makeExecutor().executeStep([call('a', 'rag_search', { query: '独有词汇' })])
    const item = result.results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain(TREE_HEADER)
    expect(item.data).toContain(rootRowFor('base/树.md'))
    // 命中的上级只作为结构行出现，不带 ID；命中行带 ID 并就地展开正文预览。
    expect(item.data).toContain(`  - ${parent.heading}\n`)
    expect(item.data).not.toContain(parent.sectionId)
    expect(item.data).toContain(`    ${hitRowFor(hit)}`)
    expect(item.data).toContain('      > 独有词汇正文。')
    // 未命中的同级小节只列标题，不带 ID。
    expect(item.data).toContain(`    - ${sibling.heading}`)
    expect(item.data).not.toContain(sibling.sectionId)
    expect(item.data).toContain('  - 乙节')
    // 树内不出现相对路径、旧关系词与旧表。
    expect(item.data).not.toContain('base/树.md')
    expect(item.data).not.toContain('【小节索引】')
    expect(item.data).not.toContain('｜命中｜')
    expect(item.data).not.toContain('｜邻近｜')
    expect(item.injectedIds).toEqual([chunks.find((chunk) => chunk.heading === '甲子节')!.id])
    expect(item.injectedIds?.every((id) => chunks.some((chunk) => chunk.id === id))).toBe(true)
  })

  it('预览超过 100 个 UTF-16 字符时在断点标出全文长度', async () => {
    const body = `关键词起头。${'甲'.repeat(94)}尾段不应出现。`
    rebuildCorpus({ 'base/长文.md': ['# 长文', '', '## 长节', '', body, ''].join('\n') })
    const result = await makeExecutor().executeStep([call('a', 'rag_search', { query: '关键词' })])
    const item = result.results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain(`    > 关键词起头。${'甲'.repeat(94)}…（截断，全文 ${body.length} 字符）`)
    expect(item.data).not.toContain('尾段不应出现')
  })

  it('同文件多个命中各自展开预览，未命中小节仍按原文顺序列出', async () => {
    rebuildCorpus({
      'base/双命中.md': [
        '# 双命中体系',
        '',
        '## 甲节',
        '',
        '共同关键词甲。',
        '',
        '## 乙节',
        '',
        '共同关键词乙。',
        '',
        '## 丙节',
        '',
        '第三段内容。',
        '',
      ].join('\n'),
    })
    const first = directory.sections.find((section) => section.heading === '甲节')!
    const second = directory.sections.find((section) => section.heading === '乙节')!
    const third = directory.sections.find((section) => section.heading === '丙节')!
    const item = (await makeExecutor().executeStep([call('a', 'rag_search', { query: '共同关键词' })])).results[0]!

    expect(item.data).toContain(`  ${hitRowFor(first)}`)
    expect(item.data).toContain('    > 共同关键词甲。')
    expect(item.data).toContain(`  ${hitRowFor(second)}`)
    expect(item.data).toContain('    > 共同关键词乙。')
    expect(item.data).toContain(`  - ${third.heading}`)
    expect(item.data).not.toContain(third.sectionId)
  })

  it('同一来源快照：展示的小节正文与检索块一致', async () => {
    const result = await makeExecutor().executeStep([call('a', 'rag_search', { query: '制造站效率' })])
    const item = result.results[0]!
    const efficiency = directory.sections.find((section) => section.heading === '效率')!
    expect(efficiency.body).toBe('制造站效率由干员技能决定，效率上限为 25%。')
    expect(item.data).toContain(efficiency.body)
  })

  it('默认送达缺少小节目录时报错，不返回没有阅读 ID 的正文', async () => {
    const result = await makeExecutor({}, false).executeStep([call('a', 'rag_search', { query: '制造站效率' })])
    const item = result.results[0]!
    expect(item.status).toBe('error')
    expect(item.data).toContain('无法定位命中块的原文阅读范围')
    expect(item.data).not.toContain('sec-')
    expect(item.data).not.toContain('【文件目录】')
    expect(item.data).not.toContain('制造站效率由干员技能决定')
    expect(item.fragmentRanges).toBeUndefined()
    expect(result.snapshot.successUsed).toBe(0)
  })

  it('命中标题前首部时标记落在根行，预览挂在根行之下', async () => {
    rebuildCorpus({
      'base/首部.md': ['# 首部体系', '', '独有词在首部。', '', '## 小节', '', '无关正文。', ''].join('\n'),
    })
    const section = directory.sections.find((item) => item.heading === '小节')!
    const result = await makeExecutor().executeStep([call('a', 'rag_search', { query: '独有词' })])
    const item = result.results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain(rootRowFor('base/首部.md', true))
    expect(item.data).toContain('  > # 首部体系')
    expect(item.data).toContain('  > 独有词在首部。')
    expect(item.data).toContain(`  - ${section.heading}`)
    expect(item.data).not.toContain(section.sectionId)
  })

  it('无 H1 的文件以文件名作根标题', async () => {
    rebuildCorpus({ 'base/无题.md': ['', '## 顶层节', '', '独有词正文。', ''].join('\n') })
    const top = directory.sections.find((section) => section.heading === '顶层节')!
    const result = await makeExecutor().executeStep([call('a', 'rag_search', { query: '独有词' })])
    const item = result.results[0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain(rootRowFor('base/无题.md'))
    expect(item.data).toContain(`  ${hitRowFor(top)}`)
  })

  it('预算不足时整棵非命中子树折叠为一行计数', async () => {
    rebuildCorpus({
      'base/折叠.md': [
        '# 折叠体系',
        '',
        '## 命中节',
        '',
        '独有词正文。',
        '',
        '## 长子树',
        '',
        '### 子一',
        '',
        '无关正文一。',
        '',
        '### 子二',
        '',
        '无关正文二。',
        '',
      ].join('\n'),
    })
    const hit = directory.sections.find((section) => section.heading === '命中节')!
    const full = (await makeExecutor().executeStep([call('a', 'rag_search', { query: '独有词' })])).results[0]!.data
    const tight = (await makeExecutor({ maxContextChars: full.length - 1 }).executeStep([
      call('b', 'rag_search', { query: '独有词' }),
    ])).results[0]!

    expect(tight.status).toBe('success')
    expect(tight.data).toContain(`  ${hitRowFor(hit)}`)
    expect(tight.data).toContain('    > 独有词正文。')
    expect(tight.data).toContain('  - 长子树（含 2 个小节未展开）')
    expect(tight.data).not.toContain('子一')
    expect(tight.data).not.toContain('子二')
    expect(tight.data.length).toBeLessThanOrEqual(full.length - 1)
  })

  it('预算不足时命中节点与其预览优先，其余结构行整行省略', async () => {
    const efficiency = directory.sections.find((section) => section.heading === '效率')!
    const scheduling = directory.sections.find((section) => section.heading === '排班')!
    const full = (await makeExecutor().executeStep([call('a', 'rag_search', { query: '25%' })])).results[0]!.data
    const preview = `      > ${efficiency.body}`
    const previewEnd = full.indexOf(preview) + preview.length
    const tight = (await makeExecutor({ maxContextChars: previewEnd }).executeStep([
      call('b', 'rag_search', { query: '25%' }),
    ])).results[0]!

    expect(tight.data).toBe(full.slice(0, previewEnd))
    expect(tight.data).toContain(hitRowFor(efficiency))
    expect(tight.data).not.toContain(scheduling.heading)
    expect(tight.data).not.toContain('…（截断）')
    expect(tight.data.length).toBeLessThanOrEqual(previewEnd)
  })

  it('预算只够表头时返回容量错误，不发送没有阅读 ID 的树', async () => {
    const item = (await makeExecutor({ maxContextChars: TREE_HEADER.length }).executeStep([
      call('a', 'rag_search', { query: '制造站效率' }),
    ])).results[0]!

    expect(item.status).toBe('error')
    expect(item.data).toContain('无法在 maxContextChars=')
    expect(item.data).not.toContain('sec-')
    expect(item.injectedIds).toEqual([])
    expect(item.fragmentRanges).toEqual([])
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

  it('通过整篇入口读取含多个子节的原文并连续续读', async () => {
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
    const doc = directory.documentRange('base/长父章.md')!
    expect(parent.body).toContain('子一正文。')
    expect(parent.body).toContain('子二正文。')

    // 目录树只给整篇入口：模型从根行取 doc ID 读取含全部子节的原文。
    const rag = await makeExecutor().executeStep([call('r', 'rag_search', { query: '子一正文' })])
    expect(rag.results[0]!.data).toContain(`全文 ${doc.body.length} 字符`)

    const executor = makeExecutor()
    let offset = 0
    let collected = ''
    let pages = 0
    for (let page = 0; page < 10; page++) {
      const result = await executor.executeStep([
        call(`p${page}`, 'read', { section_id: doc.sectionId, offset }),
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
    expect(collected).toBe(doc.body)
    expect(collected).toContain('子一正文。')
    expect(collected).toContain('子二正文。')
    expect(executor.snapshot().successUsed).toBe(pages)
  })
})
