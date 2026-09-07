/**
 * 基准共享快照：将旧运行目录压缩为可入库的单个 JSON 文件。
 *
 * 快照只保存可复核的原始事实，不保存完整 trace、响应正文或密钥。
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { BenchQuery, CostRecord, HttpAttempt, LlmUsage, TerminationReason } from './types.js'

export const SNAPSHOT_SCHEMA_VERSION = 1 as const

export type SnapshotQueryStatus = 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface SnapshotQuery {
  id: string
  category: string
  question: string
  answer: string | null
  status: SnapshotQueryStatus
  terminationReason: TerminationReason | 'unknown'
  rounds: number
  toolRounds: number
  toolTrace: string[]
  feedbackUsed: boolean
  budgetUsed: number
  budgetRemaining: number
  injectedIds: string[]
}

export interface BenchSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION
  runId: string
  topic: string
  meta: Record<string, unknown>
  queries: SnapshotQuery[]
  records: CostRecord[]
}

export interface SnapshotFromRunOptions {
  root?: string
  questions?: BenchQuery[]
  topic?: string
}

interface QuestionRecoveryContext {
  runDir: string
  answers: Map<string, ParsedAnswer>
  records: CostRecord[]
}

interface RecoveredQuestion {
  id: string
  category: string
  question: string
}

const TOP_LEVEL_KEYS = ['schemaVersion', 'runId', 'topic', 'meta', 'queries', 'records']
const RECORD_KEYS = [
  'ts', 'queryId', 'category', 'round', 'thinking', 'provider', 'model',
  'input', 'output', 'knownInput', 'knownOutput', 'cached', 'reasoning',
  'costIn', 'costOut', 'costTotal', 'usageCompleteness', 'usageAggregation',
  'httpAttempts', 'truncated', 'tools', 'toolBatch',
]
const TOOL_BATCH_KEYS = ['requested', 'granted', 'executed', 'denied', 'errors', 'hitCount', 'hitUnknown', 'budgetBefore', 'budgetAfter', 'resultChars']
const OPTIONAL_TOOL_BATCH_KEYS = new Set(['hitCount', 'hitUnknown'])
const META_SUMMARY_KEYS = new Set([
  'records', 'inputTokens', 'outputTokens', 'inputTokensExact', 'outputTokensExact',
  'totalCostIn', 'totalCostOut', 'totalCost', 'costComplete', 'incompleteUsageCalls',
  'unknownUsageCalls', 'failed', 'modelSteps', 'toolBatches', 'toolCallsRequested',
  'toolCallsGranted', 'toolCallsExecuted', 'toolCallsDenied', 'toolErrors',
  'toolResultChars', 'toolHitCount', 'toolHitUnknown', 'httpAttempts', 'retryAttempts', 'feedbackUsed', 'terminationReasons',
  'elapsedMs',
])
const META_ALLOWED_KEYS = new Set([
  'schemaVersion', 'traceSchemaVersion', 'ts', 'thinking', 'dry', 'provider', 'model',
  'temperature', 'baseUrl', 'retriever', 'minRagCalls', 'toolBudget', 'sessionTimeoutMs',
  'feedbackOnNoToolAnswer', 'toolChoice', 'parallelToolCalls', 'agentInstructionsSha256',
  'toolSchemaVersion', 'toolSchemaSha256', 'toolNames',
  'tokenizer', 'entityBoost', 'topK', 'maxContextChars', 'corpusDir', 'chunks', 'questions',
  'questionIds', 'questionsPath', 'questionDefinitions', 'topic', 'prices', 'source',
])
const TERMINATION_REASONS = new Set<TerminationReason>([
  'answer', 'no_tool_after_feedback', 'llm_error', 'tool_error', 'timeout',
  'cancelled', 'empty_response', 'truncated', 'protocol_error',
])
const HTTP_OUTCOMES = new Set<HttpAttempt['outcome']>(['accepted', 'retry', 'failed', 'aborted', 'in_flight'])

/** 从运行目录生成共享快照；旧目录缺少回答文件时仍保留题目和计量记录。 */
export function snapshotFromRunDir(runDirInput: string, options: SnapshotFromRunOptions = {}): BenchSnapshot {
  const runDir = resolve(runDirInput)
  const meta = readJsonObject(join(runDir, 'meta.json'), '运行元信息')
  const records = readJsonLines(join(runDir, 'records.jsonl'))
  const injected = readInjected(join(runDir, 'injected.json'))
  const answers = parseAnswers(readOptionalText(join(runDir, 'answers.md')))
  const questions = options.questions ?? loadQuestionsFromMeta(meta, options.root ?? process.cwd(), {
    runDir,
    answers,
    records,
  })
  const queryMap = new Map<string, SnapshotQuery>()

  for (const question of questions) {
    const answer = answers.get(question.id)
    const queryRecords = records.filter((record) => record.queryId === question.id)
    queryMap.set(question.id, {
      id: question.id,
      category: answer?.category ?? (question.category === 'unknown' ? queryRecords[0]?.category ?? 'unknown' : question.category),
      question: answer?.question || question.question,
      answer: answer?.answer ?? null,
      status: answer?.status ?? 'unknown',
      terminationReason: answer?.terminationReason ?? 'unknown',
      rounds: answer?.rounds ?? queryRecords.length,
      toolRounds: answer?.toolRounds ?? queryRecords.filter((record) => record.toolBatch).length,
      toolTrace: answer?.toolTrace ?? [],
      feedbackUsed: answer?.feedbackUsed ?? false,
      budgetUsed: answer?.budgetUsed ?? 0,
      budgetRemaining: answer?.budgetRemaining ?? 0,
      injectedIds: injected[question.id] ?? [],
    })
  }

  // 题集文件缺失时，answers.md 仍是历史运行保存的原始题目来源；失败题可能没有 CostRecord。
  for (const [queryId, answer] of answers) {
    if (queryMap.has(queryId)) continue
    const queryRecords = records.filter((record) => record.queryId === queryId)
    queryMap.set(queryId, {
      id: queryId,
      category: answer.category || queryRecords[0]?.category || 'unknown',
      question: answer.question,
      answer: answer.answer,
      status: answer.status,
      terminationReason: answer.terminationReason,
      rounds: answer.rounds || queryRecords.length,
      toolRounds: answer.toolRounds || queryRecords.filter((record) => record.toolBatch).length,
      toolTrace: answer.toolTrace,
      feedbackUsed: answer.feedbackUsed,
      budgetUsed: answer.budgetUsed,
      budgetRemaining: answer.budgetRemaining,
      injectedIds: injected[queryId] ?? [],
    })
  }

  // 老运行可能没有对应的题集文件；仍保留记录中的 queryId，避免静默丢失计量事实。
  for (const queryId of new Set(records.map((record) => record.queryId))) {
    if (queryMap.has(queryId)) continue
    const answer = answers.get(queryId)
    const first = records.find((record) => record.queryId === queryId)
    queryMap.set(queryId, {
      id: queryId,
      category: first?.category ?? answer?.category ?? 'unknown',
      question: answer?.question ?? '',
      answer: answer?.answer ?? null,
      status: answer?.status ?? 'unknown',
      terminationReason: answer?.terminationReason ?? 'unknown',
      rounds: answer?.rounds ?? records.filter((record) => record.queryId === queryId).length,
      toolRounds: answer?.toolRounds ?? records.filter((record) => record.queryId === queryId && record.toolBatch).length,
      toolTrace: answer?.toolTrace ?? [],
      feedbackUsed: answer?.feedbackUsed ?? false,
      budgetUsed: answer?.budgetUsed ?? 0,
      budgetRemaining: answer?.budgetRemaining ?? 0,
      injectedIds: injected[queryId] ?? [],
    })
  }

  return createSnapshot({
    runId: basename(runDir),
    topic: options.topic ?? (typeof meta.topic === 'string' ? meta.topic : 'rag-bench'),
    meta,
    queries: [...queryMap.values()],
    records,
  })
}

export function createSnapshot(input: Omit<BenchSnapshot, 'schemaVersion'>): BenchSnapshot {
  const snapshot: BenchSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    runId: input.runId,
    topic: input.topic,
    meta: sanitizeMeta(input.meta),
    queries: input.queries.map(normalizeQuery),
    records: input.records.map((record, index) => validateAndPickRecord(record, index)),
  }
  return validateSnapshot(snapshot)
}

/** 读取并校验快照；不信任外部 JSON 的字段和类型。 */
export function readSnapshot(path: string): BenchSnapshot {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`读取基准快照失败：${path}（${detail}）`)
  }
  return validateSnapshot(value)
}

/** 写入快照；相同内容幂等，内容冲突时拒绝覆盖。 */
export function writeSnapshot(path: string, snapshot: BenchSnapshot): string {
  const normalized = validateSnapshot(snapshot)
  const content = `${JSON.stringify(normalized, null, 2)}\n`
  if (existsSync(path)) {
    let existing: unknown
    try {
      existing = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      throw new Error(`快照目标已存在但不是有效 JSON，拒绝覆盖：${path}`)
    }
    if (canonicalJson(existing) !== canonicalJson(normalized)) {
      throw new Error(`快照目标内容冲突，拒绝覆盖：${path}`)
    }
    return resolve(path)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf-8')
  return resolve(path)
}

export function validateSnapshot(value: unknown): BenchSnapshot {
  if (!isRecord(value)) throw new Error('基准快照格式错误：顶层必须是对象')
  const keys = Object.keys(value).sort()
  if (keys.join('\0') !== [...TOP_LEVEL_KEYS].sort().join('\0')) {
    throw new Error('基准快照格式错误：顶层字段必须为 schemaVersion、runId、topic、meta、queries、records')
  }
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`不支持的基准快照 schemaVersion：${String(value.schemaVersion)}`)
  }
  if (!isNonEmptyString(value.runId) || !/^[A-Za-z0-9._-]+$/.test(value.runId)) {
    throw new Error('基准快照格式错误：runId 必须是非空安全标识')
  }
  if (!isNonEmptyString(value.topic)) throw new Error('基准快照格式错误：topic 必须是非空字符串')
  const meta = validateMeta(value.meta)
  if (!Array.isArray(value.queries)) throw new Error('基准快照格式错误：queries 必须是数组')
  if (!Array.isArray(value.records)) throw new Error('基准快照格式错误：records 必须是数组')

  const queries = value.queries.map((query, index) => validateQuery(query, index))
  const ids = new Set<string>()
  for (const query of queries) {
    if (ids.has(query.id)) throw new Error(`基准快照格式错误：queries 存在重复 id：${query.id}`)
    ids.add(query.id)
  }
  const records = value.records.map((record, index) => validateAndPickRecord(record, index))
  for (const record of records) {
    if (!ids.has(record.queryId)) throw new Error(`基准快照格式错误：records[${record.queryId}] 没有对应 queries 条目`)
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    runId: value.runId,
    topic: value.topic,
    meta,
    queries,
    records,
  }
}

function validateQuery(value: unknown, index: number): SnapshotQuery {
  if (!isRecord(value)) throw new Error(`基准快照格式错误：queries[${index}] 必须是对象`)
  const requiredString = (key: string): string => {
    if (!isNonEmptyString(value[key])) throw new Error(`基准快照格式错误：queries[${index}].${key} 必须是非空字符串`)
    return value[key]
  }
  const id = requiredString('id')
  const category = requiredString('category')
  const question = typeof value.question === 'string' ? redactText(value.question) : (() => { throw new Error(`基准快照格式错误：queries[${index}].question 必须是字符串`) })()
  const answer = value.answer === null ? null : typeof value.answer === 'string' ? redactText(value.answer) : (() => { throw new Error(`基准快照格式错误：queries[${index}].answer 必须是字符串或 null`) })()
  const status = value.status
  if (status !== 'completed' && status !== 'failed' && status !== 'cancelled' && status !== 'unknown') {
    throw new Error(`基准快照格式错误：queries[${index}].status 无效`)
  }
  if (status === 'completed' && (answer === null || answer.trim() === '')) throw new Error(`基准快照格式错误：queries[${index}] 已完成但缺少 answer`)
  const terminationReason = value.terminationReason
  if (typeof terminationReason !== 'string' || (terminationReason !== 'unknown' && !TERMINATION_REASONS.has(terminationReason as TerminationReason))) {
    throw new Error(`基准快照格式错误：queries[${index}].terminationReason 无效`)
  }
  return {
    id,
    category,
    question,
    answer,
    status,
    terminationReason: terminationReason as SnapshotQuery['terminationReason'],
    rounds: positiveOrZero(value.rounds, `queries[${index}].rounds`),
    toolRounds: positiveOrZero(value.toolRounds, `queries[${index}].toolRounds`),
    toolTrace: stringArray(value.toolTrace, `queries[${index}].toolTrace`),
    feedbackUsed: booleanValue(value.feedbackUsed, `queries[${index}].feedbackUsed`),
    budgetUsed: positiveOrZero(value.budgetUsed, `queries[${index}].budgetUsed`),
    budgetRemaining: positiveOrZero(value.budgetRemaining, `queries[${index}].budgetRemaining`),
    injectedIds: stringArray(value.injectedIds, `queries[${index}].injectedIds`),
  }
}

function normalizeQuery(query: SnapshotQuery): SnapshotQuery {
  return validateQuery({ ...query, question: redactText(query.question), answer: query.answer === null ? null : redactText(query.answer) }, 0)
}

function validateAndPickRecord(value: unknown, index: number): CostRecord {
  if (!isRecord(value)) throw new Error(`基准快照格式错误：records[${index}] 必须是对象`)
  if (value.httpAttempts !== undefined) validateHttpAttempts(value.httpAttempts, index)
  const record = pickRecord(value as CostRecord)
  if (!isNonEmptyString(record.queryId) || !isNonEmptyString(record.ts) || !isNonEmptyString(record.category) || !isNonEmptyString(record.thinking) || !isNonEmptyString(record.model)) {
    throw new Error(`基准快照格式错误：records[${index}] 缺少必要字段`)
  }
  if (!Number.isInteger(record.round) || record.round < 1) throw new Error(`基准快照格式错误：records[${index}].round 无效`)
  if (typeof record.truncated !== 'boolean') throw new Error(`基准快照格式错误：records[${index}].truncated 无效`)
  for (const key of ['input', 'output', 'knownInput', 'knownOutput', 'cached', 'reasoning', 'costIn', 'costOut', 'costTotal']) {
    const number = (record as unknown as Record<string, unknown>)[key]
    if (number !== null && number !== undefined && (typeof number !== 'number' || !Number.isFinite(number))) {
      throw new Error(`基准快照格式错误：records[${index}].${key} 无效`)
    }
  }
  if (record.toolBatch !== undefined) validateToolBatch(record.toolBatch, index)
  return record
}

function validateHttpAttempts(value: unknown, index: number): void {
  if (!Array.isArray(value)) throw new Error(`基准快照格式错误：records[${index}].httpAttempts 必须是数组`)
  for (const [attemptIndex, attempt] of value.entries()) {
    if (!isRecord(attempt)
      || !Number.isInteger(attempt.attempt)
      || (attempt.attempt as number) < 1
      || (attempt.status !== null && (!Number.isInteger(attempt.status) || (attempt.status as number) < 0))
      || typeof attempt.outcome !== 'string'
      || !HTTP_OUTCOMES.has(attempt.outcome as HttpAttempt['outcome'])
      || !Object.prototype.hasOwnProperty.call(attempt, 'usage')) {
      throw new Error(`基准快照格式错误：records[${index}].httpAttempts[${attemptIndex}] 无效`)
    }
    validateUsage(attempt.usage, index, attemptIndex)
  }
}

function validateToolBatch(value: unknown, index: number): void {
  if (!isRecord(value)) throw new Error(`基准快照格式错误：records[${index}].toolBatch 必须是对象`)
  for (const key of TOOL_BATCH_KEYS) {
    if (OPTIONAL_TOOL_BATCH_KEYS.has(key) && !Object.prototype.hasOwnProperty.call(value, key)) continue
    if (!Object.prototype.hasOwnProperty.call(value, key)
      || !Number.isInteger(value[key])
      || (value[key] as number) < 0) {
      throw new Error(`基准快照格式错误：records[${index}].toolBatch.${key} 无效`)
    }
  }
}

function validateUsage(value: unknown, recordIndex: number, attemptIndex: number): void {
  if (!isRecord(value)) throw new Error(`基准快照格式错误：records[${recordIndex}].httpAttempts[${attemptIndex}].usage 必须是对象`)
  for (const key of ['input', 'output', 'cached', 'reasoning', 'knownInput', 'knownOutput']) {
    if (value[key] !== undefined && value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
      throw new Error(`基准快照格式错误：records[${recordIndex}].httpAttempts[${attemptIndex}].usage.${key} 无效`)
    }
  }
  if (value.completeness !== undefined && value.completeness !== 'complete' && value.completeness !== 'partial' && value.completeness !== 'unknown') {
    throw new Error(`基准快照格式错误：records[${recordIndex}].httpAttempts[${attemptIndex}].usage.completeness 无效`)
  }
}

/** 只提取 CostRecord 白名单；HTTP 错误正文等诊断文本不进入快照。 */
function pickRecord(record: CostRecord): CostRecord {
  const out: Record<string, unknown> = {}
  for (const key of RECORD_KEYS) {
    const value = (record as unknown as Record<string, unknown>)[key]
    if (value === undefined) continue
    if (key === 'httpAttempts' && Array.isArray(value)) {
      out[key] = value.map((attempt) => pickAttempt(attempt as HttpAttempt))
    } else if (key === 'tools' && Array.isArray(value)) {
      out[key] = value.filter((item): item is string => typeof item === 'string')
    } else if (key === 'toolBatch' && isRecord(value)) {
      out[key] = Object.fromEntries(TOOL_BATCH_KEYS
        .filter((field) => value[field] !== undefined)
        .map((field) => [field, value[field]]))
    } else {
      out[key] = value
    }
  }
  // 兼容最早没有截断标记的历史 JSONL；缺省不改变既有聚合含义。
  if (out.truncated === undefined) out.truncated = false
  return out as unknown as CostRecord
}

function pickAttempt(attempt: HttpAttempt): HttpAttempt {
  const usage = normalizeUsage(attempt.usage)
  return {
    attempt: attempt.attempt,
    status: attempt.status,
    outcome: attempt.outcome,
    usage,
  }
}

function normalizeUsage(usage: LlmUsage | undefined): LlmUsage {
  return {
    input: usage?.input ?? null,
    output: usage?.output ?? null,
    cached: usage?.cached ?? null,
    reasoning: usage?.reasoning ?? null,
    ...(usage?.knownInput !== undefined ? { knownInput: usage.knownInput } : {}),
    ...(usage?.knownOutput !== undefined ? { knownOutput: usage.knownOutput } : {}),
    ...(usage?.completeness !== undefined ? { completeness: usage.completeness } : {}),
  }
}

function readJsonObject(path: string, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (!isRecord(value)) throw new Error('顶层不是对象')
    return value
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`读取${label}失败：${path}（${detail}）`)
  }
}

function readJsonLines(path: string): CostRecord[] {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf-8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/).map((line, index) => {
    try {
      return validateAndPickRecord(JSON.parse(line), index)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`读取 records.jsonl 第 ${index + 1} 行失败：${detail}`)
    }
  })
}

function readInjected(path: string): Record<string, string[]> {
  if (!existsSync(path)) return {}
  const value = readJsonObject(path, '注入记录')
  const result: Record<string, string[]> = {}
  for (const [id, ids] of Object.entries(value)) {
    if (Array.isArray(ids)) result[id] = ids.filter((item): item is string => typeof item === 'string')
  }
  return result
}

function loadQuestionsFromMeta(meta: Record<string, unknown>, root: string, context: QuestionRecoveryContext): RecoveredQuestion[] {
  const embedded = readEmbeddedQuestions(meta)
  const declaredIds = readStringArray(meta.questionIds)
  const answerIds = [...context.answers.keys()]
  const recordIds = unique(context.records.map((record) => record.queryId))
  const historicalIds = unique([
    ...declaredIds,
    ...embedded.map((question) => question.id),
    ...answerIds,
    ...recordIds,
  ])
  if (embedded.length > 0) {
    return withMissingHistoricalIds(selectQuestions(meta, embedded), historicalIds)
  }

  const rootAbs = resolve(root)
  const configuredPath = typeof meta.questionsPath === 'string' ? meta.questionsPath : null
  const candidate = configuredPath ? resolve(rootAbs, configuredPath) : join(rootAbs, 'bench', 'questions.json')
  if (!configuredPath) return historicalPlaceholders(historicalIds)
  const candidateRel = relative(rootAbs, candidate)
  if (!candidateRel || candidateRel.startsWith('..') || isAbsolute(candidateRel)) return historicalPlaceholders(historicalIds)
  if (!existsSync(candidate)) return historicalPlaceholders(historicalIds)
  try {
    const value: unknown = JSON.parse(readFileSync(candidate, 'utf-8'))
    if (!Array.isArray(value)) return historicalPlaceholders(historicalIds)
    const questions = value.filter((item): item is BenchQuery => isRecord(item) && typeof item.id === 'string' && typeof item.category === 'string' && typeof item.question === 'string')
    // 运行目录内的题集副本是可确认的历史来源；仓库题集即使路径存在，也只能保留已确认历史题号。
    if (isPathInside(context.runDir, candidate)) return withMissingHistoricalIds(selectQuestions(meta, questions, true), historicalIds)
    return historicalPlaceholders(historicalIds)
  } catch {
    return historicalPlaceholders(historicalIds)
  }
}

function readEmbeddedQuestions(meta: Record<string, unknown>): BenchQuery[] {
  if (!Array.isArray(meta.questionDefinitions)) return []
  return meta.questionDefinitions.filter((item): item is BenchQuery => isRecord(item)
    && typeof item.id === 'string'
    && (item.category === 'fact' || item.category === 'system' || item.category === 'gadget')
    && typeof item.question === 'string')
}

function selectQuestions(meta: Record<string, unknown>, questions: BenchQuery[], limitByCount = false): BenchQuery[] {
  if (Array.isArray(meta.questionIds)) {
    const byId = new Map(questions.map((question) => [question.id, question]))
    return meta.questionIds.filter((id): id is string => typeof id === 'string').map((id) => byId.get(id)).filter((question): question is BenchQuery => question !== undefined)
  }
  return limitByCount && typeof meta.questions === 'number' ? questions.slice(0, meta.questions) : questions
}

function withMissingHistoricalIds(questions: RecoveredQuestion[], historicalIds: string[]): RecoveredQuestion[] {
  const present = new Set(questions.map((question) => question.id))
  return [...questions, ...historicalPlaceholders(historicalIds.filter((id) => !present.has(id)))]
}

function historicalPlaceholders(ids: string[]): RecoveredQuestion[] {
  return ids.map((id) => ({ id, category: 'unknown', question: '' }))
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child)).replace(/\\/g, '/')
  return rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
}

interface ParsedAnswer {
  category: string
  question: string
  answer: string | null
  status: SnapshotQueryStatus
  terminationReason: SnapshotQuery['terminationReason']
  rounds: number
  toolRounds: number
  toolTrace: string[]
  feedbackUsed: boolean
  budgetUsed: number
  budgetRemaining: number
}

function parseAnswers(raw: string | null): Map<string, ParsedAnswer> {
  const out = new Map<string, ParsedAnswer>()
  if (!raw) return out
  const lines = raw.split(/\r?\n/)
  const headers: Array<{ id: string; category: string; line: number }> = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^## (.+?)（(.+?)）$/.exec(lines[i])
    if (match) headers.push({ id: match[1], category: match[2], line: i })
  }
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]
    const end = headers[i + 1]?.line ?? lines.length
    const block = lines.slice(header.line + 1, end)
    const question = block.find((line) => line.startsWith('- 问题：'))?.slice('- 问题：'.length) ?? ''
    const statusLine = block.find((line) => line.startsWith('- 状态：')) ?? ''
    const statusMatch = /^- 状态：([^｜]+)｜终止：([^\s]+)$/.exec(statusLine)
    const budgetLine = block.find((line) => line.startsWith('- 模型步骤：')) ?? ''
    const budgetMatch = /^- 模型步骤：(\d+)｜工具批次：(\d+)｜预算：(\d+)\/(\d+)(?:｜工具序列：(.+))?$/.exec(budgetLine)
    const feedbackLine = block.find((line) => line.startsWith('- 宿主回馈：'))
    const feedbackIndex = block.findIndex((line) => line.startsWith('- 宿主回馈：'))
    const budgetIndex = block.findIndex((line) => line.startsWith('- 模型步骤：'))
    const legacyLine = block.find((line) => /^- 轮数：\d+｜检索次数：\d+(?:｜工具序列：.+)?$/.test(line)) ?? ''
    const legacyMatch = /^- 轮数：(\d+)｜检索次数：(\d+)(?:｜工具序列：(.+))?$/.exec(legacyLine)
    const legacyIndex = legacyLine ? block.indexOf(legacyLine) : -1
    const answerStart = findAnswerStart(block, feedbackIndex, budgetIndex, legacyIndex)
    const body = block.slice(answerStart).join('\n').trim()
    const legacyFailure = /^（查询(?:失败|未完成)：/.test(body)
    const status = statusMatch?.[1] ?? (legacyMatch && body ? (legacyFailure ? 'failed' : 'completed') : undefined)
    out.set(header.id, {
      category: header.category,
      question: redactText(question),
      answer: status === 'completed' ? redactText(body) : null,
      status: status === 'completed' || status === 'failed' || status === 'cancelled' ? status : 'unknown',
      terminationReason: parseTermination(statusMatch?.[2] ?? (legacyFailure ? 'llm_error' : undefined)),
      rounds: Number(budgetMatch?.[1] ?? legacyMatch?.[1] ?? 0),
      toolRounds: Number(budgetMatch?.[2] ?? legacyMatch?.[2] ?? 0),
      budgetUsed: Number(budgetMatch?.[3] ?? 0),
      budgetRemaining: Number(budgetMatch?.[4] ?? 0) - Number(budgetMatch?.[3] ?? 0),
      toolTrace: budgetMatch?.[5] && budgetMatch[5] !== '无'
        ? budgetMatch[5].split('→').filter(Boolean)
        : legacyMatch?.[3] && legacyMatch[3] !== '无' ? legacyMatch[3].split('→').filter(Boolean) : [],
      feedbackUsed: feedbackLine?.includes('是') ?? false,
    })
  }
  return out
}

function findAnswerStart(block: string[], feedbackIndex: number, budgetIndex: number, legacyIndex: number): number {
  const metadataIndex = feedbackIndex >= 0 ? feedbackIndex : budgetIndex >= 0 ? budgetIndex : legacyIndex
  let answerStart = metadataIndex >= 0 ? metadataIndex + 1 : 0
  while (answerStart < block.length && block[answerStart].trim() === '') answerStart++
  return answerStart
}

function parseTermination(value: string | undefined): SnapshotQuery['terminationReason'] {
  return value && TERMINATION_REASONS.has(value as TerminationReason) ? value as TerminationReason : 'unknown'
}

function readOptionalText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

function validateMeta(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('基准快照格式错误：meta 必须是对象')
  for (const [key, item] of Object.entries(value)) {
    if (!META_ALLOWED_KEYS.has(key) || META_SUMMARY_KEYS.has(key)) {
      throw new Error(`基准快照格式错误：meta.${key} 不在允许字段白名单中`)
    }
    validateMetaFieldContract(key, item)
  }
  return sanitizeMeta(value)
}

function validateMetaFieldContract(key: string, value: unknown): void {
  if (key === 'questionDefinitions') {
    if (!Array.isArray(value)) throw new Error('基准快照格式错误：meta.questionDefinitions 必须是数组')
    for (const [index, item] of value.entries()) {
      if (!isRecord(item) || Object.keys(item).sort().join('\0') !== ['category', 'id', 'question'].join('\0')
        || !isNonEmptyString(item.id)
        || !isNonEmptyString(item.question)
        || (item.category !== 'fact' && item.category !== 'system' && item.category !== 'gadget')) {
        throw new Error(`基准快照格式错误：meta.questionDefinitions[${index}] 结构无效`)
      }
    }
    return
  }
  if (key === 'questionIds') {
    if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
      throw new Error('基准快照格式错误：meta.questionIds 必须是非空字符串数组')
    }
    return
  }
  if (key === 'toolNames') {
    if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
      throw new Error('基准快照格式错误：meta.toolNames 必须是非空字符串数组')
    }
    return
  }
  if (key === 'prices') {
    if (!isRecord(value)) throw new Error('基准快照格式错误：meta.prices 必须是对象')
    for (const field of Object.keys(value)) {
      if (field !== 'inPerM' && field !== 'outPerM' && field !== 'cachePerM') {
        throw new Error(`基准快照格式错误：meta.prices.${field} 不在允许字段中`)
      }
      if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
        throw new Error(`基准快照格式错误：meta.prices.${field} 必须是有限数字`)
      }
    }
    return
  }
  if (key === 'source') {
    if (!isRecord(value)) throw new Error('基准快照格式错误：meta.source 必须是对象')
    const allowed = new Set(['nodeVersion', 'packageVersion', 'gitHead', 'gitDirty', 'metadataCapturedAt'])
    for (const [field, item] of Object.entries(value)) {
      if (!allowed.has(field)) throw new Error(`基准快照格式错误：meta.source.${field} 不在允许字段中`)
      const valid = field === 'gitDirty'
        ? typeof item === 'boolean' || item === null
        : typeof item === 'string' || item === null
      if (!valid) throw new Error(`基准快照格式错误：meta.source.${field} 类型无效`)
    }
    return
  }
  if (key === 'corpusDir' || key === 'questionsPath') {
    if (normalizeRepoRelativePath(value) === undefined) {
      throw new Error(`基准快照格式错误：meta.${key} 必须是仓库相对路径`)
    }
    return
  }
  if (value !== null
    && typeof value !== 'string'
    && typeof value !== 'boolean'
    && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`基准快照格式错误：meta.${key} 类型无效`)
  }
}

/** 快照只保留明确契约内的运行来源与配置；总 token/费用等汇总统一由 records 重新计算。 */
function sanitizeMeta(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!META_ALLOWED_KEYS.has(key) || META_SUMMARY_KEYS.has(key)) continue
    const sanitized = sanitizeMetaField(key, item)
    if (sanitized !== undefined) out[key] = sanitized
  }
  return out
}

function sanitizeMetaField(key: string, value: unknown): unknown {
  if (key === 'questionDefinitions') {
    if (!Array.isArray(value)) return undefined
    return value
      .filter((item): item is Record<string, unknown> => isRecord(item)
        && typeof item.id === 'string'
        && typeof item.category === 'string'
        && typeof item.question === 'string')
      .map((item) => ({
        id: redactText(item.id as string),
        category: redactText(item.category as string),
        question: redactText(item.question as string),
      }))
  }
  if (key === 'questionIds') {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value.map((item) => redactText(item as string))
      : undefined
  }
  if (key === 'toolNames') {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value.map((item) => redactText(item as string))
      : undefined
  }
  if (key === 'prices') {
    return sanitizeNumericObject(value, ['inPerM', 'outPerM', 'cachePerM'])
  }
  if (key === 'source') {
    if (!isRecord(value)) return undefined
    return sanitizeObjectWithKeys(value, ['nodeVersion', 'packageVersion', 'gitHead', 'gitDirty', 'metadataCapturedAt'])
  }
  if (key === 'corpusDir' || key === 'questionsPath') return normalizeRepoRelativePath(value)
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean' || value === null) return value
  return undefined
}

function sanitizeNumericObject(value: unknown, keys: string[]): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, number> = {}
  for (const key of keys) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) out[key] = value[key]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeObjectWithKeys(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const item = value[key]
    if (typeof item === 'string') out[key] = redactText(item)
    else if (typeof item === 'boolean' || item === null) out[key] = item
  }
  return out
}

function normalizeRepoRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return undefined
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '')) return undefined
  return redactText(parts.join('/'))
}

const SENSITIVE_PATTERNS = [
  /((?:api[_-]?key|authorization|secret|password|token)\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi,
  /\b(?:sk|dashscope|tokenhub)-[A-Za-z0-9_-]{4,}\b/gi,
]

function redactText(value: string): string {
  return SENSITIVE_PATTERNS.reduce((text, pattern) => text.replace(pattern, '$1[已脱敏]'), value)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function positiveOrZero(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`基准快照格式错误：${label} 必须是非负整数`)
  return value as number
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`基准快照格式错误：${label} 必须是布尔值`)
  return value
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`基准快照格式错误：${label} 必须是字符串数组`)
  return value.map((item) => redactText(item as string))
}
