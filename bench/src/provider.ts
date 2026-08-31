/**
 * Hy3 Provider：TokenHub OpenAI 兼容端点封装（非流式）
 *
 * - 真实调用：POST {baseUrl}/v1/chat/completions，Bearer TOKENHUB_API_KEY
 * - dry 模式：不发请求，返回确定性假结果（验证管线用）
 * - usage 解析：prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens
 */
import type { BenchConfig } from './config.js'
import type { LlmUsage, ProviderResult, ThinkingMode, ToolCall } from './types.js'

export interface ProviderOptions {
  config: BenchConfig
  /** 思考档位：off 不传；low/high 传 reasoning_effort（OpenAI 兼容端点完整支持） */
  thinking: ThinkingMode
  /** dry 模式：模拟返回，不发起网络请求 */
  dry: boolean
}

/** OpenAI 兼容 assistant 消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

const REQUEST_TIMEOUT_MS = 120_000

/** 调用 Hy3，返回解析后的结果 */
export async function callHy3(
  messages: ChatMessage[],
  tools: unknown[] | undefined,
  opts: ProviderOptions,
): Promise<ProviderResult> {
  if (opts.dry) return dryResult(messages, opts)
  const { apiKey, baseUrl, model, maxTokens } = opts.config
  if (!apiKey) {
    throw new Error('缺少 TOKENHUB_API_KEY：请在环境变量或 .env 中配置后重试（dry 模式无需密钥）')
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    stream: false,
  }
  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }
  if (opts.thinking !== 'off') {
    body.reasoning_effort = opts.thinking
    body.thinking = { type: 'enabled' }
  }

  const res = await fetchWithRetry(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const data = (await res.json()) as Record<string, any>
  const choice = data.choices?.[0]
  if (!choice) {
    throw new Error(`Hy3 响应无 choices：${JSON.stringify(data).slice(0, 400)}`)
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
    model: data.model ?? opts.config.model,
    truncated: choice.finish_reason === 'length',
  }
}

/** 网络调用（单次重试 + 超时） */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Hy3 API 返回 ${res.status}：${text.slice(0, 400)}`)
      }
      return res
    } catch (err) {
      lastErr = err
      if (attempt === 2) break
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw new Error(`Hy3 调用失败（重试后仍失败）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

function parseUsage(u: any): LlmUsage {
  return {
    input: Number(u?.prompt_tokens ?? 0),
    output: Number(u?.completion_tokens ?? 0),
    cached: Number(u?.prompt_tokens_details?.cached_tokens ?? 0),
  }
}

/**
 * dry 模式：首轮模拟工具调用（rag_search），次轮模拟最终回答。
 * 输出确定值便于回归（usage 随轮次递增，模拟真实多轮形态）。
 */
function dryResult(messages: ChatMessage[], opts: ProviderOptions): ProviderResult {
  const round = messages.filter((m) => m.role === 'tool').length + 1
  const model = opts.config.model
  const truncated = false
  if (round === 1) {
    return {
      content: null,
      toolCalls: [
        { id: 'call_dry_1', name: 'rag_search', arguments: '{"query":"占位查询"}' },
      ],
      usage: { input: 6000, output: 620, cached: 0 },
      model,
      truncated,
    }
  }
  return {
    content: '（dry 模拟回答）根据检索片段，基建排班的要点为……',
    toolCalls: [],
    usage: { input: 6000 + round * 1800, output: 1480, cached: 0 },
    model,
    truncated,
  }
}
