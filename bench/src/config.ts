/**
 * 运行配置（密钥走 secret.yaml/env 兜底；实验参数集中 EXPERIMENT 常量，无副作用）
 *
 * 密钥来源（按优先级）：① 仓库根 `secret.yaml` 直读（未入库，config 主来源）；
 * ② 各 provider 对应环境变量（本地 .env，gitignore 已忽略，作兜底）。两者均不回显、不写入日志。
 * 当前默认与在用 provider：
 *   - GLM-5.3-Flash：ZAI_API_KEY（智谱 BigModel，OpenAI 兼容端点；默认 provider）
 *   - Qwen3.7-Flash：DASHSCOPE_API_KEY（DashScope / 阿里云百炼，OpenAI 兼容端点）
 * 注册表另保留 Hy3（TOKENHUB_API_KEY，已退出）与 DeepSeek 供历史对照。
 */
import type { ProviderId, TokenizerId } from './types.js'
import { DEEPSEEK_PRICES, GLM_PRICES, HY3_PRICES, QWEN_PRICES, type Prices } from './pricing.js'
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
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek-V4-Flash-Vision-Exp',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    secretKey: 'deepseek-api-key',
    baseUrl: 'https://api.deepseek.com',
    chatPath: '/chat/completions',
    model: 'deepseek-v4-flash-vision-exp',
    prices: DEEPSEEK_PRICES,
  },
  glm: {
    id: 'glm',
    label: 'GLM-5.3-Flash',
    apiKeyEnv: 'ZAI_API_KEY',
    secretKey: 'zai-api-key',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    chatPath: '/chat/completions',
    model: 'glm-5.3-flash',
    prices: GLM_PRICES,
  },
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

export type RetrieverId = 'bm25' | 'hybrid'

/**
 * 实验参数集中配置（默认无污染）。
 * 不再从环境变量读取——避免 shell 内残留（如 BENCH_ENTITY_BOOST=1.5）隐式污染基准结果。
 * 实验时直接改此处的值，meta.json 会记录实际配置。
 * （API Key 属密钥，仍走 secret.yaml/env 兜底，见 loadConfig。）
 */
export interface ExperimentConfig {
  /** 启用的 provider；默认 glm（GLM-5.3-Flash 不支持 off 思考，CLI 默认 thinking 为 low） */
  provider: ProviderId
  /** 实体词加权因子（P2 已不采纳，默认 0 = 关闭） */
  entityBoost: number
  /** 分词器（bigram | jieba） */
  tokenizer: TokenizerId
  /** 每题工具成功额度；仅在非空执行成功时扣 1 点，每题真实用户提问开始时重置 */
  toolBudget: number
  /** 每题工具获准尝试硬上限；与成败无关，达到后新增调用只收到拒绝 */
  toolAttemptLimit: number
  /** 每次 facts_search 可传入的最大词条数（数组长度上限）；schema maxItems 由此派生 */
  factsQueryListLimit: number
  /** 每题总超时（毫秒），覆盖请求、重试、等待、工具和后续模型步骤 */
  sessionTimeoutMs: number
  /** 未调用工具直接作答时是否允许一次宿主回馈 */
  feedbackOnNoToolAnswer: boolean
  /** 检索 topK */
  topK: number
  /** 注入上下文最大字符数 */
  maxContextChars: number
  /** 单次响应上限 */
  maxTokens: number
  /** 采样温度；undefined 表示沿用服务端默认值，不在请求中发送 */
  temperature?: number
  /** 检索器（bm25 | hybrid） */
  retriever: RetrieverId
  /** 命中的 base/guides 小节是否按文件扩展到原文文档范围（ADR-013） */
  expandFulltext: boolean
  /** hybrid 的 rag_search 是否自动附带内部 facts 卡；undefined = 随模式默认（hybrid 开、bm25 关） */
  attachFacts?: boolean
  /** 语料目录（相对仓库根） */
  corpusDir: string
}

/** 实验参数默认值（集中于此，改值时全局生效） */
export const EXPERIMENT: ExperimentConfig = {
  provider: 'glm',
  entityBoost: 0,
  tokenizer: 'bigram',
  toolBudget: 5,
  toolAttemptLimit: 10,
  factsQueryListLimit: 3,
  sessionTimeoutMs: 300_000,
  feedbackOnNoToolAnswer: true,
  topK: 5,
  maxContextChars: 12000,
  maxTokens: 4096,
  temperature: undefined,
  retriever: 'hybrid',
  // 默认组合：扩展原文；附带 facts 随 hybrid 默认开启（ADR-013）。检索范围恒为 manifest 登记的 base/guides（ADR-021）。
  expandFulltext: true,
  attachFacts: undefined,
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
  /** 采样温度；undefined 表示沿用服务端默认值，不在请求中发送 */
  temperature?: number
  /** 语料目录（相对仓库根） */
  corpusDir: string
  /** 检索片段数量 */
  topK: number
  /** 单次注入检索片段的最大字符数 */
  maxContextChars: number
  /** 检索器：hybrid 同时暴露 BM25 RAG 与 facts 查询工具；bm25 保留为纯 RAG 对照 */
  retriever: RetrieverId
  /** 命中的 base/guides 小节是否按文件扩展到原文文档范围（ADR-013） */
  expandFulltext: boolean
  /** hybrid 的 rag_search 是否自动附带内部 facts 卡；undefined = 随模式默认（hybrid 开、bm25 关） */
  attachFacts?: boolean
  /** 每题工具成功额度；仅在非空执行成功时扣 1 点，每题真实用户提问开始时重置 */
  toolBudget: number
  /** 每题工具获准尝试硬上限；与成败无关，达到后新增调用只收到拒绝 */
  toolAttemptLimit: number
  /** 每次 facts_search 可传入的最大词条数（数组长度上限）；schema maxItems 由此派生 */
  factsQueryListLimit: number
  /** 每题总超时（毫秒），覆盖请求、重试、等待、工具和后续模型步骤 */
  sessionTimeoutMs: number
  /** 未调用工具直接作答时是否允许一次宿主回馈 */
  feedbackOnNoToolAnswer: boolean
  /** 检索分词器：bigram（零依赖默认）| jieba（ADR-001，EXPERIMENT.tokenizer=jieba） */
  tokenizer: TokenizerId
  /** 实体词加权因子（0 = 关闭；>0 时 BM25 精确命中实体词元得分 × 该因子，见 EXPERIMENT.entityBoost） */
  entityBoost: number
}

export function loadConfig(providerInput?: ProviderId): BenchConfig {
  // 实验开关一律取自 EXPERIMENT（不读 env，防 shell 残留污染）；仅 API Key 走 secret/env 兜底（密钥约定）
  const provider = providerInput ?? EXPERIMENT.provider
  const spec = PROVIDERS[provider]
  if (!spec) throw new Error(`不支持的 provider：${provider}`)
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
    temperature: EXPERIMENT.temperature,
    corpusDir: EXPERIMENT.corpusDir,
    topK: EXPERIMENT.topK,
    maxContextChars: EXPERIMENT.maxContextChars,
    retriever: EXPERIMENT.retriever,
    expandFulltext: EXPERIMENT.expandFulltext,
    attachFacts: EXPERIMENT.attachFacts,
    toolBudget: EXPERIMENT.toolBudget,
    toolAttemptLimit: EXPERIMENT.toolAttemptLimit,
    factsQueryListLimit: EXPERIMENT.factsQueryListLimit,
    sessionTimeoutMs: EXPERIMENT.sessionTimeoutMs,
    feedbackOnNoToolAnswer: EXPERIMENT.feedbackOnNoToolAnswer,
    tokenizer: EXPERIMENT.tokenizer,
    entityBoost: EXPERIMENT.entityBoost,
  }
}

/**
 * 实际是否启用 RAG 内部 facts 附带：显式值优先；未显式时 hybrid 默认开启、bm25 默认关闭（ADR-013）。
 * 该值决定运行实际行为，mode 开关本身仍由 retriever 决定工具集合。
 */
export function effectiveAttachFacts(config: Pick<BenchConfig, 'retriever' | 'attachFacts'>): boolean {
  return config.attachFacts ?? config.retriever === 'hybrid'
}

/** 校验单题生命周期相关配置；CLI 覆盖参数后也必须调用。 */
export function validateBenchConfig(config: Pick<BenchConfig, 'toolBudget' | 'toolAttemptLimit' | 'factsQueryListLimit' | 'sessionTimeoutMs' | 'retriever' | 'attachFacts'>): void {
  if (config.retriever !== 'bm25' && config.retriever !== 'hybrid') {
    throw new Error(`不支持的检索模式：${String(config.retriever)}（可选 bm25 | hybrid）`)
  }
  // 显式在 bm25 请求附带 facts 属参数错误；未显式时 bm25 默认不附带，不应报错（ADR-013）。
  if (config.retriever === 'bm25' && config.attachFacts === true) {
    throw new Error('bm25 模式不支持 RAG 自动附带 facts；请使用 hybrid，或取消显式附带。')
  }
  for (const [name, value] of [
    ['toolBudget', config.toolBudget],
    ['toolAttemptLimit', config.toolAttemptLimit],
    ['factsQueryListLimit', config.factsQueryListLimit],
    ['sessionTimeoutMs', config.sessionTimeoutMs],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} 必须是正整数：${value}`)
    }
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
