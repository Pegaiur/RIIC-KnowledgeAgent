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
  const config = { ...loadConfig(), retriever: 'bm25' as const, ...overrides }
  return createKnowledgeToolExecutor({
    config,
    query: { id: 'SECTION-NAV', category: 'fact', question: '制造站效率' },
    chunks,
    index: buildIndex(chunks),
    ...(withSections ? { sections: directory } : {}),
  }, 5)
}

function blockFor(chunk: DocChunk): string {
  const section = directory.findByChunk(chunk.file, chunk.heading, chunk.startLine)!
  return `【${chunk.file} | ${chunk.heading} | L${chunk.startLine}-${chunk.endLine} | ${section.sectionId}】\n${chunk.text}`
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
}

function parsePage(data: string): ParsedPage {
  const lines = data.split('\n')
  const match = /offset：(\d+)｜next_offset：(\d+|null)｜complete：(true|false)/.exec(lines[2] ?? '')
  if (!match) throw new Error(`无法解析 read_section 输出：${data}`)
  return {
    page: lines.slice(4).join('\n'),
    offset: Number(match[1]),
    nextOffset: match[2] === 'null' ? null : Number(match[2]),
    complete: match[3] === 'true',
  }
}

describe('RAG 展示：标题上下文与导航', () => {
  it('命中片段带 sectionId，并附标题路径、父级引导与导航', async () => {
    const result = await makeExecutor().executeBatch([call('a', 'rag_search', { query: '制造站效率' })])
    const item = result.results[0]!
    const efficiency = directory.sections.find((section) => section.heading === '效率')!

    expect(item.status).toBe('success')
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
    const result = await makeExecutor().executeBatch([call('a', 'rag_search', { query: '制造站效率' })])
    const item = result.results[0]!
    const efficiency = directory.sections.find((section) => section.heading === '效率')!
    expect(efficiency.body).toBe('制造站效率由干员技能决定，效率上限为 25%。')
    expect(item.data).toContain(efficiency.body)
  })

  it('预算只够命中正文时不附加上下文，且 injectedIds 与真实送达一致', async () => {
    const hits = search(buildIndex(chunks), '制造站效率', 5)
    const firstBlock = blockFor(chunks[hits[0]!]!)
    const result = await makeExecutor({ maxContextChars: firstBlock.length }).executeBatch([
      call('a', 'rag_search', { query: '制造站效率' }),
    ])
    const item = result.results[0]!

    expect(item.data).toBe(firstBlock)
    expect(item.data).not.toContain('【小节上下文】')
    expect(item.injectedIds).toEqual([chunks[hits[0]!]!.id])
    expect(item.data.length).toBeLessThanOrEqual(firstBlock.length)
  })

  it('无小节目录时退回原格式，不出现小节标识', async () => {
    const result = await makeExecutor({}, false).executeBatch([call('a', 'rag_search', { query: '制造站效率' })])
    const item = result.results[0]!
    expect(item.status).toBe('success')
    expect(item.data).not.toContain('sec-')
    expect(item.data).not.toContain('【小节上下文】')
    expect(item.data).toContain('【base/制造.md | 效率 | L11-11】')
  })

  it('grep 结果格式不受小节目录影响', async () => {
    const result = await makeExecutor({ retriever: 'grep' }).executeBatch([call('a', 'grep_search', { query: '制造站效率' })])
    const item = result.results[0]!
    expect(item.status).toBe('success')
    expect(item.data).not.toContain('sec-')
    expect(item.data).not.toContain('【小节上下文】')
    expect(item.data).toContain('命中')
  })
})

describe('read_section：按小节读取原文', () => {
  function efficiencyId(): string {
    return directory.sections.find((section) => section.heading === '效率')!.sectionId
  }

  it('返回固定格式的原文页，含小节标识、标题路径、行范围与分页元数据', async () => {
    const sectionId = efficiencyId()
    const result = await makeExecutor().executeBatch([call('read', 'read_section', { section_id: sectionId })])
    const item = result.results[0]!
    expect(item.status).toBe('success')
    expect(item.data).toContain(`【read_section】${sectionId}`)
    expect(item.data).toContain('标题路径：制造体系 > 制造站 > 效率')
    expect(item.data).toContain('行范围：L11-11')
    expect(item.data).toContain('offset：0｜next_offset：null｜complete：true')
    expect(item.data).toContain('制造站效率由干员技能决定，效率上限为 25%。')
    expect(item.hitIds).toEqual([])
    expect(item.injectedIds).toEqual([])
  })

  it('offset 等于正文长度返回成功空页，超过长度返回参数错误', async () => {
    const sectionId = efficiencyId()
    const bodyLength = directory.get(sectionId)!.body.length
    const exact = await makeExecutor().executeBatch([call('end', 'read_section', { section_id: sectionId, offset: bodyLength })])
    expect(exact.results[0]).toMatchObject({ status: 'success', executed: true })
    expect(parsePage(exact.results[0]!.data)).toMatchObject({ page: '', nextOffset: null, complete: true })

    const overflow = await makeExecutor().executeBatch([call('over', 'read_section', { section_id: sectionId, offset: bodyLength + 1 })])
    expect(overflow.results[0]).toMatchObject({ status: 'invalid_params', executed: false })
  })

  it('未知小节 ID 返回 empty，不退回模糊搜索', async () => {
    const result = await makeExecutor().executeBatch([call('missing', 'read_section', { section_id: 'sec-不存在' })])
    expect(result.results[0]).toMatchObject({ status: 'empty', executed: true })
    expect(result.results[0]!.data).toContain('没有该小节')
  })

  it('非法参数拒绝执行：缺 section_id、多余字段、非整数或负 offset', async () => {
    const sectionId = efficiencyId()
    const result = await makeExecutor().executeBatch([
      call('a', 'read_section', {}),
      call('b', 'read_section', { section_id: sectionId, extra: 1 }),
      call('c', 'read_section', { section_id: sectionId, offset: -1 }),
      call('d', 'read_section', { section_id: sectionId, offset: 1.5 }),
      call('e', 'read_section', { section_id: sectionId, offset: '0' }),
    ])
    expect(result.results.map((item) => item.status)).toEqual(['invalid_params', 'invalid_params', 'invalid_params', 'invalid_params', 'invalid_params'])
    expect(result.results.every((item) => !item.executed)).toBe(true)
    expect(result.snapshot).toMatchObject({ used: 5, executed: 0 })
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
      const result = await executor.executeBatch([call(`p${page}`, 'read_section', { section_id: section.sectionId, offset })])
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
    expect(executor.snapshot().used).toBeGreaterThanOrEqual(2)
  })

  it('无小节目录时明确返回本运行无法读取', async () => {
    const result = await makeExecutor({}, false).executeBatch([call('a', 'read_section', { section_id: 'sec-任意' })])
    expect(result.results[0]).toMatchObject({ status: 'empty', executed: true })
    expect(result.results[0]!.data).toContain('未启用小节阅读')
  })
})
