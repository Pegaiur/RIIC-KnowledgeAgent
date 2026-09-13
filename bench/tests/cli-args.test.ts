import { describe, expect, it } from 'vitest'
import { ignoredHitrateFlags, parseArgs } from '../src/cli-args.js'

describe('CLI 参数：工具预算与回馈兼容入口', () => {
  it('保留 --min-rag 0，不把零吞掉，并解析新参数', () => {
    const args = parseArgs([
      'run',
      '--min-rag',
      '0',
      '--tool-budget',
      '7',
      '--tool-attempt-limit',
      '12',
      '--session-timeout-ms',
      '120000',
    ])

    expect(args.minRag).toBe(0)
    expect(args.toolBudget).toBe(7)
    expect(args.toolAttemptLimit).toBe(12)
    expect(args.sessionTimeoutMs).toBe(120000)
  })

  it('缺少数值参数时保留 NaN，让业务校验给出中文错误', () => {
    const args = parseArgs(['run', '--tool-budget'])

    expect(args.toolBudget).toBeNaN()
    expect(parseArgs(['run', '--tool-attempt-limit']).toolAttemptLimit).toBeNaN()
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

  it('未传 --thinking 时默认思考档为 low，显式取值仍生效', () => {
    expect(parseArgs(['run']).thinking).toBe('low')
    expect(parseArgs(['run', '--thinking', 'off']).thinking).toBe('off')
  })
})

describe('CLI 参数：四组对照三开关', () => {
  it('解析 --include-skill-tables / --expand-fulltext / --attach-facts 的 0|1', () => {
    const args = parseArgs([
      'run',
      '--include-skill-tables', '1',
      '--expand-fulltext', '0',
      '--attach-facts', '1',
    ])

    expect(args.includeSkillTables).toBe(1)
    expect(args.expandFulltext).toBe(0)
    expect(args.attachFacts).toBe(1)
  })

  it('未传三开关时为 null，沿用 EXPERIMENT 默认', () => {
    const args = parseArgs(['run'])

    expect(args.includeSkillTables).toBeNull()
    expect(args.expandFulltext).toBeNull()
    expect(args.attachFacts).toBeNull()
  })

  it('缺少数值时保留 NaN，让 CLI 以中文错误拒绝', () => {
    expect(parseArgs(['run', '--attach-facts']).attachFacts).toBeNaN()
    expect(parseArgs(['run', '--include-skill-tables']).includeSkillTables).toBeNaN()
  })
})

describe('CLI 参数：hitrate 忽略开关提示', () => {
  it('hitrate 显式传入扩展/附带开关时列出被忽略项，未传或仅范围开关时为空', () => {
    expect(ignoredHitrateFlags(parseArgs(['hitrate']))).toEqual([])
    expect(ignoredHitrateFlags(parseArgs(['hitrate', '--include-skill-tables', '1']))).toEqual([])
    expect(ignoredHitrateFlags(parseArgs(['hitrate', '--expand-fulltext', '0', '--attach-facts', '1'])))
      .toEqual(['--expand-fulltext', '--attach-facts'])
  })
})
