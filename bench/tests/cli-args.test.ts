import { describe, expect, it, vi } from 'vitest'
import { RETIRED_SKILL_TABLES_MESSAGE, ignoredHitrateFlags, parseArgs, retiredFlagError, unsupportedCatalogFlags } from '../src/cli-args.js'

const blockedWork = vi.hoisted(() => ({
  config: vi.fn(),
  benchmark: vi.fn(),
  integrity: vi.fn(),
  catalog: vi.fn(),
  write: vi.fn(),
}))

// 保留 CLI 的真实解析与退出处理，在依赖边界阻断配置、运行和写盘；拦截回归也不能操作真实工作区。
vi.mock('../src/config.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/config.js')>(),
  loadConfig: blockedWork.config,
}))
vi.mock('../src/runner.js', () => ({ runBenchmark: blockedWork.benchmark }))
vi.mock('../src/benchmark-integrity.js', () => ({ validateBenchmarkIntegrity: blockedWork.integrity }))
vi.mock('../src/catalog.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/catalog.js')>(),
  generateKeywordCatalogMarkdown: blockedWork.catalog,
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  writeFileSync: blockedWork.write,
}))

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

describe('CLI 参数：--expand-fulltext / --attach-facts 对照开关', () => {
  it('解析 --expand-fulltext / --attach-facts 的 0|1', () => {
    const args = parseArgs([
      'run',
      '--expand-fulltext', '0',
      '--attach-facts', '1',
    ])

    expect(args.expandFulltext).toBe(0)
    expect(args.attachFacts).toBe(1)
  })

  it('未传两开关时为 null，沿用 EXPERIMENT 默认', () => {
    const args = parseArgs(['run'])

    expect(args.expandFulltext).toBeNull()
    expect(args.attachFacts).toBeNull()
  })

  it('缺少数值时保留 NaN，让 CLI 以中文错误拒绝', () => {
    expect(parseArgs(['run', '--attach-facts']).attachFacts).toBeNaN()
    expect(parseArgs(['run', '--expand-fulltext']).expandFulltext).toBeNaN()
  })
})

describe('CLI 参数：--inject-keyword-catalog 目录注入开关', () => {
  it('解析 0|1，未传时为 null，缺值时保留 NaN', () => {
    expect(parseArgs(['run', '--inject-keyword-catalog', '1']).injectKeywordCatalog).toBe(1)
    expect(parseArgs(['run', '--inject-keyword-catalog', '0']).injectKeywordCatalog).toBe(0)
    expect(parseArgs(['run']).injectKeywordCatalog).toBeNull()
    expect(parseArgs(['run', '--inject-keyword-catalog']).injectKeywordCatalog).toBeNaN()
  })

  it('hitrate 显式传入时提示忽略，catalog 子命令列为不支持参数', () => {
    expect(ignoredHitrateFlags(parseArgs(['hitrate', '--inject-keyword-catalog', '1'])))
      .toEqual(['--inject-keyword-catalog'])
    expect(unsupportedCatalogFlags(parseArgs(['catalog', '--inject-keyword-catalog', '1'])))
      .toEqual(['--inject-keyword-catalog'])
  })
})

describe('CLI 参数：--include-skill-tables 退役（ADR-021）', () => {
  it('四种形态（0、1、缺值、非法值）都判定为显式出现', () => {
    const forms = [
      ['run', '--include-skill-tables', '0'],
      ['run', '--include-skill-tables', '1'],
      ['run', '--include-skill-tables'],
      ['run', '--include-skill-tables', '非法'],
    ]

    for (const argv of forms) {
      expect(retiredFlagError(parseArgs(argv)), argv.join(' ')).toBe(RETIRED_SKILL_TABLES_MESSAGE)
    }
  })

  it('退役提示语为约定文案，未传该参数时无错误', () => {
    expect(RETIRED_SKILL_TABLES_MESSAGE)
      .toBe('--include-skill-tables 已退役；RAG 仅检索 base/guides，精确事实请使用 facts 能力')
    expect(retiredFlagError(parseArgs(['run']))).toBeNull()
  })
})

/**
 * 入口契约核对：cli.ts 在执行任何实际工作前拦截退役参数，并按既有口径以退出码 1 结束。
 * 依赖替身在导入前安装，等待入口完成后才恢复进程状态。
 */
describe('CLI 入口：退役参数在执行前报错并以退出码 1 结束', () => {
  async function runCli(argv: string[]): Promise<{ stderr: string; stdout: string; exitCode: number | undefined }> {
    const originalArgv = process.argv
    const originalExitCode = process.exitCode
    const chunks: string[] = []
    const output: string[] = []
    for (const [name, boundary] of Object.entries(blockedWork)) {
      boundary.mockImplementation(() => { throw new Error(`测试阻止 CLI 执行实际工作：${name}`) })
    }
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      output.push(String(chunk))
      return true
    })
    try {
      process.argv = ['node', 'cli.js', ...argv]
      process.exitCode = undefined
      vi.resetModules()
      const { cliCompletion } = await import('../src/cli.js')
      await expect(cliCompletion).resolves.toBeUndefined()
      for (const boundary of Object.values(blockedWork)) expect(boundary).not.toHaveBeenCalled()
      return { stderr: chunks.join(''), stdout: output.join(''), exitCode: process.exitCode }
    } finally {
      spy.mockRestore()
      stdoutSpy.mockRestore()
      process.argv = originalArgv
      process.exitCode = originalExitCode
      for (const boundary of Object.values(blockedWork)) boundary.mockReset()
    }
  }

  it.each([
    ['0', ['run', '--include-skill-tables', '0']],
    ['1', ['run', '--include-skill-tables', '1']],
    ['缺值', ['run', '--include-skill-tables']],
    ['非法值', ['run', '--include-skill-tables', '非法']],
    ['hitrate', ['hitrate', '--include-skill-tables', '0']],
    ['catalog', ['catalog', '--include-skill-tables', '0']],
  ])('%s：报退役错误且不落入实际运行', async (_name, argv) => {
    const { stderr, stdout, exitCode } = await runCli(argv)

    expect(stderr).toContain('--include-skill-tables 已退役')
    expect(stderr).toContain('RAG 仅检索 base/guides，精确事实请使用 facts 能力')
    expect(stdout).toBe('')
    expect(exitCode).toBe(1)
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

describe('CLI 参数：catalog 校验开关', () => {
  it('解析 --check，且不与 --check-gold 混用', () => {
    expect(parseArgs(['catalog']).check).toBe(false)
    expect(parseArgs(['catalog', '--check']).check).toBe(true)
    expect(parseArgs(['hitrate', '--check-gold']).check).toBe(false)
    expect(parseArgs(['hitrate', '--check-gold']).checkGold).toBe(true)
  })

  it('catalog 只接受 --check，误传其他已知开关会被列为不支持', () => {
    expect(unsupportedCatalogFlags(parseArgs(['catalog']))).toEqual([])
    expect(unsupportedCatalogFlags(parseArgs(['catalog', '--check']))).toEqual([])
    expect(unsupportedCatalogFlags(parseArgs(['catalog', '--check-gold']))).toEqual(['--check-gold'])
    expect(unsupportedCatalogFlags(parseArgs(['catalog', '--dry', '--topk', '3']))).toEqual(['--dry', '--topk'])
    expect(unsupportedCatalogFlags(parseArgs(['catalog', '--thinking', 'high']))).toEqual(['--thinking'])
    expect(unsupportedCatalogFlags(parseArgs(['catalog', '--limit', '3']))).toEqual(['--limit'])
  })
})
