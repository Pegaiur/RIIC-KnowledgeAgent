/**
 * 基准共用类型定义
 */

/** 思考深度档位（Hy3 reasoning_effort 映射） */
export type ThinkingMode = 'off' | 'low' | 'high'

/** LLM Provider 标识 */
export type ProviderId = 'hy3' | 'qwen'

/** 单次 LLM 调用的 token 用量（TokenHub OpenAI 兼容口径） */
export interface LlmUsage {
  /** prompt_tokens（含缓存命中部分） */
  input: number
  /** completion_tokens（含思考 token 与工具调用参数） */
  output: number
  /** prompt_tokens_details.cached_tokens，无则为 0 */
  cached: number
  /** completion_tokens_details.reasoning_tokens（思考 token），无则为 0 */
  reasoning: number
}

/** 单次 LLM 调用的成本记录（写入 JSONL 的一行） */
export interface CostRecord {
  /** 基准时间戳（ISO 8601） */
  ts: string
  /** 问题 ID */
  queryId: string
  /** 问题类目（fact / system / gadget） */
  category: string
  /** 当前 Agent 轮次（从 1 开始） */
  round: number
  /** 思考档位 */
  thinking: ThinkingMode
  /** LLM Provider 标识（早期记录可能缺失，聚合时回退用 model 标识） */
  provider?: ProviderId
  /** 模型名 */
  model: string
  /** 输入 token 数 */
  input: number
  /** 输出 token 数 */
  output: number
  /** 缓存命中输入 token 数 */
  cached: number
  /** 思考 token 数（reasoning_tokens），无则为 0 */
  reasoning: number
  /** 输入费用（元） */
  costIn: number
  /** 输出费用（元） */
  costOut: number
  /** 总费用（元） */
  costTotal: number
  /** 是否因 max_tokens 截断 */
  truncated: boolean
}

/** 基准问题 */
export interface BenchQuery {
  id: string
  /** fact=单文档机制事实 / system=跨文档体系论证 / gadget=散件速查 */
  category: 'fact' | 'system' | 'gadget'
  question: string
}

/** 简化版工具调用（OpenAI 格式子集） */
export interface ToolCall {
  id: string
  name: string
  /** 已解析的参数字符串（JSON） */
  arguments: string
}

/** provider 返回值（非流式） */
export interface ProviderResult {
  content: string | null
  /** 推理内容（reasoning_content，若返回） */
  reasoning?: string | null
  toolCalls: ToolCall[]
  usage: LlmUsage
  model: string
  truncated: boolean
}

/** 检索到的文档片段 */
export interface DocChunk {
  /** 稳定 ID：相对路径#标题 */
  id: string
  /** 相对语料根的 markdown 路径 */
  file: string
  /** 所属标题（## / ### 行文本） */
  heading: string
  /** 片段正文 */
  text: string
}
