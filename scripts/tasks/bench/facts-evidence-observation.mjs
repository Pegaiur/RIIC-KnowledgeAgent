#!/usr/bin/env node
/**
 * bench/facts-evidence-observation — 正式名命中对象的事实卡送达统计（只读离线）
 *
 * 用法：
 *   node scripts/tooling.mjs run bench/facts-evidence-observation -- --run <运行目录或 run-id> [--root <仓库根>] [--roster <名册路径>] [--json]
 *
 * 口径：
 *   - 分母仅取问题原文中出现的名册正式名，字面包含匹配并按规范对象去重；不做别名扩展、分词、模糊匹配或技能名识别。
 *   - 显式 facts 送达取 trace 中 facts_search 成功结果实际返回的 hitIds（canonical）；RAG 附带送达取 records.ragDelivery 的
 *     attachedFacts.delivered；matched、paths、触发词都不算送达。
 *   - 数据完整且无送达才判为未送达；缺 trace、结果记录、问题原文或名册不可用，或成功 facts 事件缺 hitIds 时标不可判定，不填零。
 *   - 名册版本对应：仅当运行记录与当前 HEAD 一致、运行当时非脏树且当前名册文件在工作区无未提交修改，或调用方用 --assume-roster-matches/显式 --roster 确认时，才用当前名册解释该运行；否则标不可判定，不拿当前名册无条件解释旧运行。
 *   - 无正式名命中的题记不适用，不计为合规。本输出只统计字面命中与事实卡送达，不代表真实意图识别，也不判断卡片是否足以支撑结论。
 * 只读边界：仅读取运行目录与名册，结果只输出终端表格，不写任何持久化字段。
 * TODO(tech-debt) R5-10：本脚本按运行目录文件契约只读取数，与 bench/src（snapshot.ts/cli.ts/benchmark-integrity.ts）
 * 的 JSONL、题集与名册解析存在同构样板，且 RAG 台账不可用判定口径与 report.ts 已有意分叉；因 scripts 不 import
 * bench/src（分层与构建约定）暂不共享。重启条件：出现可共享的纯协议包方案，或运行目录文件契约变更需两侧同步时再评估。
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { resolveRepoRoot } from '../../lib/repo-context.mjs'
import { head as gitHead, diffFiles } from '../../lib/git.mjs'

export const STATS_NAME = '正式名命中对象的事实卡送达统计'
export const LITERAL_MATCH_NOTE = '命中为问题原文对名册正式名的字面包含匹配（字面命中），不代表真实意图识别，也不判断卡片是否足以支撑结论。'

/** 解析名册正式名；正式名为表格行首个「|」前的字段，保持文件顺序。 */
export function loadRosterFormalNames(rosterPath) {
  const raw = readFileSync(rosterPath, 'utf-8')
  const names = []
  for (const line of raw.split(/\r?\n/)) {
    const match = /^-\s+(.+?)\s*\|/.exec(line)
    if (match) names.push(match[1].trim())
  }
  return names
}

function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function readJsonLines(path) {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf-8').trim()
  if (!raw) return []
  const out = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // 单行损坏按缺失观测处理，不伪造成零送达。
    }
  }
  return out
}

function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) return null
  return value
    .filter((q) => q && typeof q.id === 'string' && typeof q.question === 'string')
    .map((q) => ({ id: q.id, category: typeof q.category === 'string' ? q.category : 'unknown', question: q.question }))
}

/** 问题原文优先取 meta 内嵌定义，其次运行目录题集副本，最后按仓库内 questionsPath 读取。 */
export function loadQuestions(meta, runDir, root) {
  if (meta && Array.isArray(meta.questionDefinitions)) {
    const embedded = normalizeQuestions(meta.questionDefinitions)
    if (embedded && embedded.length > 0) return embedded
  }
  const local = join(runDir, 'questions.json')
  if (existsSync(local)) {
    const parsed = normalizeQuestions(readJson(local))
    if (parsed) return parsed
  }
  const declared = typeof meta?.questionsPath === 'string' ? meta.questionsPath : null
  if (declared) {
    const absolute = resolve(root, declared)
    if (root && isInside(root, absolute) && existsSync(absolute)) {
      const parsed = normalizeQuestions(readJson(absolute))
      if (parsed) return parsed
    }
  }
  return null
}

function collectDelivery(records, traces) {
  const recordsByQuery = new Set()
  // RAG 附带维度按题聚合：台账缺失或 attachedFacts 不可用时标 available=false，不当作零送达。
  // 与 report.ts 的口径差异：report 以「请求过 rag_search 却缺整套 ragDelivery」判整轮不可用（已与 agent.ts 排除 protocol_rejected 的口径同步），
  // 本脚本改按 ADR-013 语义只据「有工具批次却缺 ragDelivery」与 attachedFacts 是否可读判定，
  // 以保留 protocol_rejected 场景下已执行调用真实 delivered 的可观测性；两者不可用口径可能不同。
  const ragByQuery = new Map()
  for (const record of records) {
    const id = record?.queryId
    if (typeof id !== 'string') continue
    recordsByQuery.add(id)
    const entry = ragByQuery.get(id) ?? { available: true, delivered: new Set() }
    // 无工具批次的步骤本就没有 RAG 台账；有工具批次却缺 ragDelivery 才表示台账不可用。
    if (record.toolBatch !== undefined && !Array.isArray(record.ragDelivery)) entry.available = false
    for (const call of Array.isArray(record.ragDelivery) ? record.ragDelivery : []) {
      if (call?.attachedFacts === undefined) {
        entry.available = false
        continue
      }
      for (const fact of Array.isArray(call.attachedFacts) ? call.attachedFacts : []) {
        for (const canonical of Array.isArray(fact?.delivered) ? fact.delivered : []) {
          if (typeof canonical === 'string' && canonical) entry.delivered.add(canonical)
        }
      }
    }
    ragByQuery.set(id, entry)
  }

  const traceByQuery = new Map()
  for (const line of traces) {
    const id = line?.queryId
    if (typeof id !== 'string') continue
    // missingHitIds：成功 facts 事件缺少 hitIds 数组，送达观测不完整，须与「已知空结果」区分。
    const entry = traceByQuery.get(id) ?? { delivered: new Set(), missingHitIds: false }
    for (const event of Array.isArray(line.events) ? line.events : []) {
      if (event?.type !== 'tool_call' || event.tool !== 'facts_search') continue
      if (event.status !== 'success') continue
      if (!Array.isArray(event.hitIds)) {
        entry.missingHitIds = true
        continue
      }
      for (const canonical of event.hitIds) {
        if (typeof canonical === 'string' && canonical) entry.delivered.add(canonical)
      }
    }
    traceByQuery.set(id, entry)
  }
  return { recordsByQuery, ragByQuery, traceByQuery }
}

function orderedQuestionIds(meta, questions, records, traces) {
  const ids = []
  const seen = new Set()
  const push = (id) => {
    if (typeof id === 'string' && id !== '' && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  if (Array.isArray(meta?.questionIds)) meta.questionIds.forEach(push)
  if (questions) questions.forEach((q) => push(q.id))
  records.forEach((r) => push(r?.queryId))
  traces.forEach((t) => push(t?.queryId))
  return ids
}

const emptyRow = (base, verdict, reason) => ({
  ...base,
  verdict,
  reason,
  hitObjects: [],
  explicitDelivered: [],
  ragDelivered: [],
  deliveredUnion: [],
  undelivered: [],
})

/**
 * 核心逻辑（可注入 root、名册路径，便于隔离测试）：统计正式名命中对象的事实卡送达。
 * @param {{ runDir: string, rosterPath: string, root?: string, currentHead?: string, rosterConfirmed?: boolean, rosterDirty?: boolean }} options
 *   rosterDirty：当前名册文件相对 HEAD 是否有未提交修改；false 表示确认干净，true 表示已修改，缺省表示无法确认。
 */
export function observeFactsEvidence({ runDir, rosterPath, root, currentHead, rosterConfirmed = false, rosterDirty }) {
  const resolvedRunDir = resolve(runDir)
  let formalNames = []
  let rosterError = null
  try {
    formalNames = loadRosterFormalNames(rosterPath)
    if (formalNames.length === 0) rosterError = '未解析到正式名'
  } catch (error) {
    rosterError = error instanceof Error ? error.message : String(error)
  }

  const meta = readJson(join(resolvedRunDir, 'meta.json'))
  // 名册版本对应：显式确认，或运行记录与当前 HEAD 一致且非脏树，才用当前名册解释该运行。
  const source = meta && typeof meta.source === 'object' && meta.source !== null ? meta.source : null
  const runningHead = typeof source?.gitHead === 'string' ? source.gitHead : null
  const rosterMatches = Boolean(rosterConfirmed)
    || Boolean(currentHead && runningHead && runningHead === currentHead && source?.gitDirty !== true && rosterDirty === false)
  const records = readJsonLines(join(resolvedRunDir, 'records.jsonl'))
  const traces = readJsonLines(join(resolvedRunDir, 'trace.jsonl'))
  const traceFileExists = existsSync(join(resolvedRunDir, 'trace.jsonl'))
  const { recordsByQuery, ragByQuery, traceByQuery } = collectDelivery(records, traces)
  const questions = loadQuestions(meta, resolvedRunDir, root ?? process.cwd())
  const questionById = new Map((questions ?? []).map((q) => [q.id, q]))
  const ids = orderedQuestionIds(meta, questions, records, traces)

  const rows = ids.map((id) => {
    const question = questionById.get(id)?.question ?? null
    const base = { id, category: questionById.get(id)?.category ?? 'unknown', question }
    if (rosterError) return emptyRow(base, 'undecidable', `名册不可用：${rosterError}`)
    if (question === null || question.trim() === '') return emptyRow(base, 'undecidable', '缺少问题原文')
    const hitObjects = formalNames.filter((name) => question.includes(name))
    if (!rosterMatches) {
      return {
        ...emptyRow(base, 'undecidable', '无法确认名册与运行版本对应，未用当前名册无条件解释；如需按当前名册解释请用 --assume-roster-matches'),
        hitObjects,
      }
    }
    if (hitObjects.length === 0) return emptyRow(base, 'not_applicable', null)
    if (!recordsByQuery.has(id)) {
      return { ...emptyRow(base, 'undecidable', '缺少结果记录，无法确认是否送达'), hitObjects }
    }
    if (!traceFileExists || !traceByQuery.has(id)) {
      return { ...emptyRow(base, 'undecidable', '缺少 trace，无法确认显式 facts 是否送达'), hitObjects }
    }
    const traceEntry = traceByQuery.get(id)
    if (traceEntry.missingHitIds) {
      return { ...emptyRow(base, 'undecidable', '成功 facts 事件缺少 hitIds，无法确认显式 facts 是否送达'), hitObjects }
    }
    const explicitSet = traceEntry.delivered
    const explicitDelivered = hitObjects.filter((name) => explicitSet.has(name))
    // 仅当仍有未被显式 facts 覆盖的对象时，RAG 附带台账才是判定送达所必需的数据。
    const pending = hitObjects.filter((name) => !explicitSet.has(name))
    const ragEntry = ragByQuery.get(id) ?? { available: true, delivered: new Set() }
    if (pending.length > 0 && !ragEntry.available) {
      return {
        ...base,
        verdict: 'undecidable',
        reason: 'RAG 附带台账不可用，无法确认未由显式 facts 覆盖的对象是否送达',
        hitObjects,
        explicitDelivered,
        ragDelivered: [],
        deliveredUnion: explicitDelivered,
        undelivered: [],
      }
    }
    const ragDeliveredObjects = hitObjects.filter((name) => ragEntry.delivered.has(name))
    const deliveredSet = new Set([...explicitDelivered, ...ragDeliveredObjects])
    return {
      ...base,
      verdict: 'applicable',
      reason: null,
      hitObjects,
      explicitDelivered,
      ragDelivered: ragDeliveredObjects,
      deliveredUnion: hitObjects.filter((name) => deliveredSet.has(name)),
      undelivered: hitObjects.filter((name) => !deliveredSet.has(name)),
    }
  })

  const applicable = rows.filter((row) => row.verdict === 'applicable')
  const sum = (values) => values.reduce((total, value) => total + value, 0)
  return {
    statsName: STATS_NAME,
    runId: basename(resolvedRunDir),
    rosterPath: resolve(rosterPath),
    rosterCount: formalNames.length,
    literalMatchNote: LITERAL_MATCH_NOTE,
    questions: rows,
    // 汇总只计适用题，不适用与不可判定都不计入分母。
    totals: {
      questions: rows.length,
      applicable: applicable.length,
      notApplicable: rows.filter((row) => row.verdict === 'not_applicable').length,
      undecidable: rows.filter((row) => row.verdict === 'undecidable').length,
      objects: sum(applicable.map((row) => row.hitObjects.length)),
      delivered: sum(applicable.map((row) => row.deliveredUnion.length)),
      undelivered: sum(applicable.map((row) => row.undelivered.length)),
    },
  }
}

const listNames = (values) => (values.length > 0 ? values.join('、') : '—')
const verdictLabel = (verdict) => (verdict === 'applicable' ? '适用' : verdict === 'not_applicable' ? '不适用' : '不可判定')

/** 渲染终端表格；只输出文本，不落盘。 */
export function renderObservation(result) {
  const lines = [
    result.statsName,
    '',
    `运行：${result.runId}｜名册正式名：${result.rosterCount} 个｜题数：${result.totals.questions}`,
    `口径：${result.literalMatchNote}`,
    '',
    '| 题目 | 判定 | 命中对象 | 显式 facts 送达 | RAG 附带送达 | 已送达并集 | 尚未送达 | 说明 |',
    '|------|------|----------|------------------|--------------|------------|----------|------|',
  ]
  for (const row of result.questions) {
    lines.push(`| ${row.id} | ${verdictLabel(row.verdict)} | ${listNames(row.hitObjects)} | ${listNames(row.explicitDelivered)} | ${listNames(row.ragDelivered)} | ${listNames(row.deliveredUnion)} | ${listNames(row.undelivered)} | ${row.reason ?? ''} |`)
  }
  const t = result.totals
  lines.push('')
  lines.push(`汇总：适用 ${t.applicable} 题｜不适用 ${t.notApplicable} 题｜不可判定 ${t.undecidable} 题；命中对象 ${t.objects} 个，已送达 ${t.delivered} 个，尚未送达 ${t.undelivered} 个。`)
  return lines.join('\n')
}

function resolveRunDir(input, root) {
  if (isAbsolute(input)) return resolve(input)
  const direct = resolve(root, input)
  if (existsSync(direct)) return direct
  return resolve(root, 'bench-runs', input)
}

async function main() {
  const root = resolveRepoRoot(import.meta.url)
  let values
  try {
    ;({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        run: { type: 'string' },
        root: { type: 'string' },
        roster: { type: 'string' },
        'assume-roster-matches': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: false,
      strict: true,
    }))
  } catch (error) {
    console.error(`用法错误：${error.message}`)
    process.exit(2)
  }

  if (values.help) {
    console.log(`bench/facts-evidence-observation — 正式名命中对象的事实卡送达统计（只读离线）

用法：
  node scripts/tooling.mjs run bench/facts-evidence-observation -- --run <运行目录或 run-id> [--root <仓库根>] [--roster <名册路径>] [--json]

选项：
  --run <path|id>   运行目录（绝对/相对仓库根）或 bench-runs 下的 run-id，必填
  --root <path>     仓库根（默认自动定位）
  --roster <path>   名册真源路径（默认 <仓库根>/knowledge/raw/名册.md；显式指定即视为确认与该运行对应）
  --assume-roster-matches  允许用当前名册解释运行记录，即使无法确认与运行版本对应（默认仅在运行 HEAD 与当前一致、运行当时非脏树且当前名册无未提交修改时自动采用）
  --json            以 JSON 输出完整结果
  --help            显示本帮助

退出码：0 成功 / 1 一般错误 / 2 参数错误`)
    process.exit(0)
  }

  if (!values.run) {
    console.error('用法错误：--run 必填')
    process.exit(2)
  }
  const repoRoot = values.root ? resolve(values.root) : root
  const runDir = resolveRunDir(values.run, repoRoot)
  if (!existsSync(runDir)) {
    console.error(`错误：运行目录不存在：${runDir}`)
    process.exit(1)
  }
  const rosterPath = values.roster ? resolve(values.roster) : join(repoRoot, 'knowledge', 'raw', '名册.md')
  if (!existsSync(rosterPath)) {
    console.error(`错误：名册文件不存在：${rosterPath}`)
    process.exit(1)
  }

  // 运行记录与当前 HEAD 一致、运行当时非脏树且当前名册无未提交修改时默认采用当前名册；否则需显式确认。
  let currentHead
  try {
    currentHead = await gitHead(repoRoot)
  } catch {
    currentHead = undefined
  }

  // 当前名册文件在工作区是否有未提交修改：false 确认干净，true 已修改，undefined 无法确认（git 不可用）。
  let rosterDirty
  try {
    const changed = await diffFiles(repoRoot, { untracked: true })
    const relRoster = relative(repoRoot, rosterPath).split(/[\\/]/).join('/')
    rosterDirty = changed.includes(relRoster)
  } catch {
    rosterDirty = undefined
  }

  try {
    const result = observeFactsEvidence({
      runDir,
      rosterPath,
      root: repoRoot,
      currentHead,
      rosterDirty,
      rosterConfirmed: Boolean(values['assume-roster-matches']) || values.roster !== undefined,
    })
    console.log(values.json ? JSON.stringify(result, null, 2) : renderObservation(result))
  } catch (error) {
    console.error(`错误：${error.message ?? String(error)}`)
    process.exit(1)
  }
}

// isMain 守卫：直调时执行 CLI；被 import（vitest）时仅暴露纯函数，无副作用。
const isMain =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()
if (isMain) {
  main()
}
