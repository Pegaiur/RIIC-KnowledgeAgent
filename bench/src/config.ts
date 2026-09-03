/**
 * 运行配置（密钥走 secret.yaml/env 兜底；实验参数集中 EXPERIMENT 常量，无副作用）
 *
 * 密钥来源（按优先级）：① 仓库根 `secret.yaml` 直读（未入库，config 主来源）；
 * ② 各 provider 对应环境变量（本地 .env，gitignore 已忽略，作兜底）。两者均不回显、不写入日志。
 * 当前支持：
 *   - Hy3：TOKENHUB_API_KEY（TokenHub 端点）
 *   - Qwen3.7-Flash：DASHSCOPE_API_KEY（DashScope / 阿里云百炼，OpenAI 兼容端点）
 */
import type { ProviderId, TokenizerId } from './types.js'
import { HY3_PRICES, QWEN_PRICES, type Prices } from './pricing.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ProviderSpec {
  id: ProviderId
  /** 展示名（中文） */
  label: string
  /** API Key 环境变量名 */
  apiKeyEnv: string
  /** secret.yaml 中对应字段名（apiKeyEnv 缺失时的本地兜底读取） */
  secretKey: string
  /** OpenAI 兼容基础端点（不含 chat 路径） */
  baseUrl: string
  /** chat completions 路径（端点差异在此） */
  chatPath: string
  /** 模型名 */
  model: string
  /** 定价 */
  prices: Prices
}

/** provider 注册表（默认值兜底） */
export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  hy3: {
    id: 'hy3',
    label: '腾讯混元 Hy3',
    apiKeyEnv: 'TOKENHUB_API_KEY',
    secretKey: 'hy3-api-key',
    baseUrl: 'https://tokenhub.tencentmaas.com',
    chatPath: '/v1/chat/completions',
    model: 'hy3',
    prices: HY3_PRICES,
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen3.7-Flash',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    secretKey: 'qwen-api-key',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatPath: '/chat/completions',
    model: 'qwen3.7-flash',
    prices: QWEN_PRICES,
  },
}

export type RetrieverId = 'bm25' | 'grep' | 'both' | 'facts'

/**
 * 实验参数集中配置（默认无污染）。
 * 不再从环境变量读取——避免 shell 内残留（如 BENCH_ENTITY_BOOST=1.5）隐式污染基准结果。
 * 实验时直接改此处的值；A/B 对照显式改 rules（meta.json 会记录读到的值）。
 * （API Key 属密钥，仍走 secret.yaml/env 兜底，见 loadConfig。）
 */
export interface ExperimentConfig {
  /** 启用的 provider（hy3 | qwen） */
  provider: ProviderId
  /** 规则前缀开关（B 组 A/B 对照置 true） */
  rules: boolean
  /** 实体词加权因子（P2 已不采纳，默认 0 = 关闭） */
  entityBoost: number
  /** 分词器（bigram | jieba） */
  tokenizer: TokenizerId
  /** 作答前至少需调用检索工具的次数（minRag）；默认 1 = 必须调用一轮工具，0 = 不强制 */
  minRagCalls: number
  /** 检索 topK */
  topK: number
  /** 注入上下文最大字符数 */
  maxContextChars: number
  /** agent 最大轮次 */
  maxRounds: number
  /** 单次响应上限 */
  maxTokens: number
  /** 检索器（bm25 | grep | both） */
  retriever: RetrieverId
  /** 语料目录（相对仓库根） */
  corpusDir: string
}

/** 实验参数默认值（集中于此，改值时全局生效） */
export const EXPERIMENT: ExperimentConfig = {
  provider: 'qwen',
  rules: false,
  entityBoost: 0,
  tokenizer: 'bigram',
  minRagCalls: 1,
  topK: 5,
  maxContextChars: 12000,
  maxRounds: 3,
  maxTokens: 4096,
  retriever: 'bm25',
  // 临时重接（smoke，S02/S04/S06）：语料指向 knowledge/（references 数据 + base 机制 + 基建物流链）。
  // TODO(tech-debt) R5：facts-first 全量转录后，此处改读记录卡 store / knowledge（lookup/query 取代 RAG）。
  corpusDir: 'knowledge',
}

export interface BenchConfig {
  /** 当前 provider 标识 */
  provider: ProviderId
  /** provider 展示名 */
  providerLabel: string
  /** API Key；缺失时只能跑 --dry */
  apiKey: string | undefined
  /** API Key 环境变量名（错误提示用） */
  apiKeyEnv: string
  /** OpenAI 兼容基础端点（不含 chat 路径） */
  baseUrl: string
  /** chat completions 路径 */
  chatPath: string
  /** 模型名 */
  model: string
  /** 定价 */
  prices: Prices
  /** 单次响应上限 */
  maxTokens: number
  /** 语料目录（相对仓库根） */
  corpusDir: string
  /** agent 最大轮次：检索/工具轮预算；实际循环上限为 maxRounds+1（末位兜底强制作答轮，避免轮次耗尽无答案） */
  maxRounds: number
  /** 检索片段数量 */
  topK: number
  /** 单次注入检索片段的最大字符数 */
  maxContextChars: number
  /** 检索器：bm25（BM25 加权）| grep（字面命中计数，P3 对照）| both（双工具同时暴露，P5 搭配实验） */
  retriever: RetrieverId
  /** 作答前至少需调用检索工具的次数：直接作答前至少先检索几次（默认 1 = 必须调用一轮工具；0 = 不强制） */
  minRagCalls: number
  /** 检索分词器：bigram（零依赖默认）| jieba（ADR-001，EXPERIMENT.tokenizer=jieba） */
  tokenizer: TokenizerId
  /** 实体词加权因子（0 = 关闭；>0 时 BM25 精确命中实体词元得分 × 该因子，见 EXPERIMENT.entityBoost） */
  entityBoost: number
  /** 规则前缀开关（EXPERIMENT.rules 集中控制；默认关，A/B 对照组为 0；规则段置顶注入 system prompt） */
  rules: boolean
}

export function loadConfig(providerInput?: ProviderId): BenchConfig {
  // 实验开关一律取自 EXPERIMENT（不读 env，防 shell 残留污染）；仅 API Key 走 secret/env 兜底（密钥约定）
  const provider = providerInput ?? EXPERIMENT.provider
  const spec = PROVIDERS[provider] ?? PROVIDERS.qwen
  return {
    provider: spec.id,
    providerLabel: spec.label,
    apiKey: readSecretKey(spec.secretKey) ?? process.env[spec.apiKeyEnv],
    apiKeyEnv: spec.apiKeyEnv,
    baseUrl: spec.baseUrl,
    chatPath: spec.chatPath,
    model: spec.model,
    prices: spec.prices,
    maxTokens: EXPERIMENT.maxTokens,
    corpusDir: EXPERIMENT.corpusDir,
    maxRounds: EXPERIMENT.maxRounds,
    topK: EXPERIMENT.topK,
    maxContextChars: EXPERIMENT.maxContextChars,
    retriever: EXPERIMENT.retriever,
    minRagCalls: EXPERIMENT.minRagCalls,
    rules: EXPERIMENT.rules,
    tokenizer: EXPERIMENT.tokenizer,
    entityBoost: EXPERIMENT.entityBoost,
  }
}

/**
 * 从仓库根 `secret.yaml` 直读密钥字段（env 缺失时的本地兜底）。
 * 解析规则：`<key>: <value>`（value 可带引号，自动剥离）；解析失败/无匹配返回 undefined，
 * 不抛错、不回显、不写日志（密钥不进 stdout）。带内存缓存避免重复读盘。
 */
const secretCache = new Map<string, string | undefined>()

function readSecretKey(secretKey: string): string | undefined {
  if (secretCache.has(secretKey)) return secretCache.get(secretKey)
  let value: string | undefined
  try {
    const raw = readFileSync(join(process.cwd(), 'secret.yaml'), 'utf-8')
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Za-z0-9_-]+)\s*:\s*"?([^"\n]+)"?\s*$/.exec(line.trim())
      if (m && m[1] === secretKey) {
        value = m[2].trim()
        break
      }
    }
  } catch {
    // secret.yaml 不存在或不可读：静默返回 undefined（走 --dry）
  }
  secretCache.set(secretKey, value)
  return value
}
