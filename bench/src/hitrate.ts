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
 *
 * 范围口径（ADR-013 步骤 5）：gold 先在完整、未截断的定位目录解析，分母不因检索范围收缩而删减；
 * 检索范围只影响「可达性」，候选块须映射回稳定原键（chunk.id），不得对过滤后的数组下标直接套旧 gold。
 * 被策略排除但真源存在的键计未命中并保留 recall 分母；precision/nDCG 仍按全部 gold 原块定义，
 * 不把排除后的可达集合当作理想相关集合。跨范围结果不直接横比。
 */
import { readFileSync } from 'node:fs'
import type { BenchQuery, DocChunk } from './types.js'
import { search, type IndexEntry } from './retriever.js'

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
  /** golden 键总数（完整定位目录口径，不因检索范围收缩而删减） */
  total: number
  /** 各 topK 下的命中键数（与 topKs 对齐） */
  hits: number[]
  /** 各 topK 下的 precision 分子：topK 槽位中 golden 解析块数（与 topKs 对齐） */
  precHits: number[]
  /** 各 topK 下的 precision 分母：实际填充槽位数 min(K, 检索返回数) */
  precSlots: number[]
  /** 各 topK 下的 nDCG（binary relevance，块级） */
  ndcg: number[]
  /** 检索视野（max(topKs, 20)）内未进入任何 topK 的键及其最佳位次（1 基；视野外或范围排除为 null） */
  misses: { key: string; bestRank: number | null }[]
  /** 真源存在但被检索范围排除、因而不可达的 golden 键数（计入未命中，保留在 total 分母） */
  excludedKeys: number
}

/** 检索范围上下文：定位目录与实际参与排序的检索范围分开计量。 */
export interface HitrateScope {
  /** 完整、未截断的定位目录分块数 */
  directoryChunks: number
  /** 实际参与排序的检索范围分块数 */
  retrievalChunks: number
  /** 被检索范围排除的分块数 */
  excludedChunks: number
  /** 真源存在但被检索范围排除的 gold 键总数 */
  excludedGoldenKeys: number
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
  /** 范围计数与排除数量；跨策略比较据此如实标注可达性变化。 */
  scope: HitrateScope
  /** 运行参数上下文（如分词器/实体加权），非必填；用于 --out 落盘可复现 */
  note?: string
}

/** runHitrate 的可选范围配置。 */
export interface HitrateOptions {
  /** gold 解析用的完整、未截断定位目录；缺省与检索 chunks 相同（单范围历史口径）。 */
  directoryChunks?: DocChunk[]
}

/**
 * 跑命中率评测：每题一次检索（视野取 max(topKs, 20)），从同一排序派生各 K 的命中与位次。
 * gold 在完整定位目录解析，缺题或 golden 键在真源不可解析即抛错（数据完整性优先，防 recall 分母静默缩小而虚高）；
 * 检索范围 chunks 只决定可达性：被排除但真源存在的键计未命中并保留分母，候选块一律映射回稳定原键（chunk.id）。
 * 边界：hitrate（基于 gold.json 的检索质量）与 agent run 的 injected.json 注入覆盖率是两条独立测量管线，职责不同，勿合并。
 * TODO(tech-debt) D1：结果仅输出控制台 / --out，未落 bench-runs/<ts>-hitrate/；如需严格跨日逐题对比再实现落盘。
 */
export function runHitrate(
  index: IndexEntry,
  chunks: DocChunk[],
  questions: BenchQuery[],
  gold: GoldMap,
  topKs: number[],
  options: HitrateOptions = {},
): HitrateResult {
  if (topKs.length === 0) throw new Error('topKs 不能为空')
  const viewK = Math.max(...topKs, 20)
  // gold 在完整、未截断的定位目录解析；检索范围 chunks 仅用于排序与可达性判定。
  const directory = options.directoryChunks ?? chunks
  const retrievalIds = new Set(chunks.map((chunk) => chunk.id))
  const perQuestion: QuestionHit[] = []
  let excludedGoldenKeys = 0

  for (const q of questions) {
    const entry = gold[q.id]
    if (!entry) throw new Error(`gold.json 缺少题目 ${q.id} 的 golden 标注`)
    const { resolved, missing } = resolveGold(entry.golden, directory)
    if (missing.length > 0) {
      throw new Error(`题目 ${q.id} 的 golden 键无法解析（先跑 hitrate --check-gold 定位）：${missing.join('、')}`)
    }
    // 每个 golden 键 → 稳定原键（chunk.id）集合；映射不依赖过滤后的数组下标，resolved 与 entry.golden 一一对应。
    const goldenIdsByKey = resolved.map((idxs) => new Set(idxs.map((di) => directory[di]!.id)))
    const goldenIds = new Set(goldenIdsByKey.flatMap((ids) => [...ids]))

    const ranked = search(index, q.question, viewK)
    const rankOf = new Map<string, number>()
    ranked.forEach((chunkIdx, pos) => {
      const id = chunks[chunkIdx]?.id
      if (id !== undefined && !rankOf.has(id)) rankOf.set(id, pos + 1)
    })

    const hits = topKs.map(() => 0)
    const precHits = topKs.map(() => 0)
    const precSlots = topKs.map((k) => Math.min(k, ranked.length))
    // nDCG：binary relevance（全部 golden 原块集合，含被范围排除者），DCG/IDCG 均按位次 1/log2(pos+1)
    const ndcg = topKs.map((k) => {
      let dcg = 0
      for (let pos = 1; pos <= Math.min(k, ranked.length); pos++) {
        const id = chunks[ranked[pos - 1]]?.id
        if (id !== undefined && goldenIds.has(id)) dcg += 1 / Math.log2(pos + 1)
      }
      let idcg = 0
      for (let i = 1; i <= Math.min(goldenIds.size, k); i++) idcg += 1 / Math.log2(i + 1)
      return idcg === 0 ? 0 : dcg / idcg
    })
    topKs.forEach((k, ki) => {
      for (let pos = 0; pos < Math.min(k, ranked.length); pos++) {
        const id = chunks[ranked[pos]]?.id
        if (id !== undefined && goldenIds.has(id)) precHits[ki]++
      }
    })

    const misses: { key: string; bestRank: number | null }[] = []
    let excludedKeys = 0
    goldenIdsByKey.forEach((ids, i) => {
      const reachable = [...ids].filter((id) => retrievalIds.has(id))
      // 被策略排除但真源存在的键计未命中，仍保留在 recall 分母（total=resolved.length）中。
      if (reachable.length === 0) excludedKeys++
      const bestRank = reachable.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...reachable.map((id) => rankOf.get(id) ?? Number.POSITIVE_INFINITY))
      topKs.forEach((k, ki) => {
        if (bestRank <= k) hits[ki]++
      })
      if (bestRank > viewK) {
        misses.push({ key: entry.golden[i], bestRank: null })
      } else if (bestRank > Math.max(...topKs)) {
        misses.push({ key: entry.golden[i], bestRank })
      }
    })
    excludedGoldenKeys += excludedKeys

    perQuestion.push({ id: q.id, total: resolved.length, hits, precHits, precSlots, ndcg, misses, excludedKeys })
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
    scope: {
      directoryChunks: directory.length,
      retrievalChunks: chunks.length,
      excludedChunks: directory.filter((chunk) => !retrievalIds.has(chunk.id)).length,
      excludedGoldenKeys,
    },
  }
}

/**
 * 渲染 Markdown 报告：汇总曲线 + 逐题明细 + miss 位次。
 */
export function renderHitrate(result: HitrateResult): string {
  const lines: string[] = [
    '# 命中率评测（recall@K / precision@K / nDCG@K）',
    '',
    '> 口径：recall@K 键级按比例计（golden 键任一解析块进 topK 即命中）；precision@K 块级，分母为实际填充槽位；nDCG@K 块级 binary relevance。均取宏平均；golden 键为 file#清洗标题。',
    '> 范围：gold 在完整定位目录解析，分母不因检索范围收缩而删减；被排除但真源存在的键计未命中，仍保留在 recall 分母。跨范围结果不直接横比。',
    `> 范围计数：定位目录 ${result.scope.directoryChunks} 块｜检索范围 ${result.scope.retrievalChunks} 块｜排除 ${result.scope.excludedChunks} 块｜被排除 gold 键 ${result.scope.excludedGoldenKeys} 项`,
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

  lines.push('', '## 逐题明细', '', '| 题目 | golden 数 | ' + result.topKs.map((k) => `@${k}（R/P/nDCG）`).join(' | ') + ' | 未命中（最大视野最佳位次） |', `|---|---|${result.topKs.map(() => '---').join('|')}|---|`)
  for (const qh of result.perQuestion) {
    const cells = qh.hits.map((h, i) => {
      const precision = qh.precSlots[i] === 0 ? 0 : qh.precHits[i] / qh.precSlots[i]
      return `R ${h}/${qh.total}; P ${(precision * 100).toFixed(1)}% (${qh.precHits[i]}/${qh.precSlots[i]}); nDCG ${qh.ndcg[i].toFixed(3)}`
    }).join(' | ')
    const missParts = qh.misses.map((m) => `${m.key}（${m.bestRank === null ? '视野外' : `第 ${m.bestRank} 位`}）`)
    if (qh.excludedKeys > 0) missParts.push(`其中 ${qh.excludedKeys} 项被检索范围排除`)
    const missStr = missParts.length === 0 ? '—' : missParts.join('；')
    lines.push(`| ${qh.id} | ${qh.total} | ${cells} | ${missStr} |`)
  }
  return lines.join('\n')
}
