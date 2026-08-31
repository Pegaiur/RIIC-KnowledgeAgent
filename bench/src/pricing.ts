/**
 * Hy3 定价与费用计算
 *
 * 腾讯混元 Hy3（TokenHub 官方定价，单位：元 / 百万 tokens）：
 *   - 输入：1 元/M（缓存命中：0.25 元/M）
 *   - 输出：4 元/M（含思考 token 与工具调用参数）
 */

export const PRICE_IN_PER_M = 1.0
export const PRICE_OUT_PER_M = 4.0
export const PRICE_CACHE_PER_M = 0.25

export interface CostBreakdown {
  costIn: number
  costOut: number
  costTotal: number
}

/** 按 usage 计算费用（四舍五入到 6 位小数，单位元） */
export function computeCosts(input: number, output: number, cached: number): CostBreakdown {
  // 防御：缓存命中数不超过输入总数（异常数据时按输入上限 clamp）
  const cachedIn = Math.min(cached, input)
  const uncachedIn = input - cachedIn
  const costIn = (uncachedIn * PRICE_IN_PER_M + cachedIn * PRICE_CACHE_PER_M) / 1_000_000
  const costOut = (output * PRICE_OUT_PER_M) / 1_000_000
  return {
    costIn: round6(costIn),
    costOut: round6(costOut),
    costTotal: round6(costIn + costOut),
  }
}

function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000
}
