/**
 * hitrate 单元测试：miss / multi-gold 按比例计 / 越界（不存在）chunk 校验
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIndex } from '../src/retriever.js'
import { checkGold, loadGold, renderHitrate, resolveGold, runHitrate } from '../src/hitrate.js'
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
    // 真源可达但未进视野 → 记视野外，而非范围排除
    expect(result.perQuestion[0].misses[0]).toMatchObject({ excluded: false, bestRank: null })
  })

  it('多个 golden 键解析到同一实际块时，nDCG 的 IDCG 不重复计块', () => {
    // 仅一个分块，但两个 golden 键都解析到它（一个走清洗标题回退、一个走精确 id），id 被复用。
    const index = buildIndex(chunks)
    const gold = { Q1: { golden: ['a.md#电力', 'a.md### 电力'] } }
    const result = runHitrate(index, chunks, [questions[0]], gold, [2])
    const q1 = result.perQuestion[0]!

    expect(q1.total).toBe(2) // recall 分母按 golden 键计，保留 2
    expect(q1.hits[0]).toBe(2) // 同一可达块令两个键都命中
    // IDCG 按唯一 id 集合（1）计：golden 块居首位 → nDCG=1；若按键/索引集合（2）则约 0.613
    expect(q1.ndcg[0]).toBeCloseTo(1, 3)
  })

  it('gold 缺题即抛错', () => {
    const index = buildIndex(chunks)
    const gold = { Q1: { golden: ['a.md#电力'] } }
    expect(() => runHitrate(index, chunks, questions, gold, [3])).toThrow(/Q2/)
  })

  it('同文件重复标题生成相同 id 时，DCG 与 IDCG 均按实际块计量', () => {
    const repeated = [1, 2].map((line) => ({
      id: 'base/重复.md### 标题', file: 'base/重复.md', heading: '标题',
      text: '共同关键词', startLine: line, endLine: line,
    }))
    const result = runHitrate(buildIndex(repeated), repeated,
      [{ id: '重复', category: 'fact', question: '共同关键词' }],
      { '重复': { golden: ['base/重复.md#标题'] } }, [2])
    expect(result.ndcgMacro).toEqual([1])
    expect(result.precisionMacro).toEqual([1])
    expect(result.recallMacro).toEqual([1])
  })

  it('golden 键不可解析即抛错（防 recall 分母静默缩小）', () => {
    const index = buildIndex(chunks)
    const gold = { Q2: { golden: ['a.md#幽灵节'] } }
    expect(() => runHitrate(index, chunks, [questions[1]], gold, [3])).toThrow(/幽灵节/)
  })
})

describe('renderHitrate', () => {
  it('逐题展示自定义 topK 的 recall、precision、nDCG，并保留 miss', () => {
    const markdown = renderHitrate({
      topKs: [1, 4],
      recallMacro: [0.5, 1],
      precisionMacro: [0, 0.25],
      ndcgMacro: [0, 0.5],
      perQuestion: [{
        id: 'Q1',
        total: 2,
        hits: [1, 2],
        precHits: [0, 1],
        precSlots: [0, 4],
        ndcg: [0, 0.5],
        misses: [{ key: 'docs#缺失片段', bestRank: null, excluded: false }],
        excludedKeys: 0,
      }],
      scope: { directoryChunks: 3, retrievalChunks: 3, excludedChunks: 0, excludedGoldenKeys: 0, questionsWithoutReachableKeys: 0 },
    })

    expect(markdown).toContain('@1（R/P/nDCG）')
    expect(markdown).toContain('@4（R/P/nDCG）')
    expect(markdown).toContain('R 1/2; P 0.0% (0/0); nDCG 0.000')
    expect(markdown).toContain('R 2/2; P 25.0% (1/4); nDCG 0.500')
    expect(markdown).toContain('docs#缺失片段（视野外）')
    expect(markdown).toContain('定位目录 3 块｜检索范围 3 块｜排除 0 块｜被排除 gold 键 0 项｜无可达键题 0 题')
    expect(markdown).toContain('不可达键不计入 recall 分母或 nDCG 理想集合')
    expect(markdown).toContain('precision 分母仍为实际填充槽位')
  })

  it('范围排除键逐题标注，不进入任何 topK', () => {
    const markdown = renderHitrate({
      topKs: [1],
      recallMacro: [0],
      precisionMacro: [0],
      ndcgMacro: [0],
      perQuestion: [{
        id: 'Q9',
        total: 0,
        hits: [0],
        precHits: [0],
        precSlots: [1],
        ndcg: [0],
        misses: [{ key: 'base/技能-甲.md#技能', bestRank: null, excluded: true }],
        excludedKeys: 1,
      }],
      scope: { directoryChunks: 5, retrievalChunks: 4, excludedChunks: 1, excludedGoldenKeys: 1, questionsWithoutReachableKeys: 1 },
    })

    expect(markdown).toContain('base/技能-甲.md#技能（被检索范围排除）')
    expect(markdown).toContain('无可达键题 1 题')
  })
})

describe('runHitrate 范围口径（ADR-025）', () => {
  const skillChunks: DocChunk[] = [
    ...chunks,
    {
      id: 'base/技能-甲.md### 电力',
      file: 'base/技能-甲.md',
      heading: '电力',
      text: '发电站无人机充能机制 电力 电力 电力 电力 电力',
      startLine: 2,
      endLine: 4,
    },
  ]

  it('不可达键不占 recall 分母，但仍逐题标注并计入范围计数', () => {
    const retrieval = skillChunks.filter((chunk) => chunk.file !== 'base/技能-甲.md')
    const index = buildIndex(retrieval)
    // golden 指向被排除的分块；真源存在（directory 解析成功），检索范围内不可达。
    const gold = { Q1: { golden: ['base/技能-甲.md#电力', 'a.md#电力'] } }

    const result = runHitrate(index, retrieval, [questions[0]], gold, [3], { directoryChunks: skillChunks })
    const q1 = result.perQuestion[0]!

    expect(q1.total).toBe(1) // 分母只含可达键
    expect(q1.hits[0]).toBe(1) // 唯一可达键命中
    expect(result.recallMacro[0]).toBeCloseTo(1)
    expect(q1.excludedKeys).toBe(1)
    // 逐题明细仍按键区分：被范围排除的键标 excluded，不混同为「视野外」，不因移出分母而消失
    expect(q1.misses).toEqual([{ key: 'base/技能-甲.md#电力', bestRank: null, excluded: true }])
    expect(result.scope).toEqual({
      directoryChunks: 4,
      retrievalChunks: 3,
      excludedChunks: 1,
      excludedGoldenKeys: 1,
      questionsWithoutReachableKeys: 0,
    })
  })

  it('不可达块不进入 nDCG 理想集合，precision 仍以实际返回槽位计量', () => {
    const retrieval: DocChunk[] = [
      { id: 'noise', file: 'base/噪声.md', heading: '电力附注', text: '电力 电力 电力 电力 电力 电力', startLine: 1, endLine: 1 },
      { id: 'gold', file: 'base/机制.md', heading: '电力', text: '电力充能一次', startLine: 1, endLine: 1 },
    ]
    const directory = [...retrieval, skillChunks[3]!]
    const result = runHitrate(buildIndex(retrieval), retrieval,
      [{ id: 'Q1', category: 'fact', question: '电力' }],
      { Q1: { golden: ['base/机制.md#电力', 'base/技能-甲.md#电力'] } }, [2],
      { directoryChunks: directory })

    // 两个实际槽位中只有第二块相关；理想集合只有一个可达块，IDCG=1。
    expect(result.perQuestion[0]).toMatchObject({ total: 1, hits: [1], precHits: [1], precSlots: [2], excludedKeys: 1 })
    expect(result.recallMacro[0]).toBeCloseTo(1)
    expect(result.precisionMacro[0]).toBeCloseTo(0.5)
    expect(result.ndcgMacro[0]).toBeCloseTo(1 / Math.log2(3))
  })

  it('整题 golden 键全不可达时不计入宏平均，并单独计数', () => {
    const retrieval = skillChunks.filter((chunk) => chunk.file !== 'base/技能-甲.md')
    const index = buildIndex(retrieval)
    const gold = {
      Q1: { golden: ['base/技能-甲.md#电力'] }, // 全不可达 → 不进宏平均
      Q2: { golden: ['b.md#宿舍'] }, // 可达且命中
    }
    const result = runHitrate(index, retrieval, questions, gold, [1], { directoryChunks: skillChunks })

    expect(result.perQuestion.map((qh) => qh.total)).toEqual([0, 1])
    expect(result.perQuestion[0]!.excludedKeys).toBe(1)
    // 宏平均只取可达题，不把无分母的题按 0 计入
    expect(result.recallMacro[0]).toBeCloseTo(1)
    expect(result.precisionMacro[0]).toBeCloseTo(1)
    expect(result.ndcgMacro[0]).toBeCloseTo(1)
    expect(result.scope.questionsWithoutReachableKeys).toBe(1)
  })

  it('全部题目都不可达时返回有限的零值，并保留全部排除计数', () => {
    const retrieval = skillChunks.filter((chunk) => chunk.file !== 'base/技能-甲.md')
    const result = runHitrate(buildIndex(retrieval), retrieval, questions,
      { Q1: { golden: ['base/技能-甲.md#电力'] }, Q2: { golden: ['base/技能-甲.md#电力'] } }, [1, 3],
      { directoryChunks: skillChunks })

    expect(result.recallMacro).toEqual([0, 0])
    expect(result.precisionMacro).toEqual([0, 0])
    expect(result.ndcgMacro).toEqual([0, 0])
    expect(result.perQuestion.map((qh) => qh.total)).toEqual([0, 0])
    expect(result.scope).toMatchObject({ questionsWithoutReachableKeys: 2, excludedGoldenKeys: 2 })
  })

  it('真源不存在的键仍抛错，不被范围排除掩盖', () => {
    const retrieval = skillChunks.filter((chunk) => chunk.file !== 'base/技能-甲.md')
    const index = buildIndex(retrieval)
    expect(() => runHitrate(index, retrieval, [questions[0]], { Q1: { golden: ['a.md#幽灵节'] } }, [3], { directoryChunks: skillChunks }))
      .toThrow(/幽灵节/)
  })

  it('缺省 directoryChunks 时退化为单范围口径（排除数为 0）', () => {
    const index = buildIndex(chunks)
    const gold = { Q1: { golden: ['a.md#电力', 'a.md#贸易'] }, Q2: { golden: ['b.md#宿舍'] } }
    const result = runHitrate(index, chunks, questions, gold, [1])

    expect(result.scope).toEqual({
      directoryChunks: 3,
      retrievalChunks: 3,
      excludedChunks: 0,
      excludedGoldenKeys: 0,
      questionsWithoutReachableKeys: 0,
    })
    expect(result.perQuestion.every((q) => q.excludedKeys === 0)).toBe(true)
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
