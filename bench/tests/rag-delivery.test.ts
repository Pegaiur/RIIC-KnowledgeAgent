/**
 * RAG 默认送达契约（ADR-022 决策 7 + 目录树第二轮）：按命中文件给出 Markdown 目录树，
 * 命中行带小节 ID 与 ◆ 并就地展开前 100 个字符的正文预览，文件根行给整篇入口与全文规模；
 * 非命中节点只给标题；预览按同一次装配快照的文档正文坐标登记为命中片段；
 * 只有命中行带关联事实入口，不再输出上级范围入口和父级引导。
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

/** 从目录树输出里取出命中预览行（`> ` 前缀）拼接的原文。 */
function previewText(data: string): string {
  return data
    .split('\n')
    .filter((line) => /^\s*> /.test(line))
    .map((line) => line.replace(/^\s*> ?/, ''))
    .join('\n')
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

const LONG_DOC = [
  '# 长体系',
  '',
  '## 长节',
  '',
  ...Array.from({ length: 40 }, (_, index) => `第${index + 1}行关键词正文内容。`),
  '',
].join('\n')

describe('RAG 默认送达：同文件目录树（ADR-022 决策 7）', () => {
  it('目录树给根行与命中行，命中就地展开预览并登记连续片段', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })
    const chunk = chunkFor(corpus, '站点甲')
    const section = sectionFor(corpus, '站点甲')
    const doc = corpus.directory.documentRange('base/制造.md')!

    const item = await run(executorFor(corpus), 'rag_search', { query: '站点说明' })

    expect(item.status).toBe('success')
    expect(item.data).toContain(`- 体系丙｜${doc.sectionId}｜全文 ${doc.body.length} 字符`)
    expect(item.data).toContain(`  - ${section.sectionId}｜站点甲 ◆`)
    expect(item.data).toContain('    > 站点说明一段。')
    // 未命中的下级与同级小节只列标题，正文与整篇原文都不送达。
    expect(item.data).toContain('    - 效率乙')
    expect(item.data).toContain('  - 贸易丁')
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

  it('预算不足时命中行与预览优先，未命中结构行整行省略', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })
    const section = sectionFor(corpus, '站点甲')
    const full = await run(executorFor(corpus), 'rag_search', { query: '站点说明' })
    const preview = '    > 站点说明一段。'
    const maxChars = full.data.indexOf(preview) + preview.length

    const item = await run(executorFor(corpus, { maxContextChars: maxChars }), 'rag_search', { query: '站点说明' })

    expect(item.status).toBe('success')
    expect(item.data).toBe(full.data.slice(0, maxChars))
    expect(item.data).toContain(`  - ${section.sectionId}｜站点甲 ◆`)
    expect(item.data).not.toContain('效率乙')
    expect(item.data).not.toContain('贸易丁')
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

  it('命中前的结构子树让出预算，保留后续命中与预览', async () => {
    const corpus = buildCorpus({
      'base/预算.md': '# 预算\n\n## 前节\n\n### 前子节\n\n无关。\n\n## 命中\n\n独有词正文。\n',
    })
    const full = await run(executorFor(corpus), 'rag_search', { query: '独有词' })
    const expected = full.data.replace('  - 前节\n    - 前子节\n', '')

    const item = await run(executorFor(corpus, { maxContextChars: expected.length }), 'rag_search', { query: '独有词' })

    expect(item.status).toBe('success')
    expect(item.data).toBe(expected)
    expect(item.injectedIds).toEqual([chunkFor(corpus, '命中').id])
  })

  it('先保留所有命中 ID，再用余量送达完整预览', async () => {
    const corpus = buildCorpus({
      'base/双节.md': `# 双节\n\n## 甲节\n\n独有词${'甲'.repeat(90)}\n\n## 乙节\n\n独有词乙。\n`,
    })
    const full = await run(executorFor(corpus), 'rag_search', { query: '独有词' })
    const expected = full.data.replace(/\n    > 独有词甲+/, '')

    const item = await run(executorFor(corpus, { maxContextChars: expected.length }), 'rag_search', { query: '独有词' })

    expect(item.status).toBe('success')
    expect(item.data).toBe(expected)
    expect(item.injectedIds).toEqual([chunkFor(corpus, '乙节').id])
    expect(item.fragmentRanges?.map((range) => range.chunkId)).toEqual(item.injectedIds)
  })

  it('预览取原文切片，保留首行缩进并与片段坐标一致', async () => {
    const corpus = buildCorpus({ 'base/缩进.md': '# 缩进\n\n## 命中\n\n  独有词正文。\n' })
    const item = await run(executorFor(corpus), 'rag_search', { query: '独有词' })
    const range = item.fragmentRanges![0]!
    const source = corpus.directory.documentRange(range.file)!.body.slice(range.docOffset, range.docEndOffset)

    expect(item.status).toBe('success')
    expect(source).toBe('  独有词正文。')
    expect(previewText(item.data)).toBe(source)
  })

  it('检索块经过压缩时预览仍来自连续原文，长度标记取原文块', async () => {
    const corpus = buildCorpus({ 'base/压缩.md': `# 压缩\n\n## 命中\n\n独有词${'甲'.repeat(120)}尾段。\n` })
    corpus.chunks = corpus.chunks.map((chunk) => chunk.heading === '命中'
      ? { ...chunk, text: '独有词…（中段省略）…尾段。' }
      : chunk)
    const item = await run(executorFor(corpus), 'rag_search', { query: '独有词' })
    const section = sectionFor(corpus, '命中')
    const range = item.fragmentRanges![0]!
    const source = corpus.directory.documentRange(range.file)!.body.slice(range.docOffset, range.docEndOffset)

    expect(item.status).toBe('success')
    expect(source).toBe(section.body.slice(0, 100))
    expect(previewText(item.data)).toBe(`${source}…（截断，全文 ${section.body.length} 字符）`)
  })

  it('预览超过 100 个字符时截断并标全文长度，命中行 ID 可续读整块', async () => {
    const corpus = buildCorpus({ 'base/长.md': LONG_DOC })
    const section = sectionFor(corpus, '长节')
    const chunk = chunkFor(corpus, '长节')
    const doc = corpus.directory.documentRange('base/长.md')!

    const item = await run(executorFor(corpus), 'rag_search', { query: '关键词正文内容' })
    const head = chunk.text.slice(0, 100)
    const range = item.fragmentRanges![0]!

    expect(item.status).toBe('success')
    expect(head.length).toBe(100)
    expect(previewText(item.data)).toBe(`${head}…（截断，全文 ${chunk.text.length} 字符）`)
    expect(range).toMatchObject({
      kind: 'hit',
      file: 'base/长.md',
      sectionId: section.sectionId,
      chunkId: chunk.id,
      startLine: section.startLine,
      endLine: section.startLine + (head.match(/\n/g)?.length ?? 0),
    })
    expect(doc.body.slice(range.docOffset, range.docEndOffset)).toBe(head)

    // 用命中行给出的 ID 读取整块：一次读取覆盖完整正文。
    const continued = await run(executorFor(corpus), 'read', { section_id: section.sectionId })
    expect(continued.status).toBe('success')
    expect(parseReadSection(continued.data)).toBe(section.body)
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
