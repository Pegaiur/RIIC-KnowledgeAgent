/**
 * RAG 默认送达契约（ADR-022 决策 7）：只送达命中小节所在块，块头带小节 ID、来源与原文范围；
 * 必要元数据优先于正文，超预算时连续截取并给出可复制的 read 续读入口；
 * 片段范围按同一次装配快照的文档正文坐标登记，覆盖命中的命中片段与父级引导。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { collectMarkdownFiles, splitChunks } from '../src/corpus.js'
import { buildIndex } from '../src/retriever.js'
import { buildSectionDirectory, type SectionDirectory, type SectionEntry } from '../src/sections.js'
import { createKnowledgeToolExecutor, type ToolExecutionResult } from '../src/tool-executor.js'
import type { DocChunk, ToolCall } from '../src/types.js'

const roots: string[] = []
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

interface Corpus {
  dir: string
  chunks: DocChunk[]
  directory: SectionDirectory
}

function buildCorpus(files: Record<string, string>): Corpus {
  const dir = mkdtempSync(join(tmpdir(), 'rag-delivery-'))
  roots.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  writeFileSync(join(dir, 'corpus-manifest.json'), JSON.stringify({ files: Object.keys(files) }), 'utf-8')
  const chunks = collectMarkdownFiles(dir).flatMap((file) => splitChunks(file, dir))
  return { dir, chunks, directory: buildSectionDirectory(dir) }
}

function call(id: string, name: string, params: unknown): ToolCall {
  return { id, name, arguments: JSON.stringify(params) }
}

function executorFor(corpus: Corpus, overrides: Partial<BenchConfig> = {}) {
  const config = { ...loadConfig(), retriever: 'bm25' as const, corpusDir: corpus.dir, ...overrides }
  return createKnowledgeToolExecutor({
    config,
    query: { id: 'RAG-DELIVERY', category: 'fact', question: '关键词' },
    chunks: corpus.chunks,
    index: buildIndex(corpus.chunks),
    sections: corpus.directory,
  }, 5)
}

async function run(exec: ReturnType<typeof executorFor>, name: string, params: unknown): Promise<ToolExecutionResult> {
  const batch = await exec.executeStep([call('t', name, params)])
  return batch.results[0]!
}

/** 从默认送达的命中块输出中取出块头、连续正文页与续读元数据。 */
function parseHitBlock(data: string): { header: string; page: string; continuation: string | undefined } {
  const lines = data.split('\n')
  const metaIndex = lines.findIndex((line) => line.startsWith('续读：'))
  const bodyEnd = metaIndex < 0 ? lines.length : metaIndex
  return { header: lines[0] ?? '', page: lines.slice(1, bodyEnd).join('\n'), continuation: metaIndex < 0 ? undefined : lines[metaIndex] }
}

/** 从 read 输出中取出本页原文。 */
function parseReadSection(data: string): string {
  const marker = '\n【原文】\n'
  const start = data.indexOf(marker)
  if (start < 0) throw new Error(`无法解析 read 输出：${data}`)
  const rest = data.slice(start + marker.length)
  const page = rest.split(/\n(?=【(?:关联事实|导航)】)/u)[0] ?? ''
  return page === '（无本页内容）' ? '' : page
}

/** 文档正文中某一行的起始 UTF-16 偏移（与 fragmentRanges/readDelivery 的同坐标口径一致）。 */
function lineOffset(docBody: string, docStartLine: number, line: number): number {
  const lines = docBody.split('\n')
  const index = Math.max(0, Math.min(line - docStartLine, lines.length))
  return index === 0 ? 0 : lines.slice(0, index).join('\n').length + 1
}

function sectionFor(corpus: Corpus, heading: string): SectionEntry {
  const section = corpus.directory.sections.find((item) => item.heading === heading)
  if (!section) throw new Error(`测试语料缺少小节：${heading}`)
  return section
}

function chunkFor(corpus: Corpus, heading: string): DocChunk {
  const chunk = corpus.chunks.find((item) => item.heading === heading)
  if (!chunk) throw new Error(`测试语料缺少切块：${heading}`)
  return chunk
}

const DOC = [
  '# 体系丙',
  '',
  '体系丙前言。',
  '',
  '## 站点甲',
  '',
  '站点说明一段。',
  '',
  '### 效率乙',
  '',
  '效率数值一段。',
  '',
  '## 贸易丁',
  '',
  '贸易往来一段。',
  '',
].join('\n')

const PARENT_DOC = [
  '# 甲体系',
  '',
  '甲体系前言。',
  '',
  '## 甲节',
  '',
  '甲节正文。',
  '',
  '### 甲子节',
  '',
  '甲子节正文。',
  '',
].join('\n')

const LONG_DOC = [
  '# 长体系',
  '',
  '## 长节',
  '',
  ...Array.from({ length: 40 }, (_, index) => `第${index + 1}行关键词正文内容。`),
  '',
].join('\n')

describe('RAG 默认送达：命中小节块（ADR-022 决策 7）', () => {
  it('块头含小节 ID、来源与原文范围，正文止于下一个 H2/H3 边界', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })
    const chunk = chunkFor(corpus, '站点甲')
    const section = sectionFor(corpus, '站点甲')
    const doc = corpus.directory.documentRange('base/制造.md')!

    const item = await run(executorFor(corpus), 'rag_search', { query: '站点说明' })

    expect(item.status).toBe('success')
    expect(item.data).toContain(`【base/制造.md | 站点甲 | L${chunk.startLine}-${chunk.endLine} | ${section.sectionId}】`)
    expect(item.data).toContain('站点说明一段。')
    // 未命中的下级小节不随命中块送达，也不把整篇原文标成送达。
    expect(item.data).not.toContain('效率数值一段。')
    expect(item.data).not.toContain('原文扩展')
    expect(item.fulltextRanges).toEqual([])
    expect(item.injectedIds).toEqual([chunk.id])

    const range = item.fragmentRanges!.find((entry) => entry.chunkId === chunk.id)!
    const docOffset = lineOffset(doc.body, doc.startLine, chunk.startLine)
    expect(range).toEqual({
      kind: 'hit',
      file: 'base/制造.md',
      sectionId: section.sectionId,
      chunkId: chunk.id,
      docOffset,
      docEndOffset: docOffset + '站点说明一段。'.length,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
    })
    expect(doc.body.slice(range.docOffset, range.docEndOffset)).toBe('站点说明一段。')
  })

  it('末尾上下文装不下时命中小节 ID 仍随块送达', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })
    const chunk = chunkFor(corpus, '站点甲')
    const section = sectionFor(corpus, '站点甲')
    const block = `【base/制造.md | 站点甲 | L${chunk.startLine}-${chunk.endLine} | ${section.sectionId}】\n站点说明一段。`

    const item = await run(executorFor(corpus, { maxContextChars: block.length + 1 }), 'rag_search', { query: '站点说明' })

    expect(item.status).toBe('success')
    expect(item.data).toContain(`| ${section.sectionId}】`)
    expect(item.data).toContain('站点说明一段。')
    expect(item.data).not.toContain('【小节导航】')
  })

  it('容量连必要元数据加正文都放不下时不发送该块，也不输出被截断的 ID', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })

    const item = await run(executorFor(corpus, { maxContextChars: 20 }), 'rag_search', { query: '站点说明' })

    expect(item.status).toBe('error')
    expect(item.data).toContain('无法在 maxContextChars=20 内返回命中块')
    expect(item.data).not.toContain('sec-')
    expect(item.data).not.toContain('站点说明一段。')
    expect(item.injectedIds).toEqual([])
    expect(item.fragmentRanges).toEqual([])
  })

  it('超过预算时连续截取并给出可复制的 read 续读入口，续读拼接覆盖整块', async () => {
    const corpus = buildCorpus({ 'base/长.md': LONG_DOC })
    const section = sectionFor(corpus, '长节')
    const doc = corpus.directory.documentRange('base/长.md')!

    const item = await run(executorFor(corpus, { maxContextChars: 200 }), 'rag_search', { query: '关键词正文内容' })
    const parsed = parseHitBlock(item.data)
    const range = item.fragmentRanges![0]!
    const continuation = /^续读：read\(section_id="([^"]+)", offset=(\d+)\)｜complete false｜正文 (\d+) 字符$/.exec(parsed.continuation ?? '')

    expect(item.status).toBe('success')
    expect(parsed.page.length).toBeGreaterThan(0)
    expect(parsed.page.length).toBeLessThan(section.body.length)
    // 连续截取：送达页是块正文的前缀，不做首尾压缩。
    expect(section.body.startsWith(parsed.page)).toBe(true)
    expect(continuation?.[1]).toBe(section.sectionId)
    expect(continuation?.[3]).toBe(String(section.body.length))
    expect(range).toMatchObject({
      kind: 'hit',
      file: 'base/长.md',
      sectionId: section.sectionId,
      startLine: section.startLine,
      endLine: section.startLine + (parsed.page.match(/\n/g)?.length ?? 0),
    })
    expect(doc.body.slice(range.docOffset, range.docEndOffset)).toBe(parsed.page)

    // 用返回的 ID 与 offset 续读：两页拼接覆盖整块且无缺口。
    const offset = Number(continuation?.[2])
    const continued = await run(executorFor(corpus), 'read', { section_id: section.sectionId, offset })

    expect(continued.status).toBe('success')
    expect(`${parsed.page}${parseReadSection(continued.data)}`).toBe(section.body)
  })

  it('父级引导按实际送达登记连续范围，不漏算为新证据', async () => {
    const corpus = buildCorpus({ 'base/甲.md': PARENT_DOC })
    const child = sectionFor(corpus, '甲子节')
    const parent = sectionFor(corpus, '甲节')
    const doc = corpus.directory.documentRange('base/甲.md')!
    const lead = corpus.directory.contextFor(child.sectionId)!.parentLead!

    const item = await run(executorFor(corpus), 'rag_search', { query: '甲子节正文' })
    const parentRange = item.fragmentRanges!.find((entry) => entry.kind === 'parent_lead' && entry.sectionId === parent.sectionId)!

    expect(item.data).toContain(`父级引导（L${lead.startLine}-${lead.endLine}）：${lead.text}`)
    expect(parentRange).toMatchObject({
      kind: 'parent_lead',
      file: 'base/甲.md',
      sectionId: parent.sectionId,
      startLine: lead.startLine,
      endLine: lead.endLine,
    })
    expect(doc.body.slice(parentRange.docOffset, parentRange.docEndOffset)).toBe(lead.text)
  })

  it('长父级引导只登记实际显示的连续前缀，余量不足时整条省略', async () => {
    const lead = `${'前'.repeat(298)}😀${'后'.repeat(80)}\n未送达的尾行。`
    const corpus = buildCorpus({ 'base/甲.md': PARENT_DOC.replace('甲节正文。', lead) })
    const parent = sectionFor(corpus, '甲节')
    const doc = corpus.directory.documentRange('base/甲.md')!
    const full = await run(executorFor(corpus, { topK: 1 }), 'rag_search', { query: '甲子节正文' })
    const range = full.fragmentRanges!.find((entry) => entry.kind === 'parent_lead')!
    const delivered = `${'前'.repeat(298)}😀`

    expect(full.data).toContain(`父级引导（L${parent.startLine}-${parent.startLine}）：${delivered}…（截断）`)
    expect(doc.body.slice(range.docOffset, range.docEndOffset)).toBe(delivered)
    expect(range.endLine).toBe(parent.startLine)
    expect(full.data).not.toContain('未送达的尾行')

    const leadStart = full.data.indexOf('  父级引导')
    const tight = await run(executorFor(corpus, { topK: 1, maxContextChars: leadStart + 80 }), 'rag_search', { query: '甲子节正文' })
    expect(tight.data).not.toContain('父级引导')
    expect(tight.fragmentRanges!.filter((entry) => entry.kind === 'parent_lead')).toEqual([])
  })

  it('RAG 容量不足但独立 facts 额度送达卡片时仍计一次成功', async () => {
    const corpus = buildCorpus({ 'base/甲.md': '# 测试\n\n## 温蒂\n\n温蒂的技能说明。\n' })
    const exec = executorFor(corpus, { retriever: 'hybrid', maxContextChars: 20, attachFacts: true })
    const item = await run(exec, 'rag_search', { query: '温蒂' })

    expect(item.data).toContain('【温蒂】')
    expect(item.injectedIds).toEqual([])
    expect(item.fragmentRanges).toEqual([])
    expect(item.attachedFacts).toEqual([expect.objectContaining({ delivered: ['温蒂'] })])
    expect(item.status).toBe('success')
    expect(exec.snapshot()).toMatchObject({ successUsed: 1, attemptUsed: 1 })
  })

  it('显式扩展原文时继续用 fulltextRanges，不重复登记片段范围', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })

    const item = await run(executorFor(corpus, { expandFulltext: true }), 'rag_search', { query: '制造站引言甲' })

    expect(item.fulltextRanges!.length).toBeGreaterThan(0)
    expect(item.fragmentRanges).toEqual([])
    expect(item.data).toContain('原文扩展')
  })
})
