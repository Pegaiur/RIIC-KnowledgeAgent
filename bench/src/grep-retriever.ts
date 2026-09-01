/**
 * grep 式检索器（P3 受控对照实验组）
 *
 * 设计立场：这不是生产用 grep 检索器，而是「字面命中计数」的受控实验组——
 * 无 IDF 加权、无长度归一，其余（Agent 循环 / 工具接口 / 强制首检 / 输出格式）与 P1 完全一致，
 * 使 P3 vs P1 的质量差异只由「检索器」解释（验证 H3：去掉信息论加权后，同一词袋的检索质量是否显著下降）。
 *
 * 全部用 Node 原生 String.includes 线性扫描（零运行时依赖）；语料仅 267 chunks，成本可忽略。
 * 机制参照 Concliude grep 工具箱（ripgrep.ts + grep.ts + regex-patterns.ts），但只做机制映射，
 * 不引入 @vscode/ripgrep 二进制依赖。
 */
import type { DocChunk } from './types.js'
import { ENTITY_WORDS } from './terms.js'

/** 查询字面模式的最大长度（safePattern 长度上限，防 LLM 注入膨胀） */
export const MAX_PATTERN_LEN = 200

/** 命中行展示的截断字符数（参照 Concliude 单行截断 200） */
export const HIT_LINE_LIMIT = 200

/** 检测控制字符（非全局正则，避免 lastIndex 状态污染） */
const CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
/** 清理控制字符（全局） */
const CONTROL_CHARS_STRIP = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/** 从 query 中提取连续词段（中文段 / 拉丁字母数字串），作为字面短语模式 */
function collectPhrases(query: string): string[] {
  const phrases: string[] = []
  let i = 0
  while (i < query.length) {
    const ch = query[i]
    if (/[\u4e00-\u9fff]/.test(ch)) {
      let j = i
      while (j < query.length && /[\u4e00-\u9fff]/.test(query[j])) j++
      phrases.push(query.slice(i, j))
      i = j
    } else if (/[A-Za-z0-9_]/.test(ch)) {
      // 拉丁/数字串整体保留为短语，内部连字符不失真（如 Castle-3 / Mon3tr）
      const m = /[A-Za-z0-9_][A-Za-z0-9_\-]*/.exec(query.slice(i))
      if (m && m[0].length > 0) {
        phrases.push(m[0])
        i += m[0].length
      } else {
        i++
      }
    } else {
      i++
    }
  }
  return phrases
}

/** 中文段切 2 字滑窗（与 BM25 bigram 同词元集，但只计数不加权） */
function bigramPatterns(query: string): string[] {
  const out: string[] = []
  for (const run of collectPhrases(query)) {
    if (!/[\u4e00-\u9fff]/.test(run[0])) continue // 仅中文段切 bigram；拉丁串整体已是短语模式
    for (let k = 0; k < run.length - 1; k++) out.push(run.slice(k, k + 2))
  }
  return out
}

function hasControlChars(s: string): boolean {
  return CONTROL_CHARS_RE.test(s)
}

/**
 * 构造字面模式集（P3 查询构造）：
 *  1. 实体词表优先：query 中出现的干员/机制名 → 独立模式（专名精确性）
 *  2. 中文连续段短语 / 拉丁串 → 整段字面模式
 *  去重、超长拒收、控制字符拒收。
 */
export function buildGrepPatterns(query: string): string[] {
  const patterns: string[] = []
  const add = (p: string): void => {
    if (p.length === 0 || p.length > MAX_PATTERN_LEN) return
    if (hasControlChars(p)) return
    if (!patterns.includes(p)) patterns.push(p)
  }
  for (const w of ENTITY_WORDS) {
    if (query.includes(w)) add(w)
  }
  for (const p of collectPhrases(query)) add(p)
  return patterns
}

/** 逐 chunk 打分：命中数 = 该 chunk 命中的「不同模式数」（heading 与正文统一计数；同一模式重复命中不叠加） */
function scoreChunks(chunks: DocChunk[], patterns: string[], topK: number): number[] {
  const scored: Array<[number, number]> = []
  chunks.forEach((c, idx) => {
    const haystack = `${c.heading}\n${c.text}`
    let count = 0
    for (const p of patterns) {
      if (haystack.includes(p)) count++
    }
    if (count > 0) scored.push([idx, count])
  })
  // 命中数降序；同分按 chunk 原序稳定
  scored.sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return scored.slice(0, topK).map(([idx]) => idx)
}

/**
 * grep 检索：按「字面命中计数」降序返回 chunk 下标。
 * 若前两阶段（实体 + 短语）总体命中 < topK → 2 字滑窗回退补充（与 BM25 同词袋，仅少加权）。
 */
export function grepSearch(chunks: DocChunk[], query: string, topK: number): number[] {
  if (query.length === 0 || query.length > MAX_PATTERN_LEN) return []
  if (hasControlChars(query)) return []
  const base = buildGrepPatterns(query)
  let hits = scoreChunks(chunks, base, topK)
  if (hits.length < topK) {
    const combined = [...base, ...bigramPatterns(query)]
    hits = scoreChunks(chunks, combined, topK)
  }
  return hits
}

/** 命中行明细：返回 chunk 内命中模式的（绝对行号, 清理后行文本） - 每行截断 200 字符 */
function hitLineNumbers(chunk: DocChunk, patterns: string[]): Array<[number, string]> {
  const lines = chunk.text.split('\n')
  const out: Array<[number, string]> = []
  lines.forEach((line, i) => {
    if (patterns.some((p) => line.includes(p))) {
      const cleaned = line.replace(CONTROL_CHARS_STRIP, '').slice(0, HIT_LINE_LIMIT)
      out.push([chunk.startLine + i, cleaned])
    }
  })
  return out
}

/**
 * 组装 grep 检索结果（供模型阅读）：
 *  - 命中：`【file | heading | Lstart-end】命中 N 处` + 正文（截断 maxContextChars）+ 命中行明细
 *  - 未命中：`未找到匹配（模式: /query/），请改述查询后重试`（工具语义：提示模型换查询，不自动回退 BM25）
 */
export function buildGrepResult(
  chunks: DocChunk[],
  indices: number[],
  query: string,
  maxContextChars: number,
): string {
  if (indices.length === 0) {
    return `未找到匹配（模式: /${query.slice(0, MAX_PATTERN_LEN).replace(CONTROL_CHARS_STRIP, '')}/），请改述查询后重试`
  }
  const patterns = buildGrepPatterns(query)
  const blocks = indices.map((idx) => {
    const c = chunks[idx]
    const hitLines = hitLineNumbers(c, patterns)
    const header = `【${c.file} | ${c.heading} | L${c.startLine}-${c.endLine}】命中 ${hitLines.length} 处`
    const body = c.text.slice(0, maxContextChars).replace(CONTROL_CHARS_STRIP, '')
    const details = hitLines.map(([ln, txt]) => `L${ln}: ${txt}`)
    return [header, body, ...details].filter(Boolean).join('\n')
  })
  return blocks.join('\n\n')
}
