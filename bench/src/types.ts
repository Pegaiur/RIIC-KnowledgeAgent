/**
 * 基准共用类型定义
 */

/** 思考深度档位（Hy3 reasoning_effort 映射） */
export type ThinkingMode = 'off' | 'low' | 'high'

/** LLM Provider 标识 */
export type ProviderId = 'hy3' | 'qwen'

/** 工具标识（hybrid 同时使用 rag_search 与 lookup/query_operators） */
export type ToolId = 'rag_search' | 'grep_search' | 'lookup' | 'query_operators'

/** 检索分词器标识（bigram 零依赖默认；jieba 见 ADR-001） */
export type TokenizerId = 'bigram' | 'jieba'

/** usage 完整性；partial 保留已知分项，unknown 不得当作零费用。 */
export type UsageCompleteness = 'complete' | 'partial' | 'unknown'

/** 单题终止原因；供 Agent、trace 和报告共用口径。 */
export type TerminationReason =
  | 'answer'
  | 'no_tool_after_feedback'
  | 'llm_error'
  | 'tool_error'
  | 'timeout'
  | 'cancelled'
  | 'empty_response'
  | 'truncated'
  | 'protocol_error'

/** 单个模型响应对应的工具批次统计；used 口径是获准尝试数。 */
export interface ToolBatchStats {
  requested: number
  granted: number
  executed: number
  denied: number
  errors: number
  budgetBefore: number
  budgetAfter: number
  resultChars: number
}

/** 单次 LLM 调用的 token 用量（TokenHub OpenAI 兼容口径） */
export interface LlmUsage {
  /** prompt_tokens（含缓存命中部分） */
  input: number | null
  /** completion_tokens（含思考 token 与工具调用参数） */
  output: number | null
  /** prompt_tokens_details.cached_tokens；接口允许省略时为 0，显式无效时为 null */
  cached: number | null
  /** completion_tokens_details.reasoning_tokens；接口允许省略时为 0，显式无效时为 null */
  reasoning: number | null
  /** 旧测试/旧运行构造的 usage 可缺省，provider 解析结果始终提供。 */
  completeness?: UsageCompleteness
}

/** 单次 HTTP 尝试；重试不能被压扁成一次无状态的模型调用。 */
export interface HttpAttempt {
  attempt: number
  status: number | null
  outcome: 'accepted' | 'retry' | 'failed' | 'aborted'
  usage: LlmUsage
  error?: string
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
  input: number | null
  /** 输出 token 数 */
  output: number | null
  /** 缓存命中输入 token 数 */
  cached: number | null
  /** 思考 token 数（reasoning_tokens），无则为 0 */
  reasoning: number | null
  /** 输入费用（元） */
  costIn: number | null
  /** 输出费用（元） */
  costOut: number | null
  /** 总费用（元） */
  costTotal: number | null
  /** usage 完整性；旧记录缺失时保持不可用而不是回填 complete。 */
  usageCompleteness?: UsageCompleteness
  /** 本模型步骤的 HTTP 尝试台账；每次重试各占一项。 */
  httpAttempts?: HttpAttempt[]
  /** 是否因 max_tokens 截断 */
  truncated: boolean
  /** 本轮实际调用的检索工具名（双工具模式下统计；无工具调用则省略） */
  tools?: ToolId[]
  /** 本轮工具批次统计；无工具调用的模型步骤省略。 */
  toolBatch?: ToolBatchStats
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
  /** provider 已观察到的 HTTP 尝试；正常请求通常只有一项。 */
  httpAttempts?: HttpAttempt[]
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
  /** 检索锚点：文档 H1 体系名 + frontmatter operators（仅用于检索加权，不注入展示给 LLM） */
  anchor?: string
  /** 正文起始行号（1 基，含标题行后首行） */
  startLine: number
  /** 正文结束行号（1 基） */
  endLine: number
}

/** 是否为检索工具（rag_search / grep_search）；供 agent / report 复用，替代散落的硬编码字符串谓词 */
export function isRetrievalTool(name: string | ToolId): name is ToolId {
  return name === 'rag_search' || name === 'grep_search'
}

/** 是否为 facts 查询工具（lookup / query_operators）；facts 模式代理统计用 */
export function isFactTool(name: string | ToolId): boolean {
  return name === 'lookup' || name === 'query_operators'
}
