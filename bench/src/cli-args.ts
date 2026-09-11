import type { ProviderId, ThinkingMode } from './types.js'
import type { RetrieverId } from './config.js'

export interface ParsedArgs {
  command: string
  thinking: ThinkingMode
  /** provider：未显式传 --provider 时为 undefined，回落 EXPERIMENT.provider（config 集中默认） */
  provider: ProviderId | undefined
  limit: number | null
  dry: boolean
  questions: string | null
  out: string | null
  runDir: string | null
  /** 检索器（bm25 | hybrid） */
  retriever: RetrieverId | null
  /** --retriever 显式出现但缺少取值；与未传选项区分，由 CLI 报中文错误 */
  retrieverMissingValue: boolean
  /** 兼容旧入口：0 关闭未调用工具回馈，1 开启一次回馈 */
  minRag: number | null
  /** 每题工具成功额度 */
  toolBudget: number | null
  /** 每题工具获准尝试硬上限 */
  toolAttemptLimit: number | null
  /** 每题总超时（毫秒） */
  sessionTimeoutMs: number | null
  /** 采样温度；不传则沿用服务端默认值 */
  temperature: number | null
  /** hitrate：topK 列表（逗号分隔，如 3,5,10） */
  topk: string | null
  /** hitrate：gold.json 路径 */
  gold: string | null
  /** hitrate：仅校验 gold ↔ 语料对应关系 */
  checkGold: boolean
  /** 位置参数（compare 收集多个 runDir） */
  positional: string[]
  /** export：快照主题名 */
  topic: string | null
  help: boolean
}

function readNumber(argv: string[], index: number): number {
  const value = argv[index + 1]
  if (value === undefined) return Number.NaN
  return Number(value)
}

/** 解析 CLI 参数；数值的业务范围由 config 校验统一判定。 */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: argv[0] ?? 'help',
    thinking: 'off',
    provider: undefined,
    limit: null,
    dry: false,
    questions: null,
    out: null,
    runDir: null,
    retriever: null,
    retrieverMissingValue: false,
    minRag: null,
    toolBudget: null,
    toolAttemptLimit: null,
    sessionTimeoutMs: null,
    temperature: null,
    topk: null,
    gold: null,
    checkGold: false,
    positional: [],
    topic: null,
    help: false,
  }
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') parsed.help = true
    else if (arg === '--dry') parsed.dry = true
    else if (arg === '--check-gold') parsed.checkGold = true
    else if (arg === '--topk') parsed.topk = argv[++i] ?? null
    else if (arg === '--gold') parsed.gold = argv[++i] ?? null
    else if (arg === '--provider') parsed.provider = argv[++i] as ProviderId | undefined
    else if (arg === '--thinking') parsed.thinking = (argv[++i] as ThinkingMode) ?? 'off'
    else if (arg === '--retriever') {
      const value = argv[++i]
      if (value === undefined) parsed.retrieverMissingValue = true
      else parsed.retriever = value as RetrieverId
    }
    else if (arg === '--min-rag') {
      parsed.minRag = readNumber(argv, i)
      i++
    } else if (arg === '--tool-budget') {
      parsed.toolBudget = readNumber(argv, i)
      i++
    } else if (arg === '--tool-attempt-limit') {
      parsed.toolAttemptLimit = readNumber(argv, i)
      i++
    } else if (arg === '--session-timeout-ms') {
      parsed.sessionTimeoutMs = readNumber(argv, i)
      i++
    } else if (arg === '--temperature') {
      parsed.temperature = readNumber(argv, i)
      i++
    } else if (arg === '--limit') {
      parsed.limit = readNumber(argv, i)
      i++
    } else if (arg === '--questions') parsed.questions = argv[++i] ?? null
    else if (arg === '--out') parsed.out = argv[++i] ?? null
    else if (arg === '--topic') parsed.topic = argv[++i] ?? null
    else if (!parsed.runDir && !arg.startsWith('-')) parsed.runDir = arg
    else if (!arg.startsWith('-')) parsed.positional.push(arg)
  }
  return parsed
}
