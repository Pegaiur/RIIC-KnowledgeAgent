/**
 * 检索范围契约（ADR-021）：RAG 检索面与模型原文阅读目录都等于 manifest 的 base/guides，
 * raw 目录既无技能表过滤、也不进入检索与 read。
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCorpus, loadCorpusManifest } from '../src/corpus.js'
import { buildSectionDirectory } from '../src/sections.js'

const KNOWLEDGE_ROOT = join(process.cwd(), 'knowledge')

describe('检索范围：manifest 声明的 base/guides', () => {
  it('真实语料检索块严格来自 manifest，且不含 raw 条目', () => {
    const manifest = loadCorpusManifest(KNOWLEDGE_ROOT)
    const chunks = loadCorpus(KNOWLEDGE_ROOT)
    const files = new Set(chunks.map((chunk) => chunk.file))

    expect(files).toEqual(new Set(manifest))
    expect(chunks.length).toBeGreaterThan(0)
    expect([...files].filter((file) => file.startsWith('raw/'))).toEqual([])
    expect([...files].every((file) => file.startsWith('base/') || file.startsWith('guides/'))).toBe(true)
  })

  it('模型原文阅读目录同样不含 raw，raw 不可由 read 定位', () => {
    const directory = buildSectionDirectory(KNOWLEDGE_ROOT)

    expect(directory.sections.length).toBeGreaterThan(0)
    expect(directory.sections.every((section) => section.file.startsWith('base/') || section.file.startsWith('guides/'))).toBe(true)
    expect(directory.documentRange('raw/名册.md')).toBeUndefined()
    expect(directory.documentRange('raw/技能-制造站.md')).toBeUndefined()
    expect(directory.get('doc:raw/名册.md')).toBeUndefined()
  })
})
