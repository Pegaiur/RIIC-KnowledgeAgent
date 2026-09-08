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
import { aggregateUsages } from './pricing.js'
import type { HttpAttempt, LlmUsage, ProviderResult, ThinkingMode, ToolCall, UsageCompleteness } from './types.js'
import { acquireRateLimitToken } from './rate-limiter.js'

export interface ProviderOptions {
  config: BenchConfig
  /** 思考档位；调用时按 provider 分支映射 */
  thinking: ThinkingMode
  /** dry 模式：模拟返回，不发起网络请求 */
  dry: boolean
  /** 单题总超时信号；请求、限流和重试均必须尊重。 */
  signal?: AbortSignal
  /** 当前模型步骤的共享台账；取消竞争时由 Agent 用它收集已发生的 HTTP 尝试。 */
  ledger?: ProviderCallLedger
}

export interface ProviderCallLedger {
  attempts: HttpAttempt[]
  usage?: LlmUsage
  model?: string
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
    if (tools && tools.length > 0) body.parallel_tool_calls = true
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

  const fetched = await fetchWithRetry(`${baseUrl}${chatPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, opts.config.providerLabel, model, opts.signal, opts.ledger)

  const data = fetched.data
  const usage = parseUsage(data.usage)
  const accountingUsage = aggregateUsages(fetched.attempts.map((attempt) => attempt.usage))
  if (opts.ledger) {
    opts.ledger.attempts = fetched.attempts
    opts.ledger.usage = accountingUsage
    opts.ledger.model = data.model ?? model
  }
  const responseModel = data.model ?? model
  const choice = data.choices?.[0]
  if (!choice) {
    throw new ProviderCallError(
      `${opts.config.providerLabel} 响应无 choices：${JSON.stringify(data).slice(0, 400)}`,
      accountingUsage,
      responseModel,
      fetched.attempts,
    )
  }
  const msg = choice.message ?? {}

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
    model: responseModel,
    truncated: choice.finish_reason === 'length',
    httpAttempts: fetched.attempts,
  }
}

const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 1000

/** 可重试的状态码（限流 / 服务器瞬时故障）；其余 4xx/5xx 视为不可重试 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

interface FetchedResponse {
  data: Record<string, any>
  attempts: HttpAttempt[]
}

/** 网络调用：令牌桶限流 + 指数退避重试 + 尊重 Retry-After；正文消费结束前不清理请求信号。 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
  model: string,
  signal?: AbortSignal,
  ledger?: ProviderCallLedger,
): Promise<FetchedResponse> {
  let lastErr: unknown
  const attempts: HttpAttempt[] = ledger?.attempts ?? []
  attempts.length = 0
  const publish = () => {
    if (ledger) {
      ledger.attempts = attempts
      ledger.usage = aggregateUsages(attempts.map((attempt) => attempt.usage))
      ledger.model = model
    }
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 限流：每次请求前先取令牌；dry 模式不会走到这里
    try {
      await acquireRateLimitToken(signal)
    } catch (err) {
      throw new ProviderCallError(errorMessage(err), aggregateUsages(attempts.map((item) => item.usage)), model, attempts)
    }

    if (signal?.aborted) {
      throw new ProviderCallError(errorMessage(signal.reason), aggregateUsages(attempts.map((item) => item.usage)), model, attempts)
    }

    const request = requestSignal(signal)
    let response: Response | undefined
    const currentAttempt: HttpAttempt = {
      attempt,
      status: null,
      outcome: 'in_flight',
      usage: unknownUsage(),
    }
    attempts.push(currentAttempt)
    publish()
    try {
      response = await fetch(url, { ...init, signal: request.signal })
      currentAttempt.status = response.status
      publish()
      // Response 返回只代表响应头到达；保持 request signal 到正文消费完成。
      const text = await response.text()
      const data = parseJsonObject(text)
      const usage = parseUsage(data.usage)
      if (response.ok) {
        currentAttempt.status = response.status
        currentAttempt.outcome = 'accepted'
        currentAttempt.usage = usage
        publish()
        request.cleanup()
        return { data, attempts }
      }

      const retryable = RETRYABLE_STATUS.has(response.status)
      const message = `LLM API 返回 ${response.status}（${retryable ? '可重试' : '不可重试'}）：${text.slice(0, retryable ? 200 : 400)}`
      currentAttempt.status = response.status
      currentAttempt.outcome = retryable ? 'retry' : 'failed'
      currentAttempt.usage = usage
      currentAttempt.error = message
      publish()
      lastErr = new Error(message)
      request.cleanup()
      if (retryable) {
        if (attempt === MAX_ATTEMPTS) break
        const retryAfterMs = parseRetryAfter(response)
        try {
          await sleep(retryAfterMs ?? BACKOFF_BASE_MS * 2 ** (attempt - 1), signal)
        } catch (err) {
          throw new ProviderCallError(errorMessage(err), aggregateUsages(attempts.map((item) => item.usage)), model, attempts)
        }
        continue
      }
      throw new ProviderCallError(message, aggregateUsages(attempts.map((item) => item.usage)), model, attempts)
    } catch (err) {
      request.cleanup()
      if (err instanceof ProviderCallError) throw err
      const aborted = request.signal.aborted || signal?.aborted
      const error = aborted
        ? abortError(signal ?? request.signal)
        : err instanceof Error && err.name === 'TimeoutError'
          ? new Error(`${label} 请求超时`)
          : err
      currentAttempt.status = response?.status ?? null
      currentAttempt.outcome = aborted ? 'aborted' : 'failed'
      currentAttempt.usage = unknownUsage()
      currentAttempt.error = error instanceof Error ? error.message : String(error)
      publish()
      if (signal?.aborted) throw new ProviderCallError(errorMessage(error), aggregateUsages(attempts.map((item) => item.usage)), model, attempts)
      lastErr = error
      if (attempt === MAX_ATTEMPTS) break
      try {
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1), signal)
      } catch (sleepError) {
        throw new ProviderCallError(errorMessage(sleepError), aggregateUsages(attempts.map((item) => item.usage)), model, attempts)
      }
    }
  }
  throw new ProviderCallError(
    `LLM 调用失败（重试 ${MAX_ATTEMPTS} 次后仍失败）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    aggregateUsages(attempts.map((attempt) => attempt.usage)),
    model,
    attempts,
  )
}

function parseJsonObject(text: string): Record<string, any> {
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, any>
      : {}
  } catch {
    return {}
  }
}

function unknownUsage(): LlmUsage {
  return { input: null, output: null, cached: 0, reasoning: 0, completeness: 'unknown' }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

/** provider 已经发起请求但无法交付可用模型结果时的公开失败台账。 */
export class ProviderCallError extends Error {
  readonly providerFailure = true

  constructor(
    message: string,
    readonly usage: LlmUsage,
    readonly model: string,
    readonly httpAttempts: HttpAttempt[],
  ) {
    super(message)
    this.name = 'ProviderCallError'
  }
}

function requestSignal(sessionSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const requestController = new AbortController()
  const timer = setTimeout(() => requestController.abort(new Error('单次请求超时')), REQUEST_TIMEOUT_MS)
  const onSessionAbort = () => requestController.abort(sessionSignal?.reason)
  if (sessionSignal?.aborted) requestController.abort(sessionSignal.reason)
  else sessionSignal?.addEventListener('abort', onSessionAbort, { once: true })
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
 * dry 模式：按当前独立工具集合模拟取证，再返回最终回答。
 * 输出确定值便于回归（usage 随轮次递增，模拟真实多轮形态）。
 */
function dryResult(messages: ChatMessage[], opts: ProviderOptions): ProviderResult {
  const round = messages.filter((m) => m.role === 'assistant').length + 1
  const model = opts.config.model
  const truncated = false
  if (opts.config.retriever === 'facts') {
    if (round === 1) {
      return {
        content: null,
        toolCalls: [{ id: 'call_dry_1', name: 'facts_search', arguments: '{"query":"刻俄柏"}' }],
        usage: dryUsage(6000, 620),
        model,
        truncated,
      }
    }
    if (round === 2) {
      return {
        content: null,
        toolCalls: [{ id: 'call_dry_2', name: 'facts_search', arguments: '{"query":"制造站"}' }],
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
        toolCalls: [{ id: 'call_dry_2', name: 'facts_search', arguments: '{"query":"刻俄柏"}' }],
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
        toolCalls: opts.config.retriever === 'both'
          ? [
              { id: 'call_dry_1', name: 'rag_search', arguments: '{"query":"占位查询"}' },
              { id: 'call_dry_2', name: 'grep_search', arguments: '{"query":"占位查询"}' },
            ]
          : [{
              id: 'call_dry_1',
              name: opts.config.retriever === 'grep' ? 'grep_search' : 'rag_search',
              arguments: '{"query":"占位查询"}',
            }],
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
