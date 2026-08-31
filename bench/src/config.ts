/**
 * 运行配置（环境变量读取，无副作用）
 *
 * 密钥来源：各 provider 对应的环境变量（本地可放 .env，gitignore 已忽略）。
 * 当前支持：
 *   - Hy3：TOKENHUB_API_KEY（TokenHub 端点）
 *   - Qwen3.7-Flash：DASHSCOPE_API_KEY（DashScope / 阿里云百炼，OpenAI 兼容端点）
 */
import type { ProviderId } from './types.js'
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
  /** agent 最大轮次 */
  maxRounds: number
  /** 检索片段数量 */
  topK: number
  /** 单次注入检索片段的最大字符数 */
  maxContextChars: number
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
  }
}
