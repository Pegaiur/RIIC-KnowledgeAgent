/**
 * Provider 定价与费用计算
 *
 * 单位：元 / 百万 tokens。
 *   - Hy3（腾讯混元，TokenHub 官方定价）：输入 1 / 缓存命中 0.25 / 输出 4
 *   - Qwen3.7-Flash（DashScope 阿里云百炼，≤32k 档）：输入 0.2 / 缓存命中 0.04（输入价 20%） / 输出 0.8
 * 思考 token 与工具调用参数均计入输出 token。
 */

import type { LlmUsage } from './types.js'

export interface Prices {
  /** 输入价（元/M），未命中缓存部分 */
  inPerM: number
  /** 输出价（元/M），含思考与工具调用 token */
  outPerM: number
  /** 缓存命中输入价（元/M） */
  cachePerM: number
  /** 按单次请求输入量选择价格档位；按 maxInput 升序排列。 */
  inputTiers?: Array<{ maxInput: number; inPerM: number; outPerM: number; cachePerM: number }>
}

export const HY3_PRICES: Prices = { inPerM: 1.0, outPerM: 4.0, cachePerM: 0.25 }
export const QWEN_PRICES: Prices = {
  inPerM: 0.2, outPerM: 0.8, cachePerM: 0.04,
  inputTiers: [
    { maxInput: 32_768, inPerM: 0.2, outPerM: 0.8, cachePerM: 0.04 },
    { maxInput: 262_144, inPerM: 0.6, outPerM: 2.4, cachePerM: 0.12 },
    { maxInput: 1_000_000, inPerM: 1.2, outPerM: 4.8, cachePerM: 0.24 },
  ],
}
/** 智谱国内站标准价；限时折扣由试验配置显式覆盖，避免折扣过期后低估费用。 */
export const GLM_PRICES: Prices = { inPerM: 0.8, outPerM: 2.8, cachePerM: 0.23 }
/** DeepSeek 高峰价保守上界；分时折扣由试验依据请求时间另行核算。 */
export const DEEPSEEK_PRICES: Prices = { inPerM: 3, outPerM: 9, cachePerM: 0.1 }

/** 兼容旧的按名导出（tests 引用） */
export const PRICE_IN_PER_M = HY3_PRICES.inPerM
export const PRICE_OUT_PER_M = HY3_PRICES.outPerM
export const PRICE_CACHE_PER_M = HY3_PRICES.cachePerM

export interface CostBreakdown {
  costIn: number | null
  costOut: number | null
  costTotal: number | null
}

/** 将多次 HTTP 尝试的 usage 相加；任一分项未知时，该分项保持未知。 */
export function aggregateUsages(usages: readonly LlmUsage[]): LlmUsage {
  if (usages.length === 0) {
    return { input: null, output: null, cached: null, reasoning: null, knownInput: null, knownOutput: null, completeness: 'unknown' }
  }

  const input = sumKnown(usages.map((usage) => usage.input))
  const output = sumKnown(usages.map((usage) => usage.output))
  const knownInput = sumObserved(usages.map((usage) => usage.knownInput ?? usage.input))
  const knownOutput = sumObserved(usages.map((usage) => usage.knownOutput ?? usage.output))
  const cached = sumKnown(usages.map((usage) => usage.cached))
  const reasoning = sumKnown(usages.map((usage) => usage.reasoning))
  const allComplete = usages.every((usage) => usage.completeness === 'complete' || (
    usage.completeness === undefined
    && usage.input !== null
    && usage.output !== null
    && usage.cached !== null
    && usage.reasoning !== null
  ))
  // cached/reasoning 的缺省值可能是 0；输入/输出小计允许在 exact 总量未知时保留。
  const hasKnown = knownInput !== null || knownOutput !== null
  const completeness = allComplete
    ? 'complete'
    : hasKnown
      ? 'partial'
      : 'unknown'

  return { input, output, cached, reasoning, knownInput, knownOutput, completeness }
}

/**
 * 聚合尝试费用：已知尝试计入已知小计，任一尝试费用不完整时总费用保持 null。
 * costIn/costOut 为已知分项小计，不把未知尝试补成零后误报为完整总费用。
 */
export function aggregateAttemptCosts(
  usages: readonly LlmUsage[],
  prices: Prices = HY3_PRICES,
): CostBreakdown {
  if (usages.length === 0) return { costIn: null, costOut: null, costTotal: null }
  let costIn = 0
  let costOut = 0
  let knownIn = false
  let knownOut = false
  let complete = true
  for (const usage of usages) {
    const costs = computeCosts(usage.input, usage.output, usage.cached, prices)
    if (costs.costIn === null) complete = false
    else {
      knownIn = true
      costIn += costs.costIn
    }
    if (costs.costOut === null) complete = false
    else {
      knownOut = true
      costOut += costs.costOut
    }
    if (costs.costTotal === null || usage.completeness === 'unknown' || usage.completeness === 'partial') complete = false
  }
  const knownCostIn = knownIn ? round6(costIn) : null
  const knownCostOut = knownOut ? round6(costOut) : null
  return {
    costIn: knownCostIn,
    costOut: knownCostOut,
    costTotal: complete && knownCostIn !== null && knownCostOut !== null
      ? round6(knownCostIn + knownCostOut)
      : null,
  }
}

function sumKnown(values: readonly (number | null | undefined)[]): number | null {
  if (values.some((value) => value === null || value === undefined)) return null
  return values.reduce<number>((sum, value) => sum + (value as number), 0)
}

function sumObserved(values: readonly (number | null | undefined)[]): number | null {
  const observed = values.filter((value): value is number => value !== null && value !== undefined)
  return observed.length > 0 ? observed.reduce((sum, value) => sum + value, 0) : null
}

/** 按 usage 计算费用（四舍五入到 6 位小数，单位元） */
export function computeCosts(
  input: number | null,
  output: number | null,
  cached: number | null,
  prices: Prices = HY3_PRICES,
): CostBreakdown {
  const tiers = prices.inputTiers
  if (tiers?.length) {
    if (input === null) return { costIn: null, costOut: null, costTotal: null }
    const tier = tiers.find(item => input <= item.maxInput)
    if (!tier) return { costIn: null, costOut: null, costTotal: null }
    prices = tier
  }
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
