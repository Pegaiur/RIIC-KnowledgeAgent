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
})
