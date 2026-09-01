/**
 * hitrate 单元测试：miss / multi-gold 按比例计 / 越界（不存在）chunk 校验
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIndex } from '../src/retriever.js'
import { checkGold, loadGold, resolveGold, runHitrate } from '../src/hitrate.js'
import type { BenchQuery, DocChunk } from '../src/types.js'

const chunks: DocChunk[] = [
  {
    id: 'a.md### 电力',
    file: 'a.md',
    heading: '电力',
    text: '发电站提供电力，无人机充能速度受干员加成影响，充能公式与上限规则详见本节。',
    startLine: 2,
    endLine: 4,
  },
  {
    id: 'a.md### 贸易',
    file: 'a.md',
    heading: '贸易',
    text: '贸易站订单上限受干员技能影响，效率构成含基础与技能加成。',
    startLine: 6,
    endLine: 8,
  },
  {
    id: 'b.md## 宿舍',
    file: 'b.md',
    heading: '宿舍',
    text: '宿舍恢复心情，恢复公式由等级基础与氛围贡献构成。',
    startLine: 2,
    endLine: 3,
  },
]

const questions: BenchQuery[] = [
  { id: 'Q1', category: 'fact', question: '发电站无人机充能机制与电力' },
  { id: 'Q2', category: 'fact', question: '宿舍恢复心情的公式' },
]

describe('resolveGold', () => {
  it('清洗标题键回退命中（chunk.id 含 ## 前缀）', () => {
    const { resolved, missing } = resolveGold(['a.md#电力'], chunks)
    expect(missing).toEqual([])
    expect(resolved).toEqual([[0]])
  })

  it('精确 chunk.id 匹配优先', () => {
    const { resolved, missing } = resolveGold(['b.md## 宿舍'], chunks)
    expect(missing).toEqual([])
    expect(resolved).toEqual([[2]])
  })

  it('不存在的键进 missing', () => {
    const { missing } = resolveGold(['a.md#不存在'], chunks)
    expect(missing).toEqual(['a.md#不存在'])
  })
})

describe('checkGold', () => {
  it('越界（不存在）chunk 键逐条列出', () => {
    const gold = {
      Q1: { golden: ['a.md#电力', 'a.md#幽灵节'] },
      Q2: { golden: ['b.md#宿舍'] },
    }
    const { missing } = checkGold(gold, chunks)
    expect(missing).toEqual([{ queryId: 'Q1', key: 'a.md#幽灵节' }])
  })

  it('全部可解析时 missing 为空', () => {
    const gold = { Q1: { golden: ['a.md#电力'] }, Q2: { golden: ['b.md#宿舍'] } }
    expect(checkGold(gold, chunks).missing).toEqual([])
  })
})

describe('runHitrate', () => {
  it('multi-gold 按比例计：2 个 golden 命中 1 个 = 0.5，宏平均取均值', () => {
    const index = buildIndex(chunks)
    const gold = {
      Q1: { golden: ['a.md#电力', 'a.md#贸易'] }, // 查询含电力/充能词，top1 命中电力块
      Q2: { golden: ['b.md#宿舍'] }, // 查询含宿舍/恢复词，命中
    }
    const result = runHitrate(index, chunks, questions, gold, [1])
    const q1 = result.perQuestion.find((q) => q.id === 'Q1')!
    expect(q1.hits[0]).toBe(1)
    expect(q1.total).toBe(2)
    // recall@1 = 1/2；Q2 = 1 → 宏平均 0.75
    expect(result.recallMacro[0]).toBeCloseTo(0.75)
    // precision@1：两题 top1 均为 golden → 1.0（recall 只看覆盖，precision 看槽位纯度）
    expect(result.precisionMacro[0]).toBeCloseTo(1)
    // nDCG@1：golden 均在第 1 位 → 1.0
    expect(result.ndcgMacro[0]).toBeCloseTo(1)
  })

  it('precision 惩罚污染：噪声块挤占槽位时 precision 降、nDCG 随位次衰减', () => {
    // 噪声块「电力」词频更高 → 排 golden 之前
    const polluted: DocChunk[] = [
      { id: 'n', file: 'n.md', heading: '电力附注', text: '电力 电力 电力 电力 电力 电力', startLine: 1, endLine: 1 },
      { id: 'g', file: 'g.md', heading: '电力', text: '电力充能一次', startLine: 1, endLine: 1 },
    ]
    const index = buildIndex(polluted)
    const gold = { Q1: { golden: ['g.md#电力'] } }
    const result = runHitrate(index, polluted, [{ id: 'Q1', category: 'fact', question: '电力' }], gold, [2])
    // recall@2 = 1（golden 在 top2 内）；precision@2 = 1/2；nDCG@2 = (1/log2(3)) / (1/log2(2)) ≈ 0.631
    expect(result.recallMacro[0]).toBeCloseTo(1)
    expect(result.precisionMacro[0]).toBeCloseTo(0.5)
    expect(result.ndcgMacro[0]).toBeCloseTo(1 / Math.log2(3), 3)
  })

  it('miss：golden 不在 topK 内时 recall 下降并记录 miss', () => {
    const index = buildIndex(chunks)
    // 查询词与 golden（贸易）无交集 → 不命中
    const gold = { Q2: { golden: ['a.md#贸易'] } }
    const result = runHitrate(index, chunks, [questions[1]], gold, [3])
    expect(result.recallMacro[0]).toBe(0)
    expect(result.perQuestion[0].misses).toHaveLength(1)
  })

  it('gold 缺题即抛错', () => {
    const index = buildIndex(chunks)
    const gold = { Q1: { golden: ['a.md#电力'] } }
    expect(() => runHitrate(index, chunks, questions, gold, [3])).toThrow(/Q2/)
  })

  it('golden 键不可解析即抛错（防 recall 分母静默缩小）', () => {
    const index = buildIndex(chunks)
    const gold = { Q2: { golden: ['a.md#幽灵节'] } }
    expect(() => runHitrate(index, chunks, [questions[1]], gold, [3])).toThrow(/幽灵节/)
  })
})

describe('loadGold', () => {
  it('空 golden 数组拒绝', () => {
    expect(() => loadGoldFromJson('{"Q1":{"golden":[]}}')).toThrow(/golden/)
  })

  it('缺 # 的键拒绝', () => {
    expect(() => loadGoldFromJson('{"Q1":{"golden":["电力"]}}')).toThrow(/file#heading/)
  })
})

/** 写临时文件后走 loadGold 真实读取路径（覆盖形状校验） */
function loadGoldFromJson(json: string): ReturnType<typeof loadGold> {
  const dir = mkdtempSync(join(tmpdir(), 'hitrate-test-'))
  try {
    const path = join(dir, 'gold.json')
    writeFileSync(path, json, 'utf-8')
    return loadGold(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
