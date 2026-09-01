/**
 * 运行配置（环境变量读取，无副作用）
 *
 * 密钥来源：各 provider 对应的环境变量（本地可放 .env，gitignore 已忽略）。
 * 当前支持：
 *   - Hy3：TOKENHUB_API_KEY（TokenHub 端点）
 *   - Qwen3.7-Flash：DASHSCOPE_API_KEY（DashScope / 阿里云百炼，OpenAI 兼容端点）
 */
import type { ProviderId, TokenizerId } from './types.js'
import { HY3_PRICES, QWEN_PRICES, type Prices } from './pricing.js'

export interface ProviderSpec {
  id: ProviderId
  /** 展示名（中文） */
  label: string
  /** API Key 环境变量名 */
  apiKeyEnv: string
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
    baseUrl: 'https://tokenhub.tencentmaas.com',
    chatPath: '/v1/chat/completions',
    model: 'hy3',
    prices: HY3_PRICES,
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen3.7-Flash',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatPath: '/chat/completions',
    model: 'qwen3.7-flash',
    prices: QWEN_PRICES,
  },
}

export type RetrieverId = 'bm25' | 'grep' | 'both'

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
  /** 强制首检次数：模型直接作答前，至少先检索的次数（qwen 检索意愿实验用） */
  minRagCalls: number
  /** 检索分词器：bigram（零依赖默认）| jieba（ADR-001，BENCH_TOKENIZER=jieba 开启） */
  tokenizer: TokenizerId
}

export function loadConfig(providerInput?: ProviderId): BenchConfig {
  const provider = providerInput ?? (process.env.BENCH_PROVIDER as ProviderId) ?? 'hy3'
  const spec = PROVIDERS[provider] ?? PROVIDERS.hy3
  return {
    provider: spec.id,
    providerLabel: spec.label,
    apiKey: process.env[spec.apiKeyEnv],
    apiKeyEnv: spec.apiKeyEnv,
    baseUrl: spec.baseUrl,
    chatPath: spec.chatPath,
    model: spec.model,
    prices: spec.prices,
    maxTokens: Number(process.env.BENCH_MAX_TOKENS ?? 4096),
    corpusDir: process.env.CORPUS_DIR ?? 'arknights-base-vault/docs',
    maxRounds: Number(process.env.BENCH_MAX_ROUNDS ?? 3),
    topK: Number(process.env.BENCH_TOP_K ?? 5),
    maxContextChars: Number(process.env.BENCH_MAX_CONTEXT_CHARS ?? 12000),
    retriever: (process.env.BENCH_RETRIEVER as RetrieverId) ?? 'bm25',
    minRagCalls: Number(process.env.BENCH_MIN_RAG_CALLS ?? 0),
    tokenizer: (process.env.BENCH_TOKENIZER as TokenizerId) ?? 'bigram',
  }
}
