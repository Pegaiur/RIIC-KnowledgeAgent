/**
 * 散文小节关联事实的旁挂元数据：读取、定位解析、作用域合并与机械检查（ADR-022 决策 4、5）。
 *
 * 人工标注保存在 knowledge 下的 prose-links.json，格式版本 2：按「文件 + 标题路径（+ 出现序号）」
 * 定位小节，scope 必填，对象可以是干员、精确技能或概念条目引用；本模块把它解析为当前
 * operator/skill/grant/概念位置，并收集定位与引用问题。
 * 不参与检索分词、切块与排序，也不在模块顶层读写文件或执行副作用。
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { OperatorDefinition, OperatorSkillGrant, SkillFact } from './facts/normalized.js'
import { loadReferenceFacts, type ReferenceFacts } from './facts/references.js'
import { buildSectionDirectory, type SectionDirectory, type SectionEntry } from './sections.js'

export const PROSE_LINKS_VERSION = 2 as const
export const PROSE_LINKS_FILE_NAME = 'prose-links.json'

/** 关联适用范围：section 只作用于登记节点，subtree 作用于登记节点及其后代。 */
export type ProseScope = 'section' | 'subtree'

/** 可读对象引用：干员、技能（设施 + 技能名 + 持有者，可带解锁消歧）或概念条目。 */
export type ProseObjectRef =
  | { kind: 'operator'; canonical: string }
  | { kind: 'skill'; operator: string; room: string; name: string; unlock?: string }
  | { kind: 'concept'; file: string; headingPath: string[]; occurrence?: number; term?: string; termOccurrence?: number }

export interface ProseLinkEntry {
  /** 相对语料根的 markdown 路径 */
  file: string
  /** H1→当前标题路径；文档根为空数组 */
  headingPath: string[]
  /** 同文件同路径重复标题的出现序号（从 1 开始）；省略时要求路径唯一 */
  occurrence?: number
  /** 关联适用范围；必填 */
  scope: ProseScope
  /** 该小节登记的对象引用；空数组合法 */
  objects: ProseObjectRef[]
}

export interface ProseLinkFile {
  version: number
  links: ProseLinkEntry[]
}

/** 解析后的卡片类对象：保留可读引用回显，并携带当前内部 ID。 */
export interface ResolvedProseCard {
  kind: 'card'
  /** 可读引用回显（如 operator:凯尔希·思衡托 或 办公室｜「天灾信使·β」｜普罗旺斯） */
  ref: string
  /** 目标记录卡 canonical */
  canonical: string
  /** 技能细化引用解析到的 grant 内部 ID */
  grantId?: string
  /** 技能细化引用解析到的 skill 内部 ID */
  skillId?: string
}

/** 解析后的概念对象：来源位置与定义原文，名称按 term 或小节标题。 */
export interface ResolvedProseConcept {
  kind: 'concept'
  /** 可读引用回显（如 concept:guides/类别.md#官方术语与类别 > 规则说明（25 条）｜心情落差） */
  ref: string
  /** 概念名称：填写 term 时为该条目名，否则为小节标题 */
  name: string
  file: string
  headingPath: string[]
  occurrence: number
  term?: string
  termOccurrence?: number
  /** 定义原文所在行范围（1 基，含） */
  startLine: number
  endLine: number
  /** 定义原文 */
  definition: string
}

export type ResolvedProseObject = ResolvedProseCard | ResolvedProseConcept

/** 解析失败的可读引用：保留登记回显与原因，供展开时显式报告而不是静默丢弃。 */
export interface UnresolvedProseObject {
  /** 可读引用回显（与登记原文一致） */
  ref: string
  /** 解析失败原因，与 issues 同源，供展开响应与 omitted 复用 */
  reason: string
}

export interface ResolvedProseLink {
  sectionId: string
  file: string
  headingPath: string[]
  occurrence: number
  scope: ProseScope
  /** 是否登记在文档根范围（doc:<file>）上 */
  documentRoot: boolean
  /** 解析成功的对象（按登记顺序） */
  objects: ResolvedProseObject[]
  /** 解析失败的登记引用（按登记顺序）；真实语料应为空 */
  unresolved: UnresolvedProseObject[]
}

export interface ProseLinkIndex {
  /** 按小节原文顺序排列；无标注小节不出现 */
  links: ResolvedProseLink[]
  bySection: Map<string, ResolvedProseLink>
  /** 机械检查发现的定位/引用问题；真实语料应为空 */
  issues: string[]
}

/** 概念卡固定格式（ADR-022 决策 5）：名称、可检索来源位置与行范围、定义原文。 */
export function serializeConceptCard(concept: ResolvedProseConcept): string {
  const entryIndex = concept.term === undefined ? concept.occurrence : concept.termOccurrence
  return [
    `【概念：${concept.name}】`,
    `来源：${concept.file}#${headingPathLabel(concept.headingPath)}（条目序号 ${entryIndex}）｜L${concept.startLine}-${concept.endLine}`,
    `定义：${concept.definition}`,
  ].join('\n')
}

/** 读取范围内的单个送达对象及其全部登记来源（ADR-022 决策 6 的 readDelivery.origins）。 */
export interface ProseReadOrigin {
  sectionId: string
  /** 登记 entry.objects 的零基下标 */
  objectIndex: number
}

export interface ProseReadCard {
  kind: 'card'
  canonical: string
  /** full 表示 operator 引用（完整卡），skills 表示仅精确技能投影 */
  projection: 'full' | 'skills'
  /** 明确引用的 grant（按登记顺序去重）；替换链由读取层按真源补齐 */
  explicitGrantIds: string[]
  origins: ProseReadOrigin[]
}

export interface ProseReadConcept {
  kind: 'concept'
  concept: ResolvedProseConcept
  origins: ProseReadOrigin[]
}

export type ProseReadObject = ProseReadCard | ProseReadConcept

const EMPTY_PROSE_LINK_FILE: ProseLinkFile = { version: PROSE_LINKS_VERSION, links: [] }

function fail(message: string): never {
  throw new Error(`关联元数据加载失败：${message}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label}不能为空`)
}

/** 未知字段一律报错，避免把拼写错误当成「没有这项设定」。 */
function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown !== undefined) fail(`${label}包含未登记字段：${unknown}`)
}

/** 语料根相对路径校验：拒绝绝对路径、反斜杠、空段、. 与 .. （越界由清单校验承担）。 */
function parseRelativeDocPath(value: unknown, label: string): string {
  assertNonEmptyString(value, label)
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value)) fail(`${label}必须是语料根相对路径`)
  if (value.includes('\\')) fail(`${label}必须使用正斜杠`)
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${label}不允许空段、. 或 ..`)
  }
  return value
}

/** 标题路径校验：原始文本数组，不含 #；文档根为空数组。 */
function parseHeadingPath(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(`${label}必须是字符串数组`)
  return value.map((part, index) => {
    assertNonEmptyString(part, `${label}第 ${index + 1} 项`)
    if (part.startsWith('#')) fail(`${label}第 ${index + 1} 项不能包含 # 前缀`)
    return part
  })
}

function parseOccurrence(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) fail(`${label}必须是正整数`)
  return value
}

function parseScope(value: unknown, label: string): ProseScope {
  if (value !== 'section' && value !== 'subtree') fail(`${label}必须是 section 或 subtree`)
  return value
}

/** 校验单条可读对象引用；非法结构直接报错（属于数据格式问题，不是可降级的解析歧义）。 */
function parseObjectRef(value: unknown, label: string): ProseObjectRef {
  if (!isObject(value)) fail(`${label}必须是对象`)
  if (value.kind === 'operator') {
    assertKnownKeys(value, ['kind', 'canonical'], label)
    assertNonEmptyString(value.canonical, `${label}的 canonical`)
    return { kind: 'operator', canonical: value.canonical }
  }
  if (value.kind === 'skill') {
    assertKnownKeys(value, ['kind', 'operator', 'room', 'name', 'unlock'], label)
    assertNonEmptyString(value.operator, `${label}的 operator`)
    assertNonEmptyString(value.room, `${label}的 room`)
    assertNonEmptyString(value.name, `${label}的 name`)
    if (value.unlock !== undefined) assertNonEmptyString(value.unlock, `${label}的 unlock`)
    return {
      kind: 'skill',
      operator: value.operator,
      room: value.room,
      name: value.name,
      ...(value.unlock === undefined ? {} : { unlock: value.unlock }),
    }
  }
  if (value.kind === 'concept') {
    assertKnownKeys(value, ['kind', 'file', 'headingPath', 'occurrence', 'term', 'termOccurrence'], label)
    const file = parseRelativeDocPath(value.file, `${label}的 file`)
    const headingPath = parseHeadingPath(value.headingPath, `${label}的 headingPath`)
    const occurrence = parseOccurrence(value.occurrence, `${label}的 occurrence`)
    if (headingPath.length === 0 && occurrence !== undefined && occurrence !== 1) {
      fail(`${label}的文档根出现序号只能为 1`)
    }
    if (value.term === undefined && value.termOccurrence !== undefined) {
      fail(`${label}未填 term 时不允许填 termOccurrence`)
    }
    if (value.term !== undefined) assertNonEmptyString(value.term, `${label}的 term`)
    const termOccurrence = parseOccurrence(value.termOccurrence, `${label}的 termOccurrence`)
    return {
      kind: 'concept',
      file,
      headingPath,
      ...(occurrence === undefined ? {} : { occurrence }),
      ...(value.term === undefined ? {} : { term: value.term as string }),
      ...(termOccurrence === undefined ? {} : { termOccurrence }),
    }
  }
  return fail(`${label}的 kind 必须是 operator、skill 或 concept`)
}

/** 校验旁挂文件结构；顶层非法报错，空 links 合法。 */
export function parseProseLinkFile(raw: unknown, label = PROSE_LINKS_FILE_NAME): ProseLinkFile {
  if (!isObject(raw)) fail(`${label}必须是对象`)
  assertKnownKeys(raw, ['version', 'links'], label)
  if (raw.version !== PROSE_LINKS_VERSION) {
    fail(`${label}的 version 必须是 ${PROSE_LINKS_VERSION}；历史 v1 标注请按当前契约迁移（逐条补 scope）`)
  }
  if (!Array.isArray(raw.links)) fail(`${label}必须包含 links 数组`)

  const links = raw.links.map((entry, index) => {
    const entryLabel = `${label} 第 ${index + 1} 条`
    if (!isObject(entry)) fail(`${entryLabel}必须是对象`)
    assertKnownKeys(entry, ['file', 'headingPath', 'occurrence', 'scope', 'objects'], entryLabel)
    const file = parseRelativeDocPath(entry.file, `${entryLabel}的 file`)
    const headingPath = parseHeadingPath(entry.headingPath, `${entryLabel}的 headingPath`)
    const occurrence = parseOccurrence(entry.occurrence, `${entryLabel}的 occurrence`)
    const scope = parseScope(entry.scope, `${entryLabel}的 scope`)
    if (headingPath.length === 0 && occurrence !== undefined && occurrence !== 1) {
      fail(`${entryLabel}的文档根出现序号只能为 1`)
    }
    if (!Array.isArray(entry.objects)) fail(`${entryLabel}的 objects 必须是数组`)
    const objects = entry.objects.map((object, objectIndex) => parseObjectRef(object, `${entryLabel}的 objects 第 ${objectIndex + 1} 项`))
    return {
      file,
      headingPath,
      ...(occurrence === undefined ? {} : { occurrence }),
      scope,
      objects,
    }
  })

  return { version: PROSE_LINKS_VERSION, links }
}

/** 读取旁挂文件；文件缺失表示无标注（空关联合法），内容非法时报中文错误。 */
export function loadProseLinkFile(corpusDir: string): ProseLinkFile {
  const path = join(corpusDir, PROSE_LINKS_FILE_NAME)
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (error) {
    // 只有文件不存在才视为「无标注」；权限/IO 失败等应显式报告，不静默降级为空关联。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_PROSE_LINK_FILE
    throw new Error(`关联元数据无法读取：${PROSE_LINKS_FILE_NAME}（${error instanceof Error ? error.message : String(error)}）`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`关联元数据不是有效 JSON：${PROSE_LINKS_FILE_NAME}`)
  }
  return parseProseLinkFile(parsed)
}

/** 小节的标题路径（H1→当前标题；根节点为空数组）。 */
function sectionHeadingPath(section: SectionEntry): string[] {
  return section.level === 0 ? [] : [...section.ancestors, section.heading]
}

function sameHeadingPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index])
}

/** 文档根范围的可读标题路径。 */
function docRootPath(): string {
  return '（文档根节点）'
}

/** 单个设施技能分片的标题路径回显（含文档根）。 */
function headingPathLabel(headingPath: readonly string[]): string {
  return headingPath.join(' > ') || docRootPath()
}

/**
 * 按「文件 + 标题路径（+ occurrence）」定位；headingPath 为空数组时定位该文件的文档范围（doc:<file>）。
 * 命不中或重复标题未消歧时记问题并返回 undefined。
 */
function locateSection(directory: SectionDirectory, entry: ProseLinkEntry, label: string, issues: string[]): SectionEntry | undefined {
  if (entry.headingPath.length === 0) {
    const doc = directory.documentRange(entry.file)
    if (!doc) {
      issues.push(`${label}：未找到文档范围 ${entry.file}`)
      return undefined
    }
    return doc
  }
  const matches = directory.sections.filter(
    (section) => section.file === entry.file && sameHeadingPath(sectionHeadingPath(section), entry.headingPath),
  )
  if (matches.length === 0) {
    issues.push(`${label}：未找到小节 ${entry.file}#${headingPathLabel(entry.headingPath)}`)
    return undefined
  }
  if (entry.occurrence !== undefined) {
    const picked = matches.find((section) => section.occurrence === entry.occurrence)
    if (!picked) {
      issues.push(`${label}：occurrence=${entry.occurrence} 无匹配（同路径 ${matches.length} 条）`)
    }
    return picked
  }
  if (matches.length > 1) {
    issues.push(`${label}：同路径重复标题 ${matches.length} 条，须用 occurrence 消歧`)
    return undefined
  }
  return matches[0]
}

/** 单个可读引用的解析结果：成功保留完整对象，失败保留可读引用与原因。 */
type ObjectResolution =
  | { ok: true; object: ResolvedProseObject }
  | { ok: false; ref: string; reason: string }

/** 干员引用的可读回显；解析前后一致，失败时仍可报告登记原文。 */
function readableOperatorRef(canonical: string): string {
  return `operator:${canonical}`
}

/** 技能引用的可读回显（设施｜技能名｜持有者[｜解锁]）；解析前后一致。 */
function readableSkillRef(ref: Extract<ProseObjectRef, { kind: 'skill' }>): string {
  return `${ref.room}｜「${ref.name}」｜${ref.operator}${ref.unlock === undefined ? '' : `｜${ref.unlock}`}`
}

/** 概念引用的可读回显。 */
function readableConceptRef(ref: Extract<ProseObjectRef, { kind: 'concept' }>): string {
  const term = ref.term === undefined ? '' : `｜${ref.term}${ref.termOccurrence === undefined ? '' : `#${ref.termOccurrence}`}`
  return `concept:${ref.file}#${headingPathLabel(ref.headingPath)}${term}`
}

/** 解析后的对象身份：技能细化到 grant，干员定位到 canonical，概念定位到精确来源位置。 */
function objectIdentity(object: ResolvedProseObject): string {
  if (object.kind === 'card') {
    return object.grantId === undefined ? `operator:${object.canonical}` : `skill:${object.grantId}`
  }
  return conceptIdentity(object)
}

/** 概念按完整定位去重；解析与读取范围合并共用。 */
export function conceptIdentity(concept: ResolvedProseConcept): string {
  return `concept:${concept.file}\u0000${concept.headingPath.join('\u0000')}\u0000${concept.occurrence}\u0000${concept.term ?? ''}\u0000${concept.termOccurrence ?? 1}`
}

/** 解析单个卡片类对象引用为当前内部 ID；解析失败记问题并保留可读引用与原因。 */
function resolveCardObject(
  ref: Extract<ProseObjectRef, { kind: 'operator' | 'skill' }>,
  operatorsByCanonical: ReadonlyMap<string, OperatorDefinition>,
  skillById: ReadonlyMap<string, SkillFact>,
  grants: readonly OperatorSkillGrant[],
  label: string,
  issues: string[],
): ObjectResolution {
  if (ref.kind === 'operator') {
    const readable = readableOperatorRef(ref.canonical)
    if (!operatorsByCanonical.has(ref.canonical)) {
      issues.push(`${label}：关联干员不在名册：${ref.canonical}`)
      return { ok: false, ref: readable, reason: '关联干员不在名册' }
    }
    return { ok: true, object: { kind: 'card', ref: readable, canonical: ref.canonical } }
  }

  const readable = readableSkillRef(ref)
  const operator = operatorsByCanonical.get(ref.operator)
  if (!operator) {
    issues.push(`${label}：关联技能持有者不在名册：${ref.operator}`)
    return { ok: false, ref: readable, reason: '关联技能持有者不在名册' }
  }
  const candidates = grants.filter((grant) => {
    if (grant.operatorId !== operator.id) return false
    const skill = skillById.get(grant.skillId)
    return skill !== undefined && skill.room === ref.room && skill.name === ref.name
  })
  const matched = ref.unlock === undefined ? candidates : candidates.filter((grant) => grant.unlockText === ref.unlock)
  const detail = `${ref.operator}｜${ref.room}｜「${ref.name}」${ref.unlock === undefined ? '' : `｜${ref.unlock}`}`
  if (matched.length === 0) {
    issues.push(`${label}：未找到关联技能：${detail}`)
    return { ok: false, ref: readable, reason: '未找到关联技能' }
  }
  if (matched.length > 1) {
    issues.push(`${label}：关联技能解析歧义（命中 ${matched.length} 条），请补充 unlock：${detail}`)
    return { ok: false, ref: readable, reason: `关联技能解析歧义（命中 ${matched.length} 条），需补充 unlock` }
  }
  const grant = matched[0]!
  return {
    ok: true,
    object: { kind: 'card', ref: readable, canonical: ref.operator, grantId: grant.id, skillId: grant.skillId },
  }
}

/** 小节「直接正文」：不含下级小节的正文行（概念条目只在这一段里查找）。 */
function directBodyLines(section: SectionEntry, firstChildHeadingLine: number | null): string[] {
  const lines = section.body.split('\n')
  if (firstChildHeadingLine === null) return lines
  const take = Math.min(lines.length, firstChildHeadingLine - section.startLine)
  return lines.slice(0, Math.max(0, take))
}

/**
 * 解析概念引用（ADR-022 决策 5）：只从当前原文快照的 manifest 文件读取，不建第二份定义。
 * 未填 term 时目标必须是有非空正文且无子标题的单概念小节；填 term 时在其直接正文里按
 * 行首「- **名称**」条目精确定位，同名条目须用 termOccurrence 消歧。
 */
function resolveConceptObject(
  ref: Extract<ProseObjectRef, { kind: 'concept' }>,
  directory: SectionDirectory,
  manifestFiles: ReadonlySet<string>,
): ObjectResolution {
  const readable = readableConceptRef(ref)
  if (!manifestFiles.has(ref.file)) {
    return { ok: false, ref: readable, reason: `概念来源不在当前检索白名单：${ref.file}` }
  }
  if (ref.headingPath.length === 0 && ref.occurrence !== undefined && ref.occurrence !== 1) {
    return { ok: false, ref: readable, reason: '概念文档根出现序号只能为 1' }
  }
  const matches = directory.sections.filter(
    (section) => section.file === ref.file && sameHeadingPath(sectionHeadingPath(section), ref.headingPath),
  )
  const section = ref.headingPath.length === 0
    ? directory.documentRange(ref.file)
    : ref.occurrence === undefined
      ? (matches.length === 1 ? matches[0] : undefined)
      : matches.find((candidate) => candidate.occurrence === ref.occurrence)
  if (!section) {
    return { ok: false, ref: readable, reason: `概念小节未找到或未用 occurrence 消歧：${ref.file}#${headingPathLabel(ref.headingPath)}` }
  }

  // 文档根的逻辑子标题未记在 parentId 树中，按同一目录快照补足首个标题边界。
  const firstChildHeadingLine = section.level === 0
    ? directory.sections.find((candidate) => candidate.file === ref.file && candidate.level > 0)?.headingLine ?? null
    : section.firstChildHeadingLine
  const lines = directBodyLines(section, firstChildHeadingLine)
  const bullet = /^- \*\*(?<name>[^*]+)\*\*/u
  if (ref.term === undefined) {
    if (firstChildHeadingLine !== null) {
      return { ok: false, ref: readable, reason: `概念目标含有下级标题，不是单概念小节：${ref.file}#${sectionHeadingPathLabel(section)}` }
    }
    if (section.heading.trim() === '') {
      return { ok: false, ref: readable, reason: `概念目标没有标题名称，须用 term 定位具体条目：${ref.file}` }
    }
    if (lines.filter((line) => bullet.test(line)).length > 1) {
      return { ok: false, ref: readable, reason: `概念小节含有多个术语条目，须用 term 定位具体定义：${ref.file}#${sectionHeadingPathLabel(section)}` }
    }
    const definition = section.body.trim()
    if (definition === '') {
      return { ok: false, ref: readable, reason: `概念小节正文为空：${ref.file}#${sectionHeadingPathLabel(section)}` }
    }
    return {
      ok: true,
      object: {
        kind: 'concept',
        ref: readable,
        name: section.heading,
        file: ref.file,
        headingPath: headingPathOf(section),
        occurrence: section.occurrence,
        startLine: section.startLine,
        endLine: section.endLine,
        definition: section.body,
      },
    }
  }

  const hits: Array<{ lineIndex: number; name: string }> = []
  lines.forEach((line, lineIndex) => {
    const matched = bullet.exec(line)?.groups?.name
    if (matched !== undefined && matched === ref.term) hits.push({ lineIndex, name: matched })
  })
  if (hits.length === 0) {
    return { ok: false, ref: readable, reason: `概念条目未找到：${ref.term}（${ref.file}#${sectionHeadingPathLabel(section)}）` }
  }
  if (hits.length > 1 && ref.termOccurrence === undefined) {
    return { ok: false, ref: readable, reason: `概念条目同名 ${hits.length} 条，须显式填写 termOccurrence：${ref.term}` }
  }
  const termOccurrence = ref.termOccurrence ?? 1
  if (termOccurrence > hits.length) {
    return { ok: false, ref: readable, reason: `概念条目的 termOccurrence=${termOccurrence} 超出同名条目数 ${hits.length}：${ref.term}` }
  }
  const start = hits[termOccurrence - 1]!.lineIndex
  // 连续内容取至下一条同级条目或直接正文末尾；不跨入子小节（directBodyLines 已截到子标题前）。
  let end = lines.length - 1
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^(?:[-+*]|\d+[.)])(?:[\t ]|$)/u.test(lines[index]!)) {
      end = index - 1
      break
    }
  }
  while (end > start && lines[end]!.trim() === '') end -= 1
  const definition = lines.slice(start, end + 1).join('\n')
  return {
    ok: true,
    object: {
      kind: 'concept',
      ref: readable,
      name: ref.term,
      file: ref.file,
      headingPath: headingPathOf(section),
      occurrence: section.occurrence,
      term: ref.term,
      termOccurrence,
      startLine: section.startLine + start,
      endLine: section.startLine + end,
      definition,
    },
  }
}

function headingPathOf(section: SectionEntry): string[] {
  return section.level === 0 ? [] : [...section.ancestors, section.heading]
}

function sectionHeadingPathLabel(section: SectionEntry): string {
  return headingPathLabel(headingPathOf(section))
}

/** 解析条目里的单个对象引用；概念引用的结构问题直接报错，其余失败保留为 unresolved。 */
function resolveObject(
  ref: ProseObjectRef,
  operatorsByCanonical: ReadonlyMap<string, OperatorDefinition>,
  skillById: ReadonlyMap<string, SkillFact>,
  facts: ReferenceFacts,
  directory: SectionDirectory,
  manifestFiles: ReadonlySet<string>,
  label: string,
  issues: string[],
): ObjectResolution {
  if (ref.kind === 'concept') {
    const resolution = resolveConceptObject(ref, directory, manifestFiles)
    if (!resolution.ok) issues.push(`${label}：${resolution.reason}`)
    return resolution
  }
  return resolveCardObject(ref, operatorsByCanonical, skillById, facts.grants, label, issues)
}

/** 当前白名单文件集合：只允许 manifest 内文件被定位（raw 与开发文档都不能出现）。 */
function manifestFileSet(directory: SectionDirectory): Set<string> {
  return new Set(directory.sections.map((section) => section.file))
}

/**
 * 解析人工标注为运行时可用的关联索引：
 * 只做精确唯一匹配，不经过别名、子串或同名并集；问题进入 issues，
 * 合法对象保留在 objects（保持登记顺序，卡片与概念同列），失败引用按可读回显保留在 unresolved。
 */
export function resolveProseLinks(input: {
  file: ProseLinkFile
  directory: SectionDirectory
  facts: ReferenceFacts
}): ProseLinkIndex {
  const { file, directory, facts } = input
  const issues: string[] = []
  const operatorsByCanonical = new Map(facts.operators.map((operator) => [operator.canonical, operator]))
  const skillById = new Map(facts.skillFacts.map((skill) => [skill.id, skill]))
  const manifestFiles = manifestFileSet(directory)
  const order = new Map(directory.sections.map((section, index) => [section.sectionId, index]))
  const links: ResolvedProseLink[] = []
  const bySection = new Map<string, ResolvedProseLink>()
  const seenSections = new Set<string>()

  file.links.forEach((entry, index) => {
    const label = `第 ${index + 1} 条标注（${entry.file}｜${headingPathLabel(entry.headingPath)}）`
    const section = locateSection(directory, entry, label, issues)
    if (!section) return
    if (seenSections.has(section.sectionId)) {
      issues.push(`${label}：同一小节重复登记：${section.sectionId}`)
      return
    }
    seenSections.add(section.sectionId)

    const objects: ResolvedProseObject[] = []
    const unresolved: UnresolvedProseObject[] = []
    const seenIdentities = new Set<string>()
    for (const ref of entry.objects) {
      const resolution = resolveObject(
        ref,
        operatorsByCanonical,
        skillById,
        facts,
        directory,
        manifestFiles,
        label,
        issues,
      )
      const readableRef = resolution.ok ? resolution.object.ref : resolution.ref
      // 失败引用按可读回显去重后保留，供展开时在 requested/omitted 中显式报告，不静默丢弃。
      const identity = resolution.ok ? objectIdentity(resolution.object) : `unresolved:${readableRef}`
      if (seenIdentities.has(identity)) {
        issues.push(`${label}：重复引用已去重：${readableRef}`)
        continue
      }
      seenIdentities.add(identity)
      if (resolution.ok) objects.push(resolution.object)
      else unresolved.push({ ref: resolution.ref, reason: resolution.reason })
    }

    const link: ResolvedProseLink = {
      sectionId: section.sectionId,
      file: section.file,
      headingPath: headingPathOf(section),
      occurrence: section.occurrence,
      scope: entry.scope,
      documentRoot: entry.headingPath.length === 0,
      objects,
      unresolved,
    }
    links.push(link)
    bySection.set(section.sectionId, link)
  })

  links.sort((left, right) => (order.get(left.sectionId) ?? -1) - (order.get(right.sectionId) ?? -1))
  return { links, bySection, issues }
}

/** 装配输入：可注入运行级快照，缺省时按语料根自行装配。 */
export interface ProseLinkIndexInput {
  root?: string
  corpusDir?: string
  /** 运行级小节目录快照（ADR-022 决策 6）；提供时不再重复构建。 */
  directory?: SectionDirectory
  /** 运行级 raw facts 快照或其惰性提供者（与卡片投影共用同一份）；提供时不再重复加载。 */
  facts?: ReferenceFacts | (() => ReferenceFacts)
}

/**
 * 从真源装配关联索引：旁挂文件 + 小节目录 + raw 事实；缺文件或无标注时不装配后两者。
 * 传入 directory/facts 时使用调用方的同一运行快照，避免与卡片投影、read 各自重读源文件。
 */
export function buildProseLinkIndex(input: ProseLinkIndexInput = {}): ProseLinkIndex {
  const root = input.root ?? process.cwd()
  const corpusDir = input.corpusDir ?? 'knowledge'
  const corpusRoot = isAbsolute(corpusDir) ? corpusDir : join(root, corpusDir)
  const file = loadProseLinkFile(corpusRoot)
  if (file.links.length === 0) return { links: [], bySection: new Map(), issues: [] }
  const provided = input.facts
  const index = resolveProseLinks({
    file,
    directory: input.directory ?? buildSectionDirectory(corpusRoot),
    facts: (typeof provided === 'function' ? provided() : provided) ?? loadReferenceFacts(root),
  })
  assertResolvedIndex(index)
  return index
}

/** 真实装配和范围合并均拒绝损坏索引，避免丢引用后产生空关联或错位来源。 */
function assertResolvedIndex(index: ProseLinkIndex): void {
  const problems = [...index.issues, ...index.links.flatMap((link) => link.unresolved.map((item) => `${item.ref}：${item.reason}`))]
  if (problems.length > 0) fail(problems.join('\n'))
}

/** 小节的严格祖先 ID（父链，不含自身）；文档根作为逻辑祖先补足。 */
function strictAncestorIds(section: SectionEntry, directory: SectionDirectory): string[] {
  const ancestors: string[] = []
  let current = section.parentId
  while (current) {
    ancestors.push(current)
    current = directory.get(current)?.parentId
  }
  return ancestors
}

/** 登记节点是否位于所读范围的子树内（含自身）；文档范围覆盖该文件全部登记。 */
function registeredNodeInScope(link: ResolvedProseLink, section: SectionEntry, directory: SectionDirectory): boolean {
  if (link.file !== section.file) return false
  if (section.sectionId.startsWith('doc:')) return true
  if (link.sectionId === section.sectionId) return true
  let current = directory.get(link.sectionId)?.parentId
  while (current) {
    if (current === section.sectionId) return true
    current = directory.get(current)?.parentId
  }
  return false
}

/**
 * read(S) 的关联对象集合（ADR-022 决策 4、6）：
 * S 子树中的全部登记，加上 S 严格祖先中 scope=subtree 的登记；文档根按逻辑祖先参与 subtree 继承。
 * 来源按节点原文顺序、objects 内顺序稳定合并；卡按 canonical 去重（完整卡覆盖技能投影），
 * 概念按精确来源位置去重；每个对象保留全部登记来源，不去重来源。
 */
export function readObjectsFor(
  sectionId: string,
  directory: SectionDirectory,
  index: ProseLinkIndex,
): ProseReadObject[] {
  assertResolvedIndex(index)
  const section = directory.get(sectionId)
  if (!section) return []
  const ancestors = section.sectionId.startsWith('doc:') ? [] : strictAncestorIds(section, directory)
  const order = new Map(directory.sections.map((item, position) => [item.sectionId, position]))

  const sources = index.links
    .filter((link) => {
      if (registeredNodeInScope(link, section, directory)) return true
      if (link.scope !== 'subtree') return false
      // 文档根登记：作为所有标题的逻辑祖先，对该文件内的小节同样适用。
      if (link.documentRoot) return link.file === section.file && !section.sectionId.startsWith('doc:')
      return ancestors.includes(link.sectionId)
    })
    .sort((left, right) => (order.get(left.sectionId) ?? -1) - (order.get(right.sectionId) ?? -1))

  const cards = new Map<string, ProseReadCard>()
  const results: ProseReadObject[] = []
  for (const link of sources) {
    link.objects.forEach((object, objectIndex) => {
      const origin: ProseReadOrigin = { sectionId: link.sectionId, objectIndex }
      if (object.kind === 'concept') {
        const existing = results.find(
          (candidate): candidate is ProseReadConcept => candidate.kind === 'concept'
            && objectIdentity(candidate.concept) === objectIdentity(object),
        )
        if (existing) {
          existing.origins.push(origin)
          return
        }
        results.push({ kind: 'concept', concept: object, origins: [origin] })
        return
      }
      const existing = cards.get(object.canonical)
      if (existing) {
        existing.origins.push(origin)
        if (object.grantId !== undefined && !existing.explicitGrantIds.includes(object.grantId)) {
          existing.explicitGrantIds.push(object.grantId)
        }
        // operator 引用（完整卡）覆盖同卡技能投影；登记依据全部保留。
        if (object.grantId === undefined) existing.projection = 'full'
        return
      }
      const card: ProseReadCard = {
        kind: 'card',
        canonical: object.canonical,
        projection: object.grantId === undefined ? 'full' : 'skills',
        explicitGrantIds: object.grantId === undefined ? [] : [object.grantId],
        origins: [origin],
      }
      cards.set(object.canonical, card)
      results.push(card)
    })
  }
  return results
}
