/**
 * 全局令牌桶限流器
 *
 * 背景：腾讯混元 Hy3（TokenHub）官方并发上限 60 RPM；Qwen 限额较高、当前基准规模（≤20 题）不会触发。
 * 现默认不限速（RATE_LIMIT_RPM=100000，实际不可能触发等待）；Hy3 若回归需下调。
 * 每次真实 LLM 调用前 acquire() 取一个令牌，无令牌则异步等待。
 */

/** 基准限流值：默认不限速（Qwen 几乎不限流）；Hy3 官方 60 RPM，若回归需下调 */
export const RATE_LIMIT_RPM = 100_000

export class TokenBucketLimiter {
  private readonly capacity: number
  private readonly refillPerMs: number
  private tokens: number
  private lastRefill: number

  /** @param rpm 每分钟允许的最大请求数 */
  constructor(rpm: number) {
    this.capacity = rpm
    this.refillPerMs = rpm / 60_000
    this.tokens = rpm
    this.lastRefill = Date.now()
  }

  /** 请求一个令牌；无剩余则阻塞直至补足 */
  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('任务已取消')
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      await sleep(25, signal)
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs)
    this.lastRefill = now
  }
}

/** 基准全程共享的限流器（模块级单例，跨所有查询生效） */
const defaultLimiter = new TokenBucketLimiter(RATE_LIMIT_RPM)

/** 获取基准限流令牌 */
export async function acquireRateLimitToken(signal?: AbortSignal): Promise<void> {
  return defaultLimiter.acquire(signal)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('任务已取消'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('任务已取消'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
