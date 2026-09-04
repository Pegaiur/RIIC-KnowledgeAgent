/**
 * references 事实层的规范化实体与解析器。
 *
 * 解析边界：技能分片的「按干员」区段生成 grant，「技能 → 持有者」区段只作
 * 生成索引核对；原始效果和方括号注记保留，不在此处进行语义改写。
 */
import { createHash } from 'node:crypto'
import { parseNameRow } from './mechanical.js'

/** 基建设施标识。当前 references 的设施名由真源约束，类型不预设未来枚举。 */
export type RoomId = string

/** 技能解锁/升级的结构化类别。 */
export type UnlockKind = 'initial' | 'elite-unlock' | 'level-unlock' | 'upgrade'

/** 名册中的干员定义。id 采用 canonical，兼容现有 excludeIds 口径。 */
export interface OperatorDefinition {
  id: string
  canonical: string
  rarity: string
  profession: string
  declaredRooms: RoomId[]
  factionGroups: string[]
}

/** 供查询使用的技能事实，不声称还原上游技能实体。 */
export interface SkillFact {
  id: string
  room: RoomId
  name: string
  rawEffectText: string
  rawAnnotationText: string
  tags: string[]
  products: string[]
  professions: string[]
  referencedTerms: string[]
}

/** 某干员持有某技能事实的解锁/升级关系。 */
export interface OperatorSkillGrant {
  id: string
  operatorId: string
  skillId: string
  unlockText: string
  unlockKind: UnlockKind
  elite?: number
  level?: number
  replacesGrantId?: string
  sourceOrder: number
  sourceBuffId?: string
}

/** 技能 → 持有者索引中的单个持有者。 */
export interface SkillIndexHolder {
  operatorId: string
  rarity: string
  elite?: number
  level?: number
}

/** 技能 → 持有者索引中的一行。 */
export interface SkillIndexEntry {
  name: string
  sourceBuffId?: string
  holders: SkillIndexHolder[]
}

/** 单个设施分片的解析结果。 */
export interface ParsedSkillFragment {
  room: RoomId
  skillFacts: SkillFact[]
  grants: OperatorSkillGrant[]
  indexEntries: SkillIndexEntry[]
  stats: {
    operatorSections: number
    grants: number
    indexEntries: number
  }
}

/** references 解析失败，错误消息面向用户使用中文。 */
export class FactsParseError extends Error {
  constructor(message: string) {
    super(`事实解析失败：${message}`)
    this.name = 'FactsParseError'
  }
}

/** 解析名册全文，拒绝重复标准名并保留字段顺序。 */
export function parseOperatorRoster(text: string): OperatorDefinition[] {
  const definitions: OperatorDefinition[] = []
  const seen = new Set<string>()

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!/^\s*-\s+.+\|/.test(line)) continue
    const parts = line.replace(/^\s*-\s*/, '').split('|')
    if (parts.length < 4 || parts.length > 5 || !/^☆[1-6]$/.test(parts[1]?.trim() ?? '')) {
      throw new FactsParseError(`名册第 ${index + 1} 行格式无法解析`)
    }

    const fields = parseNameRow(line)
    if (!fields.canonical || !fields.rarity || !fields.class || fields.rooms.length === 0) {
      throw new FactsParseError(`名册第 ${index + 1} 行存在空的机械字段`)
    }
    if (seen.has(fields.canonical)) {
      throw new FactsParseError(`名册出现重复标准名：${fields.canonical}`)
    }

    seen.add(fields.canonical)
    definitions.push({
      id: fields.canonical,
      canonical: fields.canonical,
      rarity: fields.rarity,
      profession: fields.class,
      declaredRooms: fields.rooms,
      factionGroups: fields.factionGroups,
    })
  }

  if (definitions.length === 0) {
    throw new FactsParseError('名册未找到任何干员行')
  }
  return definitions
}

interface ParsedUnlock {
  unlockText: string
  unlockKind: UnlockKind
  elite?: number
  level?: number
  replacementName?: string
}

function parseUnlockText(unlockText: string): ParsedUnlock {
  const upgrade = unlockText.match(/^(?:精英\s+(\d+)|等级\s+(\d+))\s+提升，替换「([^」]+)」$/)
  if (upgrade) {
    return {
      unlockText,
      unlockKind: 'upgrade',
      elite: upgrade[1] === undefined ? undefined : Number(upgrade[1]),
      level: upgrade[2] === undefined ? undefined : Number(upgrade[2]),
      replacementName: upgrade[3],
    }
  }

  const eliteUnlock = unlockText.match(/^精英\s+(\d+)\s+解锁$/)
  if (eliteUnlock) {
    return { unlockText, unlockKind: 'elite-unlock', elite: Number(eliteUnlock[1]) }
  }

  const levelUnlock = unlockText.match(/^等级\s+(\d+)\s+解锁$/)
  if (levelUnlock) {
    return { unlockText, unlockKind: 'level-unlock', level: Number(levelUnlock[1]) }
  }

  if (unlockText === '初始解锁') {
    return { unlockText, unlockKind: 'initial' }
  }

  throw new FactsParseError(`无法识别技能解锁文本：${unlockText}`)
}

function splitAnnotationValues(value: string): string[] {
  return value.split('/').map((item) => item.trim()).filter(Boolean)
}

function parseAnnotation(rawAnnotationText: string): Pick<SkillFact, 'tags' | 'products' | 'professions' | 'referencedTerms'> {
  const result = { tags: [], products: [], professions: [], referencedTerms: [] } as Pick<
    SkillFact,
    'tags' | 'products' | 'professions' | 'referencedTerms'
  >
  for (const segment of rawAnnotationText.split('；')) {
    const match = segment.match(/^(标签|作用产物|作用职业|引用术语)：(.*)$/)
    if (!match) continue
    const values = splitAnnotationValues(match[2])
    if (match[1] === '标签') result.tags.push(...values)
    if (match[1] === '作用产物') result.products.push(...values)
    if (match[1] === '作用职业') result.professions.push(...values)
    if (match[1] === '引用术语') result.referencedTerms.push(...values)
  }
  return result
}

interface ParsedSkillLine {
  unlock: ParsedUnlock
  name: string
  sourceBuffId?: string
  rawEffectText: string
  rawAnnotationText: string
}

function parseSkillLine(line: string, room: RoomId, lineNumber: number): ParsedSkillLine {
  const match = line.match(/^\-\s+\*\*(?<unlock>[^*]+)\*\*「(?<name>[^」]+)」(?:（`(?<buff>[^`]+)`）)?：(?<body>.*)$/)
  if (!match?.groups?.unlock || !match.groups.name || match.groups.body === undefined) {
    throw new FactsParseError(`${room}第 ${lineNumber} 行技能 bullet 无法解析`)
  }

  const body = match.groups.body
  const annotation = body.match(/　〔(?<annotation>[^〕]*)〕$/)
  const rawAnnotationText = annotation?.groups?.annotation ?? ''
  const rawEffectText = annotation ? body.slice(0, annotation.index).replace(/　$/, '') : body
  return {
    unlock: parseUnlockText(match.groups.unlock),
    name: match.groups.name,
    sourceBuffId: match.groups.buff,
    rawEffectText,
    rawAnnotationText,
  }
}

function skillFactKey(room: RoomId, name: string, rawEffectText: string, rawAnnotationText: string): string {
  return JSON.stringify([room, name, rawEffectText, rawAnnotationText])
}

function hashArray(values: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}

function buildSkillFact(room: RoomId, parsed: ParsedSkillLine): SkillFact {
  const annotation = parseAnnotation(parsed.rawAnnotationText)
  return {
    id: `skill:${hashArray([room, parsed.name, parsed.rawEffectText, parsed.rawAnnotationText])}`,
    room,
    name: parsed.name,
    rawEffectText: parsed.rawEffectText,
    rawAnnotationText: parsed.rawAnnotationText,
    ...annotation,
  }
}

function parseOperatorHeading(line: string, room: RoomId, lineNumber: number): { canonical: string; rarity: string; profession: string } {
  const match = line.match(/^### (?<canonical>.+) ☆(?<rarity>[1-6]) · (?<profession>.+)$/)
  if (!match?.groups?.canonical || !match.groups.rarity || !match.groups.profession) {
    throw new FactsParseError(`${room}第 ${lineNumber} 行干员标题无法解析`)
  }
  return {
    canonical: match.groups.canonical,
    rarity: match.groups.rarity,
    profession: match.groups.profession,
  }
}

function parseIndexEntry(line: string, room: RoomId, lineNumber: number): SkillIndexEntry {
  const match = line.match(/^\-\s+「(?<name>[^」]+)」(?:（`(?<buff>[^`]+)`）)?：(?<holders>.+)$/)
  if (!match?.groups?.name || !match.groups.holders) {
    throw new FactsParseError(`${room}第 ${lineNumber} 行技能索引 bullet 无法解析`)
  }

  const holders = match.groups.holders.split('、').map((holder) => {
    const parsed = holder.match(/^(?<operator>.+)☆(?<rarity>[1-6])\((?<rank>精\d+|Lv\.\d+)\)$/)
    if (!parsed?.groups?.operator || !parsed.groups.rarity || !parsed.groups.rank) {
      throw new FactsParseError(`${room}第 ${lineNumber} 行技能索引持有者无法解析：${holder}`)
    }
    const rank = parsed.groups.rank
    return rank.startsWith('Lv.')
      ? { operatorId: parsed.groups.operator, rarity: parsed.groups.rarity, level: Number(rank.slice(3)) }
      : { operatorId: parsed.groups.operator, rarity: parsed.groups.rarity, elite: Number(rank.slice(1)) }
  })

  return { name: match.groups.name, sourceBuffId: match.groups.buff, holders }
}

function sameIndexIdentity(
  grant: OperatorSkillGrant,
  fact: SkillFact,
  operator: OperatorDefinition,
  entry: SkillIndexEntry,
  holder: SkillIndexHolder,
): boolean {
  return fact.name === entry.name
    && (grant.sourceBuffId ?? null) === (entry.sourceBuffId ?? null)
    && operator.canonical === holder.operatorId
    && operator.rarity === holder.rarity
}

function indexRankMatches(grant: OperatorSkillGrant, holder: SkillIndexHolder): boolean {
  if (grant.unlockKind === 'initial') return holder.elite === 0 || holder.level === 30
  if (grant.level !== undefined) return holder.level === grant.level
  return holder.elite === grant.elite
}

/**
 * 解析单个设施技能分片，并核对干员段落与生成索引的完整一致性。
 * `definitions` 是名册真源解析结果，用于核对标题字段和设施归属。
 */
export function parseSkillFragment(
  room: RoomId,
  text: string,
  definitions: readonly OperatorDefinition[],
): ParsedSkillFragment {
  const lines = text.split(/\r?\n/)
  const operatorSection = lines.indexOf('## 按干员')
  const indexSection = lines.indexOf('## 技能 → 持有者')
  if (operatorSection < 0 || indexSection < 0 || operatorSection >= indexSection) {
    throw new FactsParseError(`${room}缺少可识别的技能分片区段`)
  }

  const definitionByName = new Map(definitions.map((definition) => [definition.canonical, definition]))
  const seenOperators = new Set<string>()
  const grants: OperatorSkillGrant[] = []
  const skillFacts: SkillFact[] = []
  const factsByKey = new Map<string, SkillFact>()
  const factsById = new Map<string, SkillFact>()
  let currentOperator: OperatorDefinition | undefined
  let operatorSections = 0

  for (let index = operatorSection + 1; index < indexSection; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue

    if (line.startsWith('### ')) {
      const heading = parseOperatorHeading(line, room, index + 1)
      const definition = definitionByName.get(heading.canonical)
      if (!definition) {
        throw new FactsParseError(`${room}第 ${index + 1} 行存在名册外干员：${heading.canonical}`)
      }
      if (definition.rarity !== heading.rarity || definition.profession !== heading.profession) {
        throw new FactsParseError(`${room}第 ${index + 1} 行干员机械字段与名册不一致：${heading.canonical}`)
      }
      if (!definition.declaredRooms.includes(room)) {
        throw new FactsParseError(`${room}第 ${index + 1} 行干员未在名册声明该设施：${heading.canonical}`)
      }
      if (seenOperators.has(definition.id)) {
        throw new FactsParseError(`${room}出现重复干员小节：${heading.canonical}`)
      }
      seenOperators.add(definition.id)
      currentOperator = definition
      operatorSections += 1
      continue
    }

    if (line.startsWith('- ')) {
      if (!currentOperator) {
        throw new FactsParseError(`${room}第 ${index + 1} 行技能 bullet 没有所属干员标题`)
      }
      const parsed = parseSkillLine(line, room, index + 1)
      const key = skillFactKey(room, parsed.name, parsed.rawEffectText, parsed.rawAnnotationText)
      let fact = factsByKey.get(key)
      if (!fact) {
        fact = buildSkillFact(room, parsed)
        factsByKey.set(key, fact)
        factsById.set(fact.id, fact)
        skillFacts.push(fact)
      }

      const unlock = parsed.unlock
      if (unlock.unlockKind === 'initial') {
        if (currentOperator.rarity === '1' || currentOperator.rarity === '2' || currentOperator.rarity === '3') {
          unlock.level = 30
        } else {
          unlock.elite = 0
        }
      }

      const grant: OperatorSkillGrant = {
        id: `grant:${hashArray([
          currentOperator.id,
          fact.id,
          unlock.unlockText,
          unlock.unlockKind,
          unlock.elite ?? null,
          unlock.level ?? null,
          parsed.sourceBuffId ?? null,
        ])}`,
        operatorId: currentOperator.id,
        skillId: fact.id,
        unlockText: unlock.unlockText,
        unlockKind: unlock.unlockKind,
        elite: unlock.elite,
        level: unlock.level,
        sourceOrder: grants.length + 1,
        sourceBuffId: parsed.sourceBuffId,
      }

      if (unlock.replacementName) {
        const candidates = grants.filter((candidate) => {
          if (candidate.operatorId !== currentOperator!.id) return false
          const candidateFact = factsById.get(candidate.skillId)
          return candidateFact?.name === unlock.replacementName
        })
        if (candidates.length !== 1) {
          throw new FactsParseError(`${currentOperator.canonical}的升级技能找不到唯一替换目标：${unlock.replacementName}`)
        }
        grant.replacesGrantId = candidates[0].id
      }

      if (grants.some((candidate) => candidate.id === grant.id)) {
        throw new FactsParseError(`${room}出现重复技能持有实例：${currentOperator.canonical} / ${parsed.name}`)
      }
      grants.push(grant)
      continue
    }

    throw new FactsParseError(`${room}第 ${index + 1} 行无法消费：${line}`)
  }

  const indexEntries: SkillIndexEntry[] = []
  const seenIndexKeys = new Set<string>()
  for (let index = indexSection + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim() || line.startsWith('同名但 buffId 不同的是')) continue
    if (!line.startsWith('- ')) {
      throw new FactsParseError(`${room}第 ${index + 1} 行技能索引无法消费：${line}`)
    }
    const entry = parseIndexEntry(line, room, index + 1)
    const entryKey = JSON.stringify([entry.name, entry.sourceBuffId ?? null])
    if (seenIndexKeys.has(entryKey)) {
      throw new FactsParseError(`${room}技能索引出现重复条目：${entry.name}`)
    }
    seenIndexKeys.add(entryKey)
    indexEntries.push(entry)
  }

  const operatorById = new Map(definitions.map((definition) => [definition.id, definition]))
  const remainingIndex = indexEntries.flatMap((entry) => entry.holders.map((holder) => ({ entry, holder })))
  for (const grant of grants) {
    const fact = factsById.get(grant.skillId)!
    const operator = operatorById.get(grant.operatorId)
    const matchIndex = operator === undefined
      ? -1
      : remainingIndex.findIndex(({ entry, holder }) => (
        sameIndexIdentity(grant, fact, operator, entry, holder) && indexRankMatches(grant, holder)
      ))
    if (matchIndex < 0) {
      throw new FactsParseError(`技能索引与干员段落不一致（缺少 ${fact.name} / ${grant.operatorId}）`)
    }
    remainingIndex.splice(matchIndex, 1)
  }
  if (remainingIndex.length > 0) {
    const extra = remainingIndex[0]
    throw new FactsParseError(`技能索引与干员段落不一致（多出 ${extra.entry.name} / ${extra.holder.operatorId}）`)
  }

  return {
    room,
    skillFacts,
    grants,
    indexEntries,
    stats: { operatorSections, grants: grants.length, indexEntries: indexEntries.length },
  }
}

/** 用原始字段回渲染技能 bullet，便于真源核对与 fixture 回归。 */
export function renderSkillLine(grant: OperatorSkillGrant, fact: SkillFact): string {
  const buff = grant.sourceBuffId === undefined ? '' : `（\`${grant.sourceBuffId}\`）`
  const annotation = fact.rawAnnotationText === '' ? '' : `　〔${fact.rawAnnotationText}〕`
  return `- **${grant.unlockText}**「${fact.name}」${buff}：${fact.rawEffectText}${annotation}`
}
