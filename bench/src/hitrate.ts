/**
 * 命中率评测（recall@K / precision@K / nDCG@K）
 *
 * 指标口径：
 *   - recall@K = |golden ∩ topK| / |golden|：键级（golden 键任一解析块进 topK 即算命中），
 *     逐题按比例计后取宏平均。度量 golden 覆盖。
 *   - precision@K = |topK 中 golden 块| / 实际填充槽位数 min(K, 检索返回数)：块级。
 *     度量注入槽位的非 golden 污染率（1 − precision）。
 *   - nDCG@K：binary relevance（块级，golden 解析块集合），排序质量（golden 越靠前越高）。
 *
 * golden 键格式：`file#清洗后标题`（splitChunks 产出的 heading，无 ## 前缀）。
 * 解析顺序：① 精确 chunk.id（file#原始标题行）；② 回退 file#清洗标题 匹配
 * （chunk.id 实际含 `## ` 前缀，清洗键更易手写维护，由 --check-gold 兜底校验）。
 */
import { readFileSync } from 'node:fs'
import type { BenchQuery, DocChunk } from './types.js'
import { buildIndex, search } from './retriever.js'

/** gold.json 结构：题目 ID → golden 键列表 */
export interface GoldMap {
  [queryId: string]: { golden: string[] }
}

/** 读取 gold.json（仅做形状校验，chunk 存在性校验由 checkGold 负责） */
export function loadGold(path: string): GoldMap {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as GoldMap
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`gold.json 格式错误（应为对象）：${path}`)
  }
  for (const [qid, entry] of Object.entries(raw)) {
    if (!entry || !Array.isArray(entry.golden) || entry.golden.length === 0) {
      throw new Error(`gold.json 条目 ${qid} 缺少非空 golden 数组`)
    }
    for (const key of entry.golden) {
      if (typeof key !== 'string' || !key.includes('#')) {
        throw new Error(`gold.json 条目 ${qid} 含非法 golden 键（应为 file#heading）：${String(key)}`)
      }
    }
  }
  return raw
}

/**
 * golden 键 → chunk 下标集合。
 * ① 精确 chunk.id 匹配；② 回退「file#清洗标题」匹配（同一键可能命中多块，全部收录）。
 * 返回 resolved 与无法解析的键列表。
 */
export function resolveGold(
  golden: string[],
  chunks: DocChunk[],
): { resolved: number[][]; missing: string[] } {
  const byId = new Map<string, number[]>()
  chunks.forEach((c, idx) => {
    const list = byId.get(c.id) ?? []
    list.push(idx)
    byId.set(c.id, list)
  })
  const byClean = new Map<string, number[]>()
  chunks.forEach((c, idx) => {
    const key = `${c.file}#${c.heading}`
    const list = byClean.get(key) ?? []
    list.push(idx)
    byClean.set(key, list)
  })

  const resolved: number[][] = []
  const missing: string[] = []
  for (const key of golden) {
    const hit = byId.get(key) ?? byClean.get(key)
    if (hit && hit.length > 0) resolved.push(hit)
    else missing.push(key)
  }
  return { resolved, missing }
}

/** gold ↔ 语料对应关系校验：返回缺失清单（空数组 = 全部可解析） */
export function checkGold(
  gold: GoldMap,
  chunks: DocChunk[],
): { missing: { queryId: string; key: string }[] } {
  const missing: { queryId: string; key: string }[] = []
  for (const [queryId, entry] of Object.entries(gold)) {
    const { missing: miss } = resolveGold(entry.golden, chunks)
    for (const key of miss) missing.push({ queryId, key })
  }
  return { missing }
}

/** 逐题命中明细 */
export interface QuestionHit {
  id: string
  /** golden 键总数 */
  total: number
  /** 各 topK 下的命中键数（与 topKs 对齐） */
  hits: number[]
  /** 各 topK 下的 precision 分子：topK 槽位中 golden 解析块数（与 topKs 对齐） */
  precHits: number[]
  /** 各 topK 下的 precision 分母：实际填充槽位数 min(K, 检索返回数) */
  precSlots: number[]
  /** 各 topK 下的 nDCG（binary relevance，块级） */
  ndcg: number[]
  /** 检索视野（max(topKs, 20)）内未进入任何 topK 的键及其最佳位次（1 基；视野外为 null） */
  misses: { key: string; bestRank: number | null }[]
}

export interface HitrateResult {
  topKs: number[]
  /** 各 topK 的宏平均 recall（与 topKs 对齐） */
  recallMacro: number[]
  /** 各 topK 的宏平均 precision（与 topKs 对齐） */
  precisionMacro: number[]
  /** 各 topK 的宏平均 nDCG（与 topKs 对齐） */
  ndcgMacro: number[]
  perQuestion: QuestionHit[]
  /** 运行参数上下文（如分词器/实体加权），非必填；用于 --out 落盘可复现 */
  note?: string
}

/**
 * 跑命中率评测：每题一次检索（视野取 max(topKs, 20)），从同一排序派生各 K 的命中与位次。
 * gold 缺题或 golden 键不可解析即抛错（数据完整性优先，防 recall 分母静默缩小而虚高）。
 */
export function runHitrate(
  index: ReturnType<typeof buildIndex>,
  chunks: DocChunk[],
  questions: BenchQuery[],
  gold: GoldMap,
  topKs: number[],
): HitrateResult {
  if (topKs.length === 0) throw new Error('topKs 不能为空')
  const viewK = Math.max(...topKs, 20)
  const perQuestion: QuestionHit[] = []

  for (const q of questions) {
    const entry = gold[q.id]
    if (!entry) throw new Error(`gold.json 缺少题目 ${q.id} 的 golden 标注`)
    const { resolved, missing } = resolveGold(entry.golden, chunks)
    if (missing.length > 0) {
      throw new Error(`题目 ${q.id} 的 golden 键无法解析（先跑 hitrate --check-gold 定位）：${missing.join('、')}`)
    }
    const ranked = search(index, q.question, viewK)
    const rankOf = new Map<number, number>()
    ranked.forEach((chunkIdx, pos) => rankOf.set(chunkIdx, pos + 1))

    const hits = topKs.map(() => 0)
    const precHits = topKs.map(() => 0)
    const precSlots = topKs.map((k) => Math.min(k, ranked.length))
    // nDCG：binary relevance（golden 解析块集合），DCG/IDCG 均按位次 1/log2(pos+1)
    const goldenChunks = new Set(resolved.flat())
    const ndcg = topKs.map((k) => {
      let dcg = 0
      for (let pos = 1; pos <= Math.min(k, ranked.length); pos++) {
        if (goldenChunks.has(ranked[pos - 1])) dcg += 1 / Math.log2(pos + 1)
      }
      let idcg = 0
      for (let i = 1; i <= Math.min(goldenChunks.size, k); i++) idcg += 1 / Math.log2(i + 1)
      return idcg === 0 ? 0 : dcg / idcg
    })
    topKs.forEach((k, ki) => {
      for (let pos = 0; pos < Math.min(k, ranked.length); pos++) {
        if (goldenChunks.has(ranked[pos])) precHits[ki]++
      }
    })

    const misses: { key: string; bestRank: number | null }[] = []
    resolved.forEach((chunkIdxs, i) => {
      const bestRank = Math.min(...chunkIdxs.map((ci) => rankOf.get(ci) ?? Number.POSITIVE_INFINITY))
      topKs.forEach((k, ki) => {
        if (bestRank <= k) hits[ki]++
      })
      if (bestRank > viewK) {
        misses.push({ key: entry.golden[i], bestRank: null })
      } else if (bestRank > Math.max(...topKs)) {
        misses.push({ key: entry.golden[i], bestRank })
      }
    })

    perQuestion.push({ id: q.id, total: resolved.length, hits, precHits, precSlots, ndcg, misses })
  }

  const macro = (pick: (qh: QuestionHit, ki: number) => number): number[] =>
    topKs.map((_, ki) => {
      const sum = perQuestion.reduce((acc, qh) => acc + pick(qh, ki), 0)
      return sum / perQuestion.length
    })

  return {
    topKs,
    recallMacro: macro((qh, ki) => qh.hits[ki] / qh.total),
    precisionMacro: macro((qh, ki) => (qh.precSlots[ki] === 0 ? 0 : qh.precHits[ki] / qh.precSlots[ki])),
    ndcgMacro: macro((qh, ki) => qh.ndcg[ki]),
    perQuestion,
  }
}

/** 渲染 Markdown 报告：汇总曲线 + 逐题明细 + miss 位次 */
export function renderHitrate(result: HitrateResult): string {
  const lines: string[] = [
    '# 命中率评测（recall@K / precision@K / nDCG@K）',
    '',
    '> 口径：recall@K 键级按比例计（golden 键任一解析块进 topK 即命中）；precision@K 块级，分母为实际填充槽位；nDCG@K 块级 binary relevance。均取宏平均；golden 键为 file#清洗标题。',
  ]
  if (result.note) lines.push('', `> 参数：${result.note}`)
  lines.push(
    '',
    '## 汇总',
    '',
    '| topK | recall | precision | nDCG |',
    '|---|---|---|---|',
  )
  result.topKs.forEach((k, i) => {
    lines.push(
      `| ${k} | ${(result.recallMacro[i] * 100).toFixed(1)}% | ${(result.precisionMacro[i] * 100).toFixed(1)}% | ${result.ndcgMacro[i].toFixed(3)} |`,
    )
  })

  lines.push('', '## 逐题明细', '', '| 题目 | golden 数 | ' + result.topKs.map((k) => `@${k}`).join(' | ') + ' | 未命中（最大视野最佳位次） |', `|---|---|${result.topKs.map(() => '---').join('|')}|---|`)
  for (const qh of result.perQuestion) {
    const cells = qh.hits.map((h) => `${h}/${qh.total}`).join(' | ')
    const missStr = qh.misses.length === 0
      ? '—'
      : qh.misses.map((m) => `${m.key}（${m.bestRank === null ? '视野外' : `第 ${m.bestRank} 位`}）`).join('；')
    lines.push(`| ${qh.id} | ${qh.total} | ${cells} | ${missStr} |`)
  }
  return lines.join('\n')
}
