/**
 * RAG + facts 20 题基准的跨文件完整性校验。
 *
 * questions、gold、spec 是同一份评测定义的三个投影：题号必须一一对应。
 * gold 在「完整定位目录」解析——manifest 登记的 base/guides 原文分块 + facts 声明的正式输入（ADR-021 步骤 6）；
 * 命中文档不再等价于属于 manifest：facts 正式输入可定位但被检索范围排除，hitrate 按 ADR-025 排除这些键的 recall 分母与块的 nDCG 理想集合贡献，并单独计数。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadCorpus, loadCorpusManifest, loadGoldAnchorChunks } from './corpus.js'
import { FACTS_SOURCE_DOC_IDS } from './facts/references.js'
import { checkGold, loadGold, type GoldMap } from './hitrate.js'
import type { BenchQuery } from './types.js'
import { readSnapshot } from './snapshot.js'
import { validateQualityBaseline } from './quality-baseline.js'

const QUESTION_ID_PATTERN = /^[FSG]\d{2}$/
const EXPECTED_COUNTS = { fact: 10, system: 8, gadget: 2 } as const

export interface BenchmarkIntegritySummary {
  questionCount: number
  goldCount: number
  specCount: number
  /** manifest 白名单文件数（检索范围） */
  corpusFileCount: number
  /** manifest 原文分块数（检索范围） */
  chunkCount: number
  /** gold 完整定位目录文件数（manifest + facts 正式输入） */
  anchorFileCount: number
  /** gold 完整定位目录分块数 */
  anchorChunkCount: number
  snapshotCount: number
  snapshotBytes: number
  baselineResults: number
}

function readQuestions(root: string): BenchQuery[] {
  const path = join(root, 'bench', 'questions.json')
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
  if (!Array.isArray(parsed)) throw new Error(`问题集格式错误：${path}`)
  return parsed as BenchQuery[]
}

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}

function missingFrom(source: Iterable<string>, target: ReadonlySet<string>): string[] {
  return [...source].filter((item) => !target.has(item))
}

function validateSharedSnapshots(root: string, errors: string[]): { count: number; bytes: number } {
  const resultsRoot = join(root, 'bench', 'results')
  if (!existsSync(resultsRoot)) return { count: 0, bytes: 0 }
  const files = readdirSync(resultsRoot, { withFileTypes: true })
  const snapshots = files.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  if (snapshots.length === 0) return { count: 0, bytes: 0 }
  let bytes = 0
  for (const entry of snapshots) {
    const path = join(resultsRoot, entry.name)
    try {
      readSnapshot(path)
      bytes += statSync(path).size
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      errors.push(`共享快照 ${entry.name} 校验失败：${detail}`)
    }
  }
  return { count: snapshots.length, bytes }
}

export function extractSpecQuestionIds(specText: string): string[] {
  return [...specText.matchAll(/^##\s+([FSG]\d{2})(?:\s|$)/gm)].map((match) => match[1])
}

export function validateBenchmarkIntegrity(root: string): BenchmarkIntegritySummary {
  const errors: string[] = []
  const questions = readQuestions(root)
  const questionIds = questions.map((question) => question.id)
  const questionIdSet = new Set(questionIds)

  if (questions.length !== 20) errors.push(`questions 应为 20 题，实际 ${questions.length} 题`)
  const questionDuplicates = duplicateIds(questionIds)
  if (questionDuplicates.length > 0) errors.push(`questions 存在重复题号：${questionDuplicates.join('、')}`)
  if (questions.some((question) => typeof question.id !== 'string' || !QUESTION_ID_PATTERN.test(question.id))) {
    errors.push('questions 含非法题号（应为 F/S/G + 两位数字）')
  }
  const categoryCounts = questions.reduce<Record<string, number>>((counts, question) => {
    counts[question.category] = (counts[question.category] ?? 0) + 1
    return counts
  }, {})
  for (const [category, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (categoryCounts[category] !== expected) {
      errors.push(`questions 的 ${category} 应为 ${expected} 题，实际 ${categoryCounts[category] ?? 0} 题`)
    }
  }

  const goldPath = join(root, 'bench', 'gold.json')
  const gold = loadGold(goldPath)
  const goldIds = Object.keys(gold)
  const goldIdSet = new Set(goldIds)
  const goldMissingQuestions = missingFrom(questionIds, goldIdSet)
  const goldExtraQuestions = missingFrom(goldIds, questionIdSet)
  if (goldMissingQuestions.length > 0) errors.push(`gold 缺少题号：${goldMissingQuestions.join('、')}`)
  if (goldExtraQuestions.length > 0) errors.push(`gold 多出题号：${goldExtraQuestions.join('、')}`)

  const corpusRoot = join(root, 'knowledge')
  const manifest = new Set(loadCorpusManifest(corpusRoot))
  const chunks = loadCorpus(corpusRoot)
  // gold 先在完整定位目录解析：manifest 原文分块 + facts 声明的正式输入（ADR-021 步骤 6）。
  // facts 正式输入可定位但不在检索范围内，hitrate 按 ADR-025 只对可达键与块计量，排除项单独计数。
  const anchorChunks = loadGoldAnchorChunks(corpusRoot, FACTS_SOURCE_DOC_IDS)
  const anchorFiles = new Set(anchorChunks.map((chunk) => chunk.file))
  const anchorKeys = new Set(anchorChunks.map((chunk) => `${chunk.file}#${chunk.heading}`))
  for (const [queryId, entry] of Object.entries(gold)) {
    const goldenKeys = new Set<string>()
    for (const key of entry.golden) {
      if (goldenKeys.has(key)) errors.push(`gold ${queryId} 重复 golden：${key}`)
      goldenKeys.add(key)
      const separator = key.indexOf('#')
      const file = separator < 0 ? '' : key.slice(0, separator)
      if (!anchorFiles.has(file)) errors.push(`gold ${queryId} 引用不在定位目录的文档：${file || key}`)
      if (!anchorKeys.has(key)) errors.push(`gold ${queryId} 引用不存在的切块锚点：${key}`)
    }
  }
  const unresolved = checkGold(gold, anchorChunks).missing
  for (const item of unresolved) errors.push(`gold ${item.queryId} 无法解析：${item.key}`)

  const specPath = join(root, 'docs', 'spec', 'rag-answer-baseline.md')
  const specIds = extractSpecQuestionIds(readFileSync(specPath, 'utf-8'))
  const specIdSet = new Set(specIds)
  const specDuplicates = duplicateIds(specIds)
  if (specDuplicates.length > 0) errors.push(`spec 存在重复题号：${specDuplicates.join('、')}`)
  const specMissingQuestions = missingFrom(questionIds, specIdSet)
  const specExtraQuestions = missingFrom(specIds, questionIdSet)
  if (specMissingQuestions.length > 0) errors.push(`spec 缺少题号：${specMissingQuestions.join('、')}`)
  if (specExtraQuestions.length > 0) errors.push(`spec 多出题号：${specExtraQuestions.join('、')}`)

  const snapshots = validateSharedSnapshots(root, errors)
  const baseline = validateQualityBaseline(root, errors)

  if (errors.length > 0) {
    throw new Error(`基准完整性校验失败：\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }

  return {
    questionCount: questions.length,
    goldCount: goldIds.length,
    specCount: specIds.length,
    corpusFileCount: manifest.size,
    chunkCount: chunks.length,
    anchorFileCount: anchorFiles.size,
    anchorChunkCount: anchorChunks.length,
    snapshotCount: snapshots.count,
    snapshotBytes: snapshots.bytes,
    baselineResults: baseline?.resultCount ?? 0,
  }
}

export type { GoldMap }
