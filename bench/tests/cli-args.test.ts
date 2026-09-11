import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/cli-args.js'

describe('CLI 参数：工具预算与回馈兼容入口', () => {
  it('保留 --min-rag 0，不把零吞掉，并解析新参数', () => {
    const args = parseArgs([
      'run',
      '--min-rag',
      '0',
      '--tool-budget',
      '7',
      '--session-timeout-ms',
      '120000',
    ])

    expect(args.minRag).toBe(0)
    expect(args.toolBudget).toBe(7)
    expect(args.sessionTimeoutMs).toBe(120000)
  })

  it('缺少数值参数时保留 NaN，让业务校验给出中文错误', () => {
    const args = parseArgs(['run', '--tool-budget'])

    expect(args.toolBudget).toBeNaN()
  })

  it('--retriever 解析取值；未传时为 null 且不标记缺值', () => {
    expect(parseArgs(['run', '--retriever', 'hybrid']).retriever).toBe('hybrid')
    expect(parseArgs(['run', '--retriever', 'bm25']).retriever).toBe('bm25')
    const absent = parseArgs(['run'])
    expect(absent.retriever).toBeNull()
    expect(absent.retrieverMissingValue).toBe(false)
  })

  it('--retriever 缺值被标记为缺值，区别于未传选项', () => {
    const args = parseArgs(['run', '--retriever'])

    expect(args.retriever).toBeNull()
    expect(args.retrieverMissingValue).toBe(true)
  })
})
