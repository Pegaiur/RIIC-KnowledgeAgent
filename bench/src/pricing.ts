/**
 * Provider 定价与费用计算
 *
 * 单位：元 / 百万 tokens。
 *   - Hy3（腾讯混元，TokenHub 官方定价）：输入 1 / 缓存命中 0.25 / 输出 4
 *   - Qwen3.7-Flash（DashScope 阿里云百炼，≤32k 档）：输入 0.2 / 缓存命中 0.04（输入价 20%） / 输出 0.8
 * 思考 token 与工具调用参数均计入输出 token。
 */

export interface Prices {
  /** 输入价（元/M），未命中缓存部分 */
  inPerM: number
  /** 输出价（元/M），含思考与工具调用 token */
  outPerM: number
  /** 缓存命中输入价（元/M） */
  cachePerM: number
}

export const HY3_PRICES: Prices = { inPerM: 1.0, outPerM: 4.0, cachePerM: 0.25 }
export const QWEN_PRICES: Prices = { inPerM: 0.2, outPerM: 0.8, cachePerM: 0.04 }

/** 兼容旧的按名导出（tests 引用） */
export const PRICE_IN_PER_M = HY3_PRICES.inPerM
export const PRICE_OUT_PER_M = HY3_PRICES.outPerM
export const PRICE_CACHE_PER_M = HY3_PRICES.cachePerM

export interface CostBreakdown {
  costIn: number | null
  costOut: number | null
  costTotal: number | null
}

/** 按 usage 计算费用（四舍五入到 6 位小数，单位元） */
export function computeCosts(
  input: number | null,
  output: number | null,
  cached: number | null,
  prices: Prices = HY3_PRICES,
): CostBreakdown {
  // 防御：缓存命中数不超过输入总数（异常数据时按输入上限 clamp）
  const costIn = input === null || cached === null
    ? null
    : (() => {
        const cachedIn = Math.min(cached, input)
        const uncachedIn = input - cachedIn
        return round6((uncachedIn * prices.inPerM + cachedIn * prices.cachePerM) / 1_000_000)
      })()
  const costOut = output === null ? null : round6((output * prices.outPerM) / 1_000_000)
  return {
    costIn,
    costOut,
    costTotal: costIn === null || costOut === null ? null : round6(costIn + costOut),
  }
}

function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000
}
