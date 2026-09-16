import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { collectMarkdownFiles, splitChunks } from '../src/corpus.js'
import { buildIndex } from '../src/retriever.js'
import { buildSectionDirectory, type SectionDirectory } from '../src/sections.js'
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
  const dir = mkdtempSync(join(tmpdir(), 'rag-fulltext-'))
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
  const config = { ...loadConfig(), retriever: 'bm25' as const, corpusDir: corpus.dir, expandFulltext: true, ...overrides }
  return createKnowledgeToolExecutor({
    config,
    query: { id: 'FULLTEXT', category: 'fact', question: '关键词' },
    chunks: corpus.chunks,
    index: buildIndex(corpus.chunks),
    sections: corpus.directory,
  }, 5)
}

async function run(exec: ReturnType<typeof executorFor>, name: string, params: unknown): Promise<ToolExecutionResult> {
  const batch = await exec.executeStep([call('t', name, params)])
  return batch.results[0]!
}

/** 从 rag_search 的原文扩展输出中取出正文前缀与续读元数据。 */
function parseFulltext(data: string): { header: string; page: string; meta: string | undefined } {
  const lines = data.split('\n')
  const metaIndex = lines.findIndex((line) => line.startsWith('续读：'))
  const bodyEnd = metaIndex < 0 ? lines.length : metaIndex
  return { header: lines[0] ?? '', page: lines.slice(1, bodyEnd).join('\n'), meta: metaIndex < 0 ? undefined : lines[metaIndex] }
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

function longDocument(sections: number): string {
  const lines = ['# 长文档', '']
  for (let i = 1; i <= sections; i++) lines.push(`## 小节${i}`, '', `第${i}段关键词正文内容。`, '')
  return lines.join('\n')
}

const DOC = [
  '# 制造体系',
  '',
  '制造体系前言。',
  '',
  '## 制造站',
  '',
  '制造站引言，关键词甲。',
  '',
  '### 效率',
  '',
  '效率关键词乙。',
  '',
  '## 贸易站',
  '',
  '贸易关键词丙。',
  '',
].join('\n')

describe('原文扩展：命中文件扩展到文档范围（ADR-013 步骤 2）', () => {
  it('base 命中扩展整篇原文（含标题前首部与后续小节），injectedIds 保持 chunk 语义', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC, 'guides/名册.md': '# 名册\n\n名册正文。\n' })
    const doc = corpus.directory.documentRange('base/制造.md')!
    const item = await run(executorFor(corpus), 'rag_search', { query: '制造站' })

    expect(item.status).toBe('success')
    expect(item.data).toContain(`【base/制造.md｜原文扩展｜L${doc.startLine}-${doc.endLine}】`)
    expect(item.data).toContain('制造体系前言。')
    expect(item.data).toContain('效率关键词乙。')
    expect(item.data).toContain('贸易关键词丙。')
    expect(item.injectedIds?.every((id) => !id.startsWith('doc:'))).toBe(true)
    expect(item.fulltextRanges).toEqual([
      expect.objectContaining({ file: 'base/制造.md', docId: 'doc:base/制造.md', offset: 0, complete: true, nextOffset: null }),
    ])
  })

  it('同文件多命中去重，只按首次命中送达一次整篇原文', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })
    const item = await run(executorFor(corpus), 'rag_search', { query: '关键词' })

    expect(item.fulltextRanges).toHaveLength(1)
    expect(item.data.split('【base/制造.md｜原文扩展').length - 1).toBe(1)
    expect(item.injectedIds).toHaveLength(1)
  })

  it('raw 目录不在检索范围：manifest 显式登记 raw 条目被拒绝', () => {
    expect(() => buildCorpus({ 'raw/名册.md': '# 名册\n\n## 名册节\n\n名册关键词。\n' }))
      .toThrow('语料白名单只允许登记 base/ 与 guides/ 下的文件：raw/名册.md')
  })

  it('关闭扩展时退回原块拼接（对照组合），不产生扩展范围', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })
    const item = await run(executorFor(corpus, { expandFulltext: false }), 'rag_search', { query: '制造站' })

    expect(item.data).not.toContain('原文扩展')
    expect(item.fulltextRanges).toEqual([])
    expect(item.data).toContain('制造站引言，关键词甲。')
  })

  it('目录缺少该文档范围时退回原块按行送达，不伪造原文扩展', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })
    // 目录与检索块来自不同装配：命中文件不在目录中，覆盖「无文档范围」的防御分支。
    const otherDirectory = buildCorpus({ 'guides/别的.md': '# 别的\n\n别的正文。\n' })
    const exec = createKnowledgeToolExecutor({
      config: { ...loadConfig(), retriever: 'bm25' as const, corpusDir: corpus.dir, expandFulltext: true },
      query: { id: 'FULLTEXT', category: 'fact', question: '关键词' },
      chunks: corpus.chunks,
      index: buildIndex(corpus.chunks),
      sections: otherDirectory.directory,
    }, 5)

    const item = await run(exec, 'rag_search', { query: '制造站' })

    expect(item.status).toBe('success')
    expect(item.fulltextRanges).toEqual([])
    expect(item.data).not.toContain('原文扩展')
    expect(item.data).toContain('制造站引言，关键词甲。')
  })

  it('恰好容纳整篇原文时判 complete，不产生续读元数据', async () => {
    const corpus = buildCorpus({ 'base/制造.md': DOC })
    const doc = corpus.directory.documentRange('base/制造.md')!
    const header = `【base/制造.md｜原文扩展｜L${doc.startLine}-${doc.endLine}】`
    const maxChars = header.length + 1 + doc.body.length

    const item = await run(executorFor(corpus, { maxContextChars: maxChars }), 'rag_search', { query: '制造站' })

    expect(item.status).toBe('success')
    expect(item.data).toBe(`${header}\n${doc.body}`)
    expect(item.fulltextRanges).toEqual([
      expect.objectContaining({ file: 'base/制造.md', complete: true, nextOffset: null, endOffset: doc.body.length }),
    ])
  })

  it('多文件命中按首次命中顺序扩展，跨文件稳定', async () => {
    const corpus = buildCorpus({
      'base/甲.md': '# 甲\n\n## 甲节\n\n关键词 关键词 关键词 关键词。\n',
      'base/乙.md': '# 乙\n\n## 乙节\n\n关键词。\n',
    })
    const item = await run(executorFor(corpus), 'rag_search', { query: '关键词' })

    expect(item.fulltextRanges!.map((range) => range.file)).toEqual(['base/甲.md', 'base/乙.md'])
    const bodies = item.fulltextRanges!.map((range) => corpus.directory.documentRange(range.file)!.body)
    for (const body of bodies) expect(item.data).toContain(body)
    expect(item.data.indexOf(bodies[0]!)).toBeLessThan(item.data.indexOf(bodies[1]!))
  })

  it('后续文件分页时保留此前整篇正文，送达区间与最终响应一致', async () => {
    const corpus = buildCorpus({
      'base/甲.md': `# 甲\n\n${'关键词 '.repeat(10)}甲尾部。\n`,
      'guides/乙.md': `# 乙\n\n关键词。\n${'乙长文正文。\n'.repeat(180)}`,
    })
    const item = await run(executorFor(corpus, { maxContextChars: 400 }), 'rag_search', { query: '关键词' })
    expect(item.fulltextRanges!.map((range) => [range.file, range.complete])).toEqual([
      ['base/甲.md', true], ['guides/乙.md', false],
    ])
    for (const range of item.fulltextRanges!) {
      const doc = corpus.directory.documentRange(range.file)!
      expect(item.data).toContain(doc.body.slice(range.offset, range.endOffset))
    }
    expect(item.data).toContain('续读：read(section_id="doc:guides/乙.md"')
    expect(item.data.length).toBeLessThanOrEqual(400)
  })
})

describe('原文扩展：容量不足时按可续读连续原文送达（ADR-013 步骤 2）', () => {
  it('整篇放不下时元数据先留位，记录 offset/行范围/complete/next_offset', async () => {
    const corpus = buildCorpus({ 'base/长.md': longDocument(40) })
    const doc = corpus.directory.documentRange('base/长.md')!
    const maxChars = `【base/长.md｜原文扩展｜L${doc.startLine}-${doc.endLine}】`.length + 1 + 200
    expect(doc.body.length).toBeGreaterThan(maxChars)

    const item = await run(executorFor(corpus, { maxContextChars: maxChars }), 'rag_search', { query: '小节1' })
    const parsed = parseFulltext(item.data)
    const range = item.fulltextRanges![0]!

    expect(item.status).toBe('success')
    expect(item.data).toContain('原文扩展')
    expect(parsed.meta).toContain('续读：read(section_id="doc:base/长.md"')
    expect(parsed.meta).toContain('complete false')
    expect(range).toMatchObject({ file: 'base/长.md', docId: 'doc:base/长.md', offset: 0, complete: false })
    expect(range.nextOffset).toBeGreaterThan(0)
    expect(range.endOffset).toBe(parsed.page.length)
    expect(doc.body.startsWith(parsed.page)).toBe(true)
    expect(range.endLine).toBe(doc.startLine + (parsed.page.match(/\n/g)?.length ?? 0))
  })

  it('用文档范围 ID 续读，首段与续读页拼接覆盖整篇且无缺口', async () => {
    const corpus = buildCorpus({ 'base/长.md': longDocument(40) })
    const doc = corpus.directory.documentRange('base/长.md')!
    const maxChars = `【base/长.md｜原文扩展｜L${doc.startLine}-${doc.endLine}】`.length + 1 + 200
    const exec = executorFor(corpus, { maxContextChars: maxChars })
    const item = await run(exec, 'rag_search', { query: '小节1' })
    const range = item.fulltextRanges![0]!
    const firstPage = parseFulltext(item.data).page

    const continued = await run(executorFor(corpus), 'read', { section_id: range.docId, offset: range.nextOffset })
    const readPage = parseReadSection(continued.data)

    expect(continued.status).toBe('success')
    expect(`${firstPage}${readPage}`).toBe(doc.body)
  })

  it('极小上限连必要元数据都放不下时返回明确容量错误，不伪装 empty', async () => {
    const corpus = buildCorpus({ 'base/长.md': longDocument(40) })
    const doc = corpus.directory.documentRange('base/长.md')!
    const maxChars = `【base/长.md｜原文扩展｜L${doc.startLine}-${doc.endLine}】`.length + 11

    const item = await run(executorFor(corpus, { maxContextChars: maxChars }), 'rag_search', { query: '小节1' })

    expect(item.status).toBe('error')
    expect(item.data).toContain(`无法在 maxContextChars=${maxChars} 内返回原文扩展`)
    // 操作返回的错误也写入 message，供 trace.error 与复盘定位；非 fatal，不扣成功额度。
    expect(item.message).toContain(`无法在 maxContextChars=${maxChars} 内返回原文扩展`)
    expect(item.fatal).toBeFalsy()
    expect(item.injectedIds).toEqual([])
    expect(item.fulltextRanges).toEqual([])
  })

  it('read 从正文中段读到尾部，offset 与原文对应', async () => {
    const corpus = buildCorpus({ 'base/长.md': longDocument(40) })
    const doc = corpus.directory.documentRange('base/长.md')!
    const mid = Math.floor(doc.body.length / 2)

    const item = await run(executorFor(corpus), 'read', { section_id: doc.sectionId, offset: mid })

    expect(item.status).toBe('success')
    const page = parseReadSection(item.data)
    expect(page.length).toBeGreaterThan(0)
    // 中段页必须是原文从 offset 起的连续前缀，不得跳过正文。
    expect(doc.body.startsWith(page, mid)).toBe(true)
  })

  it('超长行按行边界截断且不截断 UTF-16 代理对（非 BMP 字符）', async () => {
    // 单行正文（无换行）才能让行边界截断落在非 BMP 字符中间，验证代理对保护。
    const corpus = buildCorpus({ 'base/表情.md': `关键词${'😀'.repeat(300)}\n` })
    const doc = corpus.directory.documentRange('base/表情.md')!
    const metaReserve = `续读：read(section_id="doc:base/表情.md", offset=${doc.body.length})｜complete false｜正文 ${doc.body.length} 字符`.length
    const header = `【base/表情.md｜原文扩展｜L${doc.startLine}-${doc.endLine}】`
    const maxChars = header.length + 1 + metaReserve + 1 + 40

    expect(doc.body).not.toContain('\n')
    const item = await run(executorFor(corpus, { maxContextChars: maxChars }), 'rag_search', { query: '关键词' })
    const page = parseFulltext(item.data).page
    const range = item.fulltextRanges![0]!

    expect(item.status).toBe('success')
    expect(range.complete).toBe(false)
    expect(page.length).toBeGreaterThan(0)
    expect(doc.body.startsWith(page)).toBe(true)
    const lastCode = page.charCodeAt(page.length - 1)
    expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false)
  })
})

describe('文档范围：覆盖整篇正文（ADR-013 步骤 2）', () => {
  it('无 H1 文件建立可调用文档范围，覆盖标题前首部与全部小节', () => {
    const corpus = buildCorpus({ 'base/无标题.md': '标题前首部正文。\n\n## 第一节\n\n第一节正文。\n' })
    const doc = corpus.directory.documentRange('base/无标题.md')!

    expect(doc.sectionId).toBe('doc:base/无标题.md')
    expect(corpus.directory.get(doc.sectionId)).toBe(doc)
    expect(doc.body).toContain('标题前首部正文。')
    expect(doc.body).toContain('第一节正文。')
    expect(doc.level).toBe(0)
  })

  it('多 H1 文件文档范围覆盖全部一级章节，未被某一 H1 切断', () => {
    const corpus = buildCorpus({ 'base/多标题.md': '# 甲体系\n\n甲正文。\n\n# 乙体系\n\n乙正文。\n' })
    const doc = corpus.directory.documentRange('base/多标题.md')!

    expect(doc.body).toContain('甲正文。')
    expect(doc.body).toContain('乙正文。')
  })

  it('空正文文件仍有文档范围，不静默丢失入口', () => {
    const corpus = buildCorpus({ 'base/空.md': '---\ntitle: 空文档\n---\n' })
    const doc = corpus.directory.documentRange('base/空.md')!

    expect(doc).toBeDefined()
    expect(doc.body).toBe('')
    expect(doc.startLine).toBeGreaterThanOrEqual(doc.endLine)
  })
})
