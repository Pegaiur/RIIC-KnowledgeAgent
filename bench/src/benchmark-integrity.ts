/**
 * RAG + facts 20 题基准的跨文件完整性校验。
 *
 * questions、gold、spec 是同一份评测定义的三个投影：题号必须一一对应，
 * gold 只能引用 manifest 白名单中的真实切块，避免检索指标因漂移静默失真。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCorpus, loadCorpusManifest } from './corpus.js'
import { checkGold, loadGold, type GoldMap } from './hitrate.js'
import type { BenchQuery } from './types.js'
import { readSnapshot } from './snapshot.js'

const QUESTION_ID_PATTERN = /^[FSG]\d{2}$/
const EXPECTED_COUNTS = { fact: 10, system: 8, gadget: 2 } as const

export interface BenchmarkIntegritySummary {
  questionCount: number
  goldCount: number
  specCount: number
  corpusFileCount: number
  chunkCount: number
  snapshotCount: number
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

function validateSharedSnapshots(root: string, errors: string[]): number {
  const resultsRoot = join(root, 'bench', 'results')
  if (!existsSync(resultsRoot)) {
    errors.push('bench/results 不存在，至少需要一个已入库共享快照')
    return 0
  }
  const files = readdirSync(resultsRoot, { withFileTypes: true })
  const snapshots = files.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  if (snapshots.length === 0) {
    errors.push('bench/results 没有可校验的 .json 共享快照')
    return 0
  }
  for (const entry of snapshots) {
    const path = join(resultsRoot, entry.name)
    try {
      readSnapshot(path)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      errors.push(`共享快照 ${entry.name} 校验失败：${detail}`)
    }
  }
  return snapshots.length
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
  const chunkIds = new Set(chunks.map((chunk) => `${chunk.file}#${chunk.heading}`))
  for (const [queryId, entry] of Object.entries(gold)) {
    const goldenKeys = new Set<string>()
    for (const key of entry.golden) {
      if (goldenKeys.has(key)) errors.push(`gold ${queryId} 重复 golden：${key}`)
      goldenKeys.add(key)
      const separator = key.indexOf('#')
      const file = separator < 0 ? '' : key.slice(0, separator)
      if (!manifest.has(file)) errors.push(`gold ${queryId} 引用不在 manifest 的文档：${file || key}`)
      if (!chunkIds.has(key)) errors.push(`gold ${queryId} 引用不存在的切块锚点：${key}`)
    }
  }
  const unresolved = checkGold(gold, chunks).missing
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

  const snapshotCount = validateSharedSnapshots(root, errors)

  if (errors.length > 0) {
    throw new Error(`基准完整性校验失败：\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }

  return {
    questionCount: questions.length,
    goldCount: goldIds.length,
    specCount: specIds.length,
    corpusFileCount: manifest.size,
    chunkCount: chunks.length,
    snapshotCount,
  }
}

export type { GoldMap }
