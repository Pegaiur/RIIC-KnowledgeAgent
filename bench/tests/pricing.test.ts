import { describe, expect, it } from 'vitest'
import { QWEN_PRICES, computeCosts, PRICE_CACHE_PER_M, PRICE_IN_PER_M, PRICE_OUT_PER_M } from '../src/pricing.js'

describe('pricing：Hy3 费用计算', () => {
  it('单价常量符合官方定价（输入 1 / 输出 4 / 缓存 0.25 元每百万）', () => {
    expect(PRICE_IN_PER_M).toBe(1.0)
    expect(PRICE_OUT_PER_M).toBe(4.0)
    expect(PRICE_CACHE_PER_M).toBe(0.25)
  })

  it('100 万输出 token 计 4 元', () => {
    const c = computeCosts(0, 1_000_000, 0)
    expect(c.costOut).toBe(4)
    expect(c.costTotal).toBe(4)
  })

  it('缓存命中输入按 0.25 元/M 计，未命中按 1 元/M 计', () => {
    const c = computeCosts(1_000_000, 0, 600_000)
    expect(c.costIn).toBeCloseTo(0.6 * 0.25 + 0.4 * 1.0, 6)
  })

  it('混合样例：输入 45000（缓存 0）+ 输出 3200', () => {
    const c = computeCosts(45_000, 3_200, 0)
    expect(c.costIn).toBeCloseTo(0.045, 6)
    expect(c.costOut).toBeCloseTo(0.0128, 6)
    expect(c.costTotal).toBeCloseTo(0.0578, 6)
  })

  it('cached 超过 input 时按 input 上限 clamp（防御）', () => {
    const c = computeCosts(1000, 0, 5000)
    // clamp 后 cachedIn=1000 → 1000 × 0.25 / 1M
    expect(c.costIn).toBe(0.00025)
  })
})

describe('pricing：Qwen3.7-Flash 费用计算', () => {
  it('100 万输出 token 计 0.8 元', () => {
    const c = computeCosts(0, 1_000_000, 0, QWEN_PRICES)
    expect(c.costOut).toBe(0.8)
    expect(c.costTotal).toBe(0.8)
  })

  it('输入按 0.2 元/M，缓存命中按 0.04 元/M（输入价 20%）', () => {
    const c = computeCosts(1_000_000, 0, 500_000, QWEN_PRICES)
    expect(c.costIn).toBeCloseTo(0.5 * 0.04 + 0.5 * 0.2, 6)
  })
})
