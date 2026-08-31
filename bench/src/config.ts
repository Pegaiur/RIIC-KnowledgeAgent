/**
 * 运行配置（环境变量读取，无副作用）
 *
 * 密钥来源：环境变量 TOKENHUB_API_KEY（本地可放 .env，gitignore 已忽略）。
 */

export interface BenchConfig {
  /** TokenHub API Key；缺失时只能跑 --dry */
  apiKey: string | undefined
  /** TokenHub OpenAI 兼容端点（不含 /v1/chat/completions） */
  baseUrl: string
  /** 模型名（正式版 hy3） */
  model: string
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

export function loadConfig(): BenchConfig {
  return {
    apiKey: process.env.TOKENHUB_API_KEY,
    baseUrl: process.env.TOKENHUB_BASE_URL ?? 'https://tokenhub.tencentmaas.com',
    model: process.env.HY3_MODEL ?? 'hy3',
    maxTokens: Number(process.env.HY3_MAX_TOKENS ?? 4096),
    corpusDir: process.env.CORPUS_DIR ?? 'arknights-base-vault/docs',
    maxRounds: Number(process.env.BENCH_MAX_ROUNDS ?? 3),
    topK: Number(process.env.BENCH_TOP_K ?? 5),
    maxContextChars: Number(process.env.BENCH_MAX_CONTEXT_CHARS ?? 12000),
  }
}
