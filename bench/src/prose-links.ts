/**
 * 散文小节关联事实的旁挂元数据：读取、定位解析与机械检查（ADR-020 步骤 1–2）。
 *
 * 人工标注保存在 corpusDir 下的 prose-links.json，按「文件 + 标题路径」定位小节，
 * 只保存可读对象引用；本模块把它解析为当前 operator/skill/grant 内部 ID，并收集定位与引用问题。
 * 不参与检索分词、切块与排序，也不在模块顶层读写文件或执行副作用。
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { OperatorDefinition, OperatorSkillGrant, SkillFact } from './facts/normalized.js'
import { loadReferenceFacts, type ReferenceFacts } from './facts/references.js'
import { buildSectionDirectory, type SectionDirectory, type SectionEntry } from './sections.js'

export const PROSE_LINKS_VERSION = 1 as const
export const PROSE_LINKS_FILE_NAME = 'prose-links.json'

/** 可读对象引用：干员定位到规范对象，技能细化到设施 + 技能名 + 持有者（可带解锁消歧）。 */
export type ProseObjectRef =
  | { kind: 'operator'; canonical: string }
  | { kind: 'skill'; operator: string; room: string; name: string; unlock?: string }

export interface ProseLinkEntry {
  /** 相对语料根的 markdown 路径 */
  file: string
  /** H1→当前标题路径；根节点为空数组 */
  headingPath: string[]
  /** 同文件同路径重复标题的出现序号（从 1 开始）；省略时要求路径唯一 */
  occurrence?: number
  /** 该小节登记的对象引用；空数组合法 */
  objects: ProseObjectRef[]
}

export interface ProseLinkFile {
  version: number
  links: ProseLinkEntry[]
}

/** 解析后的对象：保留可读引用回显，并携带当前内部 ID。 */
export interface ResolvedProseObject {
  /** 可读引用回显（如 operator:凯尔希·思衡托 或 办公室｜「天灾信使·β」｜普罗旺斯） */
  ref: string
  /** 目标记录卡 canonical */
  canonical: string
  /** 技能细化引用解析到的 grant 内部 ID */
  grantId?: string
  /** 技能细化引用解析到的 skill 内部 ID */
  skillId?: string
}

export interface ResolvedProseLink {
  sectionId: string
  file: string
  headingPath: string[]
  occurrence: number
  objects: ResolvedProseObject[]
}

export interface ProseLinkIndex {
  /** 按小节原文顺序排列；无标注小节不出现 */
  links: ResolvedProseLink[]
  bySection: Map<string, ResolvedProseLink>
  /** 机械检查发现的定位/引用问题；真实语料应为空 */
  issues: string[]
}

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

/** 校验单条可读对象引用；非法结构直接报错（属于数据格式问题，不是可降级的解析歧义）。 */
function parseObjectRef(value: unknown, label: string): ProseObjectRef {
  if (!isObject(value)) fail(`${label}必须是对象`)
  if (value.kind === 'operator') {
    assertNonEmptyString(value.canonical, `${label}的 canonical`)
    return { kind: 'operator', canonical: value.canonical }
  }
  if (value.kind === 'skill') {
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
  return fail(`${label}的 kind 必须是 operator 或 skill`)
}

/** 校验旁挂文件结构；顶层非法报错，空 links 合法。 */
export function parseProseLinkFile(raw: unknown, label = PROSE_LINKS_FILE_NAME): ProseLinkFile {
  if (!isObject(raw)) fail(`${label}必须是对象`)
  if (raw.version !== PROSE_LINKS_VERSION) fail(`${label}的 version 必须是 ${PROSE_LINKS_VERSION}`)
  if (!Array.isArray(raw.links)) fail(`${label}必须包含 links 数组`)

  const links = raw.links.map((entry, index) => {
    const entryLabel = `${label} 第 ${index + 1} 条`
    if (!isObject(entry)) fail(`${entryLabel}必须是对象`)
    assertNonEmptyString(entry.file, `${entryLabel}的 file`)
    if (entry.file.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(entry.file)) fail(`${entryLabel}的 file 必须是语料根相对路径`)
    if (!Array.isArray(entry.headingPath)) fail(`${entryLabel}的 headingPath 必须是字符串数组`)
    const headingPath = entry.headingPath.map((part, partIndex) => {
      assertNonEmptyString(part, `${entryLabel}的 headingPath 第 ${partIndex + 1} 项`)
      return part
    })
    if (entry.occurrence !== undefined) {
      if (typeof entry.occurrence !== 'number' || !Number.isInteger(entry.occurrence) || entry.occurrence <= 0) {
        fail(`${entryLabel}的 occurrence 必须是正整数`)
      }
    }
    if (!Array.isArray(entry.objects)) fail(`${entryLabel}的 objects 必须是数组`)
    const objects = entry.objects.map((object, objectIndex) => parseObjectRef(object, `${entryLabel}的 objects 第 ${objectIndex + 1} 项`))
    return {
      file: entry.file,
      headingPath,
      ...(entry.occurrence === undefined ? {} : { occurrence: entry.occurrence }),
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

/** 按「文件 + 标题路径（+ occurrence）」定位小节；命不中或重复标题未消歧时记问题并返回 undefined。 */
function locateSection(directory: SectionDirectory, entry: ProseLinkEntry, label: string, issues: string[]): SectionEntry | undefined {
  const matches = directory.sections.filter(
    (section) => section.file === entry.file && sameHeadingPath(sectionHeadingPath(section), entry.headingPath),
  )
  if (matches.length === 0) {
    issues.push(`${label}：未找到小节 ${entry.file}#${entry.headingPath.join(' > ') || '文档根节点'}`)
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

/** 解析单个可读对象引用为当前内部 ID；解析失败记问题并返回 undefined。 */
function resolveObject(
  ref: ProseObjectRef,
  operatorsByCanonical: ReadonlyMap<string, OperatorDefinition>,
  skillById: ReadonlyMap<string, SkillFact>,
  grants: readonly OperatorSkillGrant[],
  label: string,
  issues: string[],
): ResolvedProseObject | undefined {
  if (ref.kind === 'operator') {
    if (!operatorsByCanonical.has(ref.canonical)) {
      issues.push(`${label}：关联干员不在名册：${ref.canonical}`)
      return undefined
    }
    return { ref: `operator:${ref.canonical}`, canonical: ref.canonical }
  }

  const operator = operatorsByCanonical.get(ref.operator)
  if (!operator) {
    issues.push(`${label}：关联技能持有者不在名册：${ref.operator}`)
    return undefined
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
    return undefined
  }
  if (matched.length > 1) {
    issues.push(`${label}：关联技能解析歧义（命中 ${matched.length} 条），请补充 unlock：${detail}`)
    return undefined
  }
  const grant = matched[0]!
  return {
    ref: `${ref.room}｜「${ref.name}」｜${ref.operator}${ref.unlock === undefined ? '' : `｜${ref.unlock}`}`,
    canonical: ref.operator,
    grantId: grant.id,
    skillId: grant.skillId,
  }
}

/**
 * 解析人工标注为运行时可用的关联索引：
 * 只做精确唯一匹配，不经过别名、子串或同名并集；问题进入 issues，合法对象仍保留。
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
  const order = new Map(directory.sections.map((section, index) => [section.sectionId, index]))
  const links: ResolvedProseLink[] = []
  const bySection = new Map<string, ResolvedProseLink>()
  const seenSections = new Set<string>()

  file.links.forEach((entry, index) => {
    const label = `第 ${index + 1} 条标注（${entry.file}｜${entry.headingPath.join(' > ') || '文档根节点'}）`
    const section = locateSection(directory, entry, label, issues)
    if (!section) return
    if (seenSections.has(section.sectionId)) {
      issues.push(`${label}：同一小节重复登记：${section.sectionId}`)
      return
    }
    seenSections.add(section.sectionId)

    const objects: ResolvedProseObject[] = []
    const seenRefs = new Set<string>()
    for (const ref of entry.objects) {
      const resolved = resolveObject(ref, operatorsByCanonical, skillById, facts.grants, label, issues)
      if (!resolved) continue
      if (seenRefs.has(resolved.ref)) {
        issues.push(`${label}：重复引用已去重：${resolved.ref}`)
        continue
      }
      seenRefs.add(resolved.ref)
      objects.push(resolved)
    }

    const link: ResolvedProseLink = {
      sectionId: section.sectionId,
      file: section.file,
      headingPath: sectionHeadingPath(section),
      occurrence: section.occurrence,
      objects,
    }
    links.push(link)
    bySection.set(section.sectionId, link)
  })

  links.sort((left, right) => (order.get(left.sectionId) ?? 0) - (order.get(right.sectionId) ?? 0))
  return { links, bySection, issues }
}

/** 从真源装配关联索引：旁挂文件 + 小节目录 + references 事实；缺文件表示无标注。 */
export function buildProseLinkIndex(root = process.cwd(), corpusDir = 'knowledge'): ProseLinkIndex {
  const corpusRoot = isAbsolute(corpusDir) ? corpusDir : join(root, corpusDir)
  return resolveProseLinks({
    file: loadProseLinkFile(corpusRoot),
    directory: buildSectionDirectory(corpusRoot),
    facts: loadReferenceFacts(root),
  })
}
