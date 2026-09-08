import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
