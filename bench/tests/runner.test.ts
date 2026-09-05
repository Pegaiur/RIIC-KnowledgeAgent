import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { runBenchmark } from '../src/runner.js'

describe('runBenchmark：trace 逐题落盘', () => {
  it('LLM 失败时追加失败记录并保留 llm_call 事件', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'rag-trace-runner-'))
    try {
      const config = loadConfig()
      config.retriever = 'facts'
      config.apiKey = undefined
      const output = await runBenchmark(
        [
          { id: 'RUN-FAIL-1', category: 'fact', question: '第一题' },
          { id: 'RUN-FAIL-2', category: 'fact', question: '第二题' },
        ],
        { thinking: 'off', dry: false, outDir, config },
      )

      const traces = readFileSync(output.tracePath, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { queryId: string; status: string; events: Array<{ type: string; error?: string }>; failure?: { stage: string } })
      expect(traces).toHaveLength(2)
      expect(traces.map((trace) => trace.queryId)).toEqual(['RUN-FAIL-1', 'RUN-FAIL-2'])
      for (const trace of traces) {
        expect(trace.status).toBe('failed')
        expect(trace.failure?.stage).toBe('llm')
        expect(trace.events[0]?.type).toBe('llm_call')
        expect(trace.events[0]?.error).toContain('缺少')
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
