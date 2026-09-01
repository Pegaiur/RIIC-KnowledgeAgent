/**
 * 中文文本分词 + BM25 检索
 *
 * 分词策略（按 config EXPERIMENT.tokenizer 分派，默认 bigram 保持兼容与可复现）：
 *   - bigram：中文/日文连续字符 → 双字 bigram（含边界 unigram）；
 *     拉丁字母/数字连续串 → 单独词元（小写化）。零运行时依赖。
 *   - jieba：jieba-node 纯 JS 分词（ADR-001）。ENTITY_WORDS 注册自定义词典防领域词切碎；
 *     HMM 开启（未登录词发现）；纯标点词元滤除；查询宽化回退见 search()。
 *   索引侧与查询侧共用 tokenize，天然保证同分词器（调研确认的常见 bug 规避）。
 *
 * BM25 经典参数 k1=1.5、b=0.75：只换 token 层，不改打分。
 */
import { addWord, lcut, lcutForSearch, setLogLevel } from 'jieba-node'
import { ENTITY_WORDS } from './terms.js'
import { EXPERIMENT } from './config.js'
import type { DocChunk, TokenizerId } from './types.js'

let jiebaReady = false

/**
 * jieba 幂等初始化：静默日志 + 领域词典注册。
 * 词典必须在 buildIndex 前就绪（索引与查询共享同一分词状态）；addWord 会触发词典惰性加载。
 */
export function initTokenizer(): void {
  if (jiebaReady) return
  setLogLevel('SILENT')
  for (const w of ENTITY_WORDS) addWord(w)
  jiebaReady = true
}

/** 当前分词器（取 config 集中配置；索引与查询同用此函数） */
export function currentTokenizer(): TokenizerId {
  return EXPERIMENT.tokenizer
}

/** 实体词集合（查询词元精确命中时的加权判定；模块顶层构建无副作用） */
const entityTermSet: ReadonlySet<string> = new Set(ENTITY_WORDS)

/**
 * 实体词加权因子（取 config 集中配置，默认 0 = 关闭，保持基线；>0 时按倍率放大精确命中词元贡献）。
 * P2 专名 boost：查询词元若精确命中 ENTITY_WORDS，则其 BM25 得分贡献 × 该因子。
 */
export function currentEntityBoost(): number {
  return Number.isFinite(EXPERIMENT.entityBoost) && EXPERIMENT.entityBoost > 0 ? EXPERIMENT.entityBoost : 0
}

/** 判断查询词元是否为领域实体词（精确命中）。单字专名（望/陈/砾/夕/令/孑/锏）在 bigram 下是 unigram、
 * 任何含该字符的查询都被命中，易误放大歧义词元；故仅对长度 ≥2 的实体词加权。 */
function isEntityTerm(term: string): boolean {
  return term.length >= 2 && entityTermSet.has(term)
}

/** 有效词元：须含字母或数字（纯标点无检索价值） */
function validToken(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token)
}

/** bigram 分词（默认）：CJK 串切双字 + 边界单字；拉丁/数字连续串整体成词元（小写化） */
function tokenizeBigram(text: string): string[] {
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

/** jieba 分词：lcut 第三参 HMM=true（未登录词/新词发现，防领域新词切碎），纯标点滤除 */
function tokenizeJieba(text: string): string[] {
  initTokenizer()
  return lcut(text, false, true).filter(validToken)
}

/** 文本 → 词元数组（按 EXPERIMENT.tokenizer 分派） */
export function tokenize(text: string): string[] {
  return currentTokenizer() === 'jieba' ? tokenizeJieba(text) : tokenizeBigram(text)
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
  // P2 专名 boost：查询词元精确命中实体词表时放大其得分贡献（因子为 0 时退化为原打分）
  const entityBoost = currentEntityBoost()

  const scoring = (qTerms: string[]): Map<number, number> => {
    const scores = new Map<number, number>()
    for (const t of qTerms) {
      if (!df.has(t)) continue
      const mult = entityBoost > 0 && isEntityTerm(t) ? entityBoost : 1
      const idf = Math.log(1 + (n - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
      for (const [docIdx, perDoc] of tf) {
        const f = perDoc.get(t)
        if (!f) continue
        const len = docLens[docIdx]
        const denom = f + k1 * (1 - b + b * (len / avgLen))
        const score = idf * ((f * (k1 + 1)) / denom) * mult
        scores.set(docIdx, (scores.get(docIdx) ?? 0) + score)
      }
    }
    return scores
  }

  let scores = scoring(tokenize(query))
  // jieba 查询宽化回退：精确切分零命中 → lcutForSearch 细粒度扩展子词重查一次
  //（防「未登录词边界导致检索空结果 → 模型编造」的极端场景）
  if (currentTokenizer() === 'jieba' && scores.size === 0) {
    initTokenizer()
    scores = scoring(lcutForSearch(query, true).filter(validToken))
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([idx]) => idx)
}
