import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { aggregate } from '../src/report.js'
import { runBenchmark } from '../src/runner.js'
import type { CostRecord } from '../src/types.js'

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

      const meta = JSON.parse(readFileSync(output.metaPath, 'utf-8')) as Record<string, unknown>
      expect(meta).toMatchObject({
        schemaVersion: 2,
        toolChoice: 'auto',
        parallelToolCalls: true,
        toolBudget: 5,
        sessionTimeoutMs: 300000,
        feedbackOnNoToolAnswer: true,
        toolSchemaVersion: 7,
        toolNames: ['facts_search'],
        modelSteps: 2,
        toolBatches: 0,
        toolCallsRequested: 0,
        failed: 2,
        toolHitCount: 0,
        toolHitUnknown: 0,
      })
      expect(meta.toolSchemaSha256).toMatch(/^[a-f0-9]{64}$/)

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

  it('meta 使用写盘 records 的同一份 token 与费用聚合口径', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'rag-meta-runner-'))
    try {
      const config = loadConfig('qwen')
      config.retriever = 'facts'
      config.feedbackOnNoToolAnswer = false
      const output = await runBenchmark(
        [{ id: 'RUN-DRY-1', category: 'fact', question: '第一题' }],
        { thinking: 'off', dry: true, outDir, config },
      )
      const records = output.records as CostRecord[]
      const report = aggregate(records)
      const meta = JSON.parse(readFileSync(output.metaPath, 'utf-8')) as Record<string, unknown>

      expect(meta).toMatchObject({
        inputTokens: report.totalInput,
        outputTokens: report.totalOutput,
        inputTokensExact: report.totalInputExact,
        outputTokensExact: report.totalOutputExact,
        totalCost: report.totalCost,
        costComplete: report.costComplete,
        httpAttempts: report.totalHttpAttempts,
        retryAttempts: report.retryAttempts,
        toolHitCount: report.toolStats.hitCount,
        toolHitUnknown: report.toolStats.hitUnknown,
      })
      expect(meta.maxTokens).toBe(4096)
      expect(meta.inputsSchemaVersion).toBe(1)
      const inputs = JSON.parse(readFileSync(output.inputsPath, 'utf-8')) as Record<string, any>
      expect(inputs.captureStatus).toBe('complete')
      expect(inputs.facts).toMatchObject({ status: 'captured', cardCount: expect.any(Number) })
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
