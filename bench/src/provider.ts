/**
 * LLM Provider：OpenAI 兼容端点封装（非流式）
 *
 * 支持 provider（端点/模型/定价见 config.ts 注册表）：
 *   - Hy3：TOKENHUB_API_KEY，POST {baseUrl}/v1/chat/completions
 *   - Qwen3.7-Flash：DASHSCOPE_API_KEY，POST {baseUrl}/chat/completions
 *
 * - dry 模式：不发请求，返回确定性假结果（验证管线用）
 * - usage 解析：prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens
 *   / completion_tokens_details.reasoning_tokens
 */
import type { BenchConfig } from './config.js'
import type { LlmUsage, ProviderResult, ThinkingMode, ToolCall, UsageCompleteness } from './types.js'
import { acquireRateLimitToken } from './rate-limiter.js'

export interface ProviderOptions {
  config: BenchConfig
  /** 思考档位；调用时按 provider 分支映射 */
  thinking: ThinkingMode
  /** dry 模式：模拟返回，不发起网络请求 */
  dry: boolean
  /** 单题总超时信号；请求、限流和重试均必须尊重。 */
  signal?: AbortSignal
}

/** OpenAI 兼容 assistant 消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

const REQUEST_TIMEOUT_MS = 120_000

/** 组装请求体（导出供单测断言 provider 参数映射） */
export function buildChatBody(
  messages: ChatMessage[],
  tools: unknown[] | undefined,
  opts: ProviderOptions,
): Record<string, unknown> {
  const { config, thinking } = opts
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: config.maxTokens,
    stream: false,
  }
  if (config.temperature !== undefined) body.temperature = config.temperature
  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }
  if (config.provider === 'qwen') {
    // Qwen3.7：enable_thinking 控制思考；off 必须显式 false，low/high 开启（暂不细分）
    body.enable_thinking = thinking !== 'off'
  } else if (thinking !== 'off') {
    // Hy3：reasoning_effort + thinking.enabled
    body.reasoning_effort = thinking
    body.thinking = { type: 'enabled' }
  }
  return body
}

/** 调用 LLM，返回解析后的结果 */
export async function callLLM(
  messages: ChatMessage[],
  tools: unknown[] | undefined,
  opts: ProviderOptions,
): Promise<ProviderResult> {
  if (opts.dry) return dryResult(messages, opts)
  const { apiKey, baseUrl, chatPath, model } = opts.config
  if (!apiKey) {
    throw new Error(
      `缺少 ${opts.config.apiKeyEnv}：请在环境变量或 .env 中配置后重试（dry 模式无需密钥）`,
    )
  }

  const body = buildChatBody(messages, tools, opts)

  const res = await fetchWithRetry(`${baseUrl}${chatPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, opts.config.providerLabel, opts.signal)

  const data = (await res.json()) as Record<string, any>
  const choice = data.choices?.[0]
  if (!choice) {
    throw new Error(`${opts.config.providerLabel} 响应无 choices：${JSON.stringify(data).slice(0, 400)}`)
  }
  const msg = choice.message ?? {}
  const usage = parseUsage(data.usage)

  const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc: any) => ({
        id: tc.id ?? '',
        name: tc.function?.name ?? '',
        arguments: tc.function?.arguments ?? '{}',
      }))
    : []

  return {
    content: typeof msg.content === 'string' ? msg.content : null,
    reasoning: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : null,
    toolCalls,
    usage,
    model: data.model ?? model,
    truncated: choice.finish_reason === 'length',
  }
}

const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 1000

/** 可重试的状态码（限流 / 服务器瞬时故障）；其余 4xx/5xx 视为不可重试 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

/** 网络调用：令牌桶限流 + 指数退避重试 + 尊重 Retry-After */
async function fetchWithRetry(url: string, init: RequestInit, label: string, signal?: AbortSignal): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 限流：每次请求前先取令牌；dry 模式不会走到这里
    await acquireRateLimitToken(signal)

    let res: Response
    const request = requestSignal(signal)
    try {
      res = await fetch(url, { ...init, signal: request.signal })
    } catch (err) {
      if (signal?.aborted) throw abortError(signal)
      // 网络错误 / 超时：可重试
      lastErr = err instanceof Error && err.name === 'TimeoutError' ? new Error(`${label} 请求超时`) : err
      if (attempt === MAX_ATTEMPTS) break
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1), signal)
      continue
    } finally {
      request.cleanup()
    }

    if (res.ok) return res
    const text = await res.text().catch(() => '')
    if (RETRYABLE_STATUS.has(res.status)) {
      lastErr = new Error(`LLM API 返回 ${res.status}（可重试）：${text.slice(0, 200)}`)
      if (attempt === MAX_ATTEMPTS) break
      const retryAfterMs = parseRetryAfter(res)
      await sleep(retryAfterMs ?? BACKOFF_BASE_MS * 2 ** (attempt - 1), signal)
      continue
    }
    // 永久错误（参数 / 鉴权 / 不存在等）：不重试，直接失败
    throw new Error(`LLM API 返回 ${res.status}（不可重试）：${text.slice(0, 400)}`)
  }
  throw new Error(
    `LLM 调用失败（重试 ${MAX_ATTEMPTS} 次后仍失败）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  )
}

/** 解析 Retry-After（秒数或 HTTP 日期）为毫秒；无法解析返回 null */
function parseRetryAfter(res: Response): number | null {
  const ra = res.headers.get('retry-after')
  if (!ra) return null
  const seconds = Number(ra)
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000
  const date = Date.parse(ra)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - Date.now())
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function requestSignal(sessionSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const requestController = new AbortController()
  const timer = setTimeout(() => requestController.abort(new Error('单次请求超时')), REQUEST_TIMEOUT_MS)
  const onSessionAbort = () => requestController.abort(sessionSignal?.reason)
  sessionSignal?.addEventListener('abort', onSessionAbort, { once: true })
  const cleanup = () => {
    clearTimeout(timer)
    sessionSignal?.removeEventListener('abort', onSessionAbort)
  }
  return { signal: requestController.signal, cleanup }
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason
  return reason instanceof Error ? reason : new Error('任务已取消')
}

function validToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : null
}

/** 解析 usage；不把缺失/无效的必需 token 字段静默转成 0。 */
export function parseUsage(u: unknown): LlmUsage {
  if (typeof u !== 'object' || u === null || Array.isArray(u)) {
    return { input: null, output: null, cached: 0, reasoning: 0, completeness: 'unknown' }
  }
  const usage = u as Record<string, unknown>
  const input = validToken(usage.prompt_tokens)
  const output = validToken(usage.completion_tokens)
  const promptDetails = usage.prompt_tokens_details
  const completionDetails = usage.completion_tokens_details
  const cachedRaw = typeof promptDetails === 'object' && promptDetails !== null
    ? (promptDetails as Record<string, unknown>).cached_tokens
    : undefined
  const reasoningRaw = typeof completionDetails === 'object' && completionDetails !== null
    ? (completionDetails as Record<string, unknown>).reasoning_tokens
    : undefined
  const cached = cachedRaw === undefined ? 0 : validToken(cachedRaw)
  const reasoning = reasoningRaw === undefined ? 0 : validToken(reasoningRaw)
  const requiredComplete = input !== null && output !== null
  const optionalComplete = cached !== null && reasoning !== null
  const hasRequiredFields = Object.prototype.hasOwnProperty.call(usage, 'prompt_tokens')
    || Object.prototype.hasOwnProperty.call(usage, 'completion_tokens')
  const completeness: UsageCompleteness = requiredComplete && optionalComplete
    ? 'complete'
    : !hasRequiredFields && input === null && output === null && cached === 0 && reasoning === 0 && cachedRaw === undefined && reasoningRaw === undefined
      ? 'unknown'
      : 'partial'
  return { input, output, cached, reasoning, completeness }
}

function dryUsage(input: number, output: number): LlmUsage {
  return { input, output, cached: 0, reasoning: 0, completeness: 'complete' }
}

/**
 * dry 模式：首轮模拟工具调用（rag_search/grep_search，随检索器切换），次轮模拟最终回答。
 * 输出确定值便于回归（usage 随轮次递增，模拟真实多轮形态）。
 */
function dryResult(messages: ChatMessage[], opts: ProviderOptions): ProviderResult {
  const round = messages.filter((m) => m.role === 'tool').length + 1
  const model = opts.config.model
  const truncated = false
  if (opts.config.retriever === 'facts') {
    if (round === 1) {
      return {
        content: null,
        toolCalls: [{ id: 'call_dry_1', name: 'lookup', arguments: '{"term":"刻俄柏"}' }],
        usage: dryUsage(6000, 620),
        model,
        truncated,
      }
    }
    if (round === 2) {
      return {
        content: null,
        toolCalls: [{ id: 'call_dry_2', name: 'query_operators', arguments: '{"room":"制造站"}' }],
        usage: dryUsage(6000 + round * 1800, 700),
        model,
        truncated,
      }
    }
    return {
      content: '（dry 模拟回答）基于记录卡，制造站相关干员为……',
      toolCalls: [],
      usage: dryUsage(6000 + round * 1800, 1480),
      model,
      truncated,
    }
  }
  if (opts.config.retriever === 'hybrid') {
    if (round === 1) {
      return {
        content: null,
        toolCalls: [{ id: 'call_dry_1', name: 'rag_search', arguments: '{"query":"发电站 充能机制"}' }],
        usage: dryUsage(6000, 620),
        model,
        truncated,
      }
    }
    if (round === 2) {
      return {
        content: null,
        toolCalls: [{ id: 'call_dry_2', name: 'lookup', arguments: '{"term":"刻俄柏"}' }],
        usage: dryUsage(6000 + round * 1800, 700),
        model,
        truncated,
      }
    }
    return {
      content: '（dry 模拟回答）基于机制语料与记录卡，结论为……',
      toolCalls: [],
        usage: dryUsage(6000 + round * 1800, 1480),
      model,
      truncated,
    }
  }
  if (round === 1) {
    return {
      content: null,
      toolCalls: [
        {
          id: 'call_dry_1',
          // 工具名随检索器切换，使 dry 也能走对应的路由分支
          name: opts.config.retriever === 'grep' ? 'grep_search' : 'rag_search',
          arguments: '{"query":"占位查询"}',
        },
      ],
      usage: dryUsage(6000, 620),
      model,
      truncated,
    }
  }
  return {
    content: '（dry 模拟回答）根据检索片段，基建排班的要点为……',
    toolCalls: [],
    usage: dryUsage(6000 + round * 1800, 1480),
    model,
    truncated,
  }
}
