import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { runBenchmark } from '../src/runner.js'
import type { ProviderResult } from '../src/types.js'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))
vi.mock('../src/provider.js', () => ({ callLLM: mockCall }))

function providerResult(partial: Partial<ProviderResult>): ProviderResult {
  return {
    content: '答案',
    toolCalls: [],
    usage: { input: 20, output: 5, cached: 0, reasoning: 0 },
    model: 'qwen3.7-flash',
    truncated: false,
    ...partial,
  }
}

function writeCorpus(corpusDir: string): void {
  mkdirSync(join(corpusDir, 'base'), { recursive: true })
  writeFileSync(
    join(corpusDir, 'base', '机制.md'),
    ['# 制造体系', '', '## 制造站', '', '制造站引言。', '', '### 效率', '', '制造站效率由干员技能决定。', ''].join('\n'),
    'utf-8',
  )
  writeFileSync(join(corpusDir, 'corpus-manifest.json'), JSON.stringify({ files: ['base/机制.md'] }), 'utf-8')
}

describe('read_section 运行链路接入', () => {
  it('bm25 模式加载小节目录，RAG 结果带 sectionId 并可续读，trace 与 inputs 一致', async () => {
    const corpusDir = mkdtempSync(join(tmpdir(), 'rag-sections-corpus-'))
    const outDir = mkdtempSync(join(tmpdir(), 'rag-sections-out-'))
    writeCorpus(corpusDir)
    const sectionIds: string[] = []
    try {
      const config = loadConfig()
      config.retriever = 'bm25'
      config.corpusDir = corpusDir
      config.apiKey = 'synthetic-key'
      config.feedbackOnNoToolAnswer = false

      mockCall
        .mockImplementationOnce(async (_messages: unknown, tools: unknown[]) => {
          const names = (tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name)
          expect(names).toEqual(['rag_search', 'read'])
          return providerResult({ toolCalls: [{ id: 'rag-1', name: 'rag_search', arguments: JSON.stringify({ query: '制造站效率' }) }] })
        })
        .mockImplementationOnce(async (messages: Array<{ role: string; content: string }>) => {
          const toolMessage = messages.find((message) => message.role === 'tool')
          const match = /(sec-[0-9a-f]{16})/.exec(toolMessage?.content ?? '')
          expect(match).not.toBeNull()
          sectionIds.push(match![1]!)
          return providerResult({ toolCalls: [{ id: 'read-1', name: 'read', arguments: JSON.stringify({ section_id: match![1] }) }] })
        })
        .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

      const output = await runBenchmark(
        [{ id: 'INT-1', category: 'fact', question: '制造站效率' }],
        { thinking: 'off', dry: false, outDir, config },
      )

      const inputs = JSON.parse(readFileSync(output.inputsPath, 'utf-8')) as Record<string, unknown>
      expect(inputs.sections).toMatchObject({
        version: 1,
        sectionCount: expect.any(Number),
        orderPreserved: true,
      })

      const trace = JSON.parse(readFileSync(output.tracePath, 'utf-8').trim()) as {
        events: Array<{ type: string; tool?: string; callId?: string; writtenContent?: string; hitIds?: string[]; readDelivery?: Record<string, unknown> }>
      }
      const toolEvents = trace.events.filter((event) => event.type === 'tool_call')
      expect(toolEvents.map((event) => event.tool)).toEqual(['rag_search', 'read'])
      expect(toolEvents[0]!.writtenContent).toContain(sectionIds[0])
      expect(toolEvents[1]!.callId).toBe('read-1')
      expect(toolEvents[1]!.writtenContent).toContain('\\"complete\\":true')
      expect(toolEvents[1]!.hitIds).toEqual([])
      expect(toolEvents[1]!.readDelivery).toMatchObject({ callId: 'read-1', factsResultVersion: 8, sectionId: sectionIds[0] })
      expect(readFileSync(output.answersPath, 'utf-8')).toContain('最终答案')

      // records 保存不带正文的 read 台账，供 report/meta 汇总。
      const records = readFileSync(output.jsonlPath, 'utf-8').trim().split('\n')
        .map((line) => JSON.parse(line) as { tools?: string[]; readDelivery?: Array<Record<string, unknown>> })
      const readRecord = records.find((record) => (record.tools ?? []).includes('read'))!
      expect(readRecord.readDelivery).toHaveLength(1)
      expect(readRecord.readDelivery![0]).toMatchObject({
        callId: 'read-1',
        status: 'success',
        sectionId: sectionIds[0],
        factsResultVersion: 8,
        factsPage: { offset: 0, nextOffset: null, total: 0, returned: 0, complete: true },
        deliveredObjects: [],
      })
      expect(readRecord.readDelivery![0]!.bodyRange).toMatchObject({ file: expect.stringContaining('base/'), offset: 0, complete: true })
    } finally {
      mockCall.mockReset()
      rmSync(corpusDir, { recursive: true, force: true })
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
