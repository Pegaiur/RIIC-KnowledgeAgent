/**
 * 中式文本分词 + BM25 检索
 *
 * 分词策略（无外部依赖）：
 *   - 中文/日文连续字符 → 双字 bigram（含边界 unigram）
 *   - 拉丁字母/数字连续串 → 单独词元（小写化）
 * BM25 经典参数 k1=1.5、b=0.75，检索目标：成本基准不追求精度，取 top-k 片段即可。
 */
import type { DocChunk } from './types.js'

/** 文本 → 词元数组 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(ch)) {
      // 连续 CJK 串 → bigram
      let j = i
      while (j < text.length && /[\u4e00-\u9fff\u3040-\u30ff]/.test(text[j])) j++
      const run = text.slice(i, j)
      for (let k = 0; k < run.length - 1; k++) tokens.push(run.slice(k, k + 2))
      for (const c of run) tokens.push(c)
      i = j
    } else if (/[A-Za-z0-9_]/.test(ch)) {
      const m = /[A-Za-z0-9_]+/.exec(text.slice(i))
      if (m && m[0].length > 0) {
        tokens.push(m[0].toLowerCase())
        i += m[0].length
      } else {
        i++
      }
    } else {
      i++
    }
  }
  return tokens
}

interface IndexEntry {
  /** 词项 → 出现文档数 */
  df: Map<string, number>
  /** 词项 → 文档内词频（分块粒度） */
  tf: Map<number, Map<string, number>>
  /** 分块文档长度 */
  docLens: number[]
}

/** 预构建 BM25 索引 */
export function buildIndex(chunks: DocChunk[]): IndexEntry {
  const df = new Map<string, number>()
  const tf = new Map<number, Map<string, number>>()
  const docLens: number[] = []

  chunks.forEach((chunk, idx) => {
    const terms = tokenize(`${chunk.anchor ?? ''} ${chunk.heading} ${chunk.text}`)
    const termSet = new Set<string>()
    const perDoc = new Map<string, number>()
    for (const t of terms) {
      perDoc.set(t, (perDoc.get(t) ?? 0) + 1)
      termSet.add(t)
    }
    tf.set(idx, perDoc)
    docLens.push(terms.length)
    for (const t of termSet) df.set(t, (df.get(t) ?? 0) + 1)
  })

  return { df, tf, docLens }
}

/** BM25 检索：返回按得分降序的 chunk 下标 */
export function search(
  index: IndexEntry,
  query: string,
  topK: number,
  k1 = 1.5,
  b = 0.75,
): number[] {
  const { df, tf, docLens } = index
  const n = docLens.length
  if (n === 0) return []
  const avgLen = docLens.reduce((a, c) => a + c, 0) / n
  const qTerms = tokenize(query)

  const scores = new Map<number, number>()
  for (const t of qTerms) {
    if (!df.has(t)) continue
    const idf = Math.log(1 + (n - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
    for (const [docIdx, perDoc] of tf) {
      const f = perDoc.get(t)
      if (!f) continue
      const len = docLens[docIdx]
      const denom = f + k1 * (1 - b + b * (len / avgLen))
      const score = idf * ((f * (k1 + 1)) / denom)
      scores.set(docIdx, (scores.get(docIdx) ?? 0) + score)
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([idx]) => idx)
}
