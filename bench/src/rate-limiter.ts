/**
 * 全局令牌桶限流器
 *
 * 背景：腾讯混元 Hy3（TokenHub）官方并发上限 60 RPM；Qwen 限额较高、当前基准规模（≤20 题）不会触发。
 * 现默认不限速（RATE_LIMIT_RPM=100000，实际不可能触发等待）；Hy3 若回归需下调。
 * 每次真实 LLM 调用前 acquire() 取一个令牌，无令牌则异步等待。
 */
import { setTimeout as sleep } from 'node:timers/promises'

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
  async acquire(): Promise<void> {
    for (;;) {
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      await sleep(25)
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
export async function acquireRateLimitToken(): Promise<void> {
  return defaultLimiter.acquire()
}
