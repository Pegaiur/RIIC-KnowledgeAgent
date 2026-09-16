/**
 * 技能等价组解析与精确落点。
 *
 * 等价组的技能名不是唯一身份；本模块同时使用设施、效果原文、持有者和解锁档位
 * 定位 SkillFact，避免同名不同效果（例如两个“澎湃紊流”）串线。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FactsParseError, type OperatorSkillGrant, type SkillFact } from './normalized.js'
import { REFERENCE_ROOMS } from './references.js'
import type { ReferenceFacts } from './references.js'

export interface SkillEquivalenceGroup {
  id: string
  room: string
  skillNames: string[]
  effectText: string
  skillIds: string[]
}

interface ParsedHolder {
  operatorId: string
  rarity: string
  elite?: number
  level?: number
}

function hashGroup(room: string, skillNames: readonly string[], effectText: string): string {
  return createHash('sha256').update(JSON.stringify([room, skillNames, effectText])).digest('hex')
}

function rankMatches(grant: OperatorSkillGrant, holder: ParsedHolder): boolean {
  if (grant.unlockKind === 'initial') return holder.elite === 0 || holder.level === 30
  if (grant.level !== undefined) return holder.level === grant.level
  return holder.elite === grant.elite
}

function parseHolder(text: string, room: string, lineNumber: number): ParsedHolder {
  const match = text.match(/^(?<operator>.+)☆(?<rarity>[1-6])\((?<rank>精\d+|Lv\.\d+)\)$/)
  if (!match?.groups?.operator || !match.groups.rarity || !match.groups.rank) {
    throw new FactsParseError(`${room}第 ${lineNumber} 行等价组持有者无法解析：${text}`)
  }
  return match.groups.rank.startsWith('Lv.')
    ? { operatorId: match.groups.operator, rarity: match.groups.rarity, level: Number(match.groups.rank.slice(3)) }
    : { operatorId: match.groups.operator, rarity: match.groups.rarity, elite: Number(match.groups.rank.slice(1)) }
}

function locateSkillIds(
  room: string,
  names: readonly string[],
  effectText: string,
  holders: readonly ParsedHolder[],
  facts: ReferenceFacts,
): string[] {
  const operatorById = new Map(facts.operators.map((operator) => [operator.id, operator]))
  const grantsBySkillOperator = new Map<string, OperatorSkillGrant[]>()
  for (const grant of facts.grants) {
    const key = `${grant.skillId}\0${grant.operatorId}`
    const grants = grantsBySkillOperator.get(key) ?? []
    grants.push(grant)
    grantsBySkillOperator.set(key, grants)
  }
  const factsByName = new Map<string, SkillFact[]>()
  for (const fact of facts.skillFacts) {
    if (fact.room !== room) continue
    const matches = factsByName.get(fact.name) ?? []
    matches.push(fact)
    factsByName.set(fact.name, matches)
  }

  const skillIds: string[] = []
  for (const name of names) {
    const candidates = (factsByName.get(name) ?? []).filter((fact) => fact.rawEffectText === effectText)
    const located = candidates.filter((fact) => holders.some((holder) => {
      const operator = operatorById.get(holder.operatorId)
      if (!operator || operator.rarity !== holder.rarity) {
        throw new FactsParseError(`等价组持有者与名册不一致：${holder.operatorId}`)
      }
      return (grantsBySkillOperator.get(`${fact.id}\0${holder.operatorId}`) ?? []).some((grant) => rankMatches(grant, holder))
    }))
    if (located.length === 0) throw new FactsParseError(`等价组无法定位精确技能：${room} / ${name}`)
    skillIds.push(...located.map((fact) => fact.id))
  }
  if (new Set(skillIds).size !== skillIds.length) {
    throw new FactsParseError(`等价组出现重复 SkillFact：${room} / ${names.join('、')}`)
  }
  return skillIds
}

/** 解析技能等价组全文，并将每个成员连接到唯一 SkillFact。 */
export function parseEquivalenceGroups(text: string, facts: ReferenceFacts): SkillEquivalenceGroup[] {
  const lines = text.split(/\r?\n/)
  const groups: SkillEquivalenceGroup[] = []
  const seenIds = new Set<string>()
  const seenRooms = new Set<string>()
  let currentRoom: string | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.startsWith('## ')) {
      const room = line.slice(3).trim()
      currentRoom = (REFERENCE_ROOMS as readonly string[]).includes(room) ? room : undefined
      if (currentRoom !== undefined) seenRooms.add(currentRoom)
      continue
    }
    const room = currentRoom
    if (!room || !line.trim()) continue
    if (!line.startsWith('- **')) {
      throw new FactsParseError(`等价组第 ${index + 1} 行无法消费：${line}`)
    }

    const groupMatch = line.match(/^\-\s+\*\*(?<names>.+)\*\*$/)
    if (!groupMatch?.groups?.names) throw new FactsParseError(`等价组第 ${index + 1} 行标题无法解析`)
    const skillNames = groupMatch.groups.names.split(' ＝ ').map((name) => name.trim()).filter(Boolean)
    if (skillNames.length < 2) throw new FactsParseError(`等价组成员不足：${skillNames.join('、')}`)

    const effectLine = lines[++index]
    const holderLine = lines[++index]
    const effectMatch = effectLine?.match(/^\s{2}- 效果：(.+)$/)
    const holderMatch = holderLine?.match(/^\s{2}- 持有者：(.+)$/)
    if (!effectMatch?.[1] || !holderMatch?.[1]) {
      throw new FactsParseError(`等价组第 ${index + 1} 行缺少效果或持有者`)
    }
    const effectText = effectMatch[1]
    const holders = holderMatch[1].split('、').map((holder) => parseHolder(holder, room, index + 1))
    const skillIds = locateSkillIds(room, skillNames, effectText, holders, facts)
    const id = `equivalence:${hashGroup(room, skillNames, effectText)}`
    if (seenIds.has(id)) throw new FactsParseError(`等价组重复：${room} / ${skillNames.join('、')}`)
    seenIds.add(id)
    groups.push({ id, room, skillNames, effectText, skillIds })
  }

  if (seenRooms.size !== REFERENCE_ROOMS.length || groups.length !== 82) {
    throw new FactsParseError(`等价组数量或设施覆盖不一致：${groups.length}`)
  }
  return groups
}

/** 从仓库真源读取技能等价组（knowledge/raw 下的机械真源）。 */
export function loadEquivalenceGroups(root: string, facts: ReferenceFacts): SkillEquivalenceGroup[] {
  try {
    const text = readFileSync(join(root, 'knowledge', 'raw', '技能等价组.md'), 'utf-8')
    return parseEquivalenceGroups(text, facts)
  } catch (error) {
    if (error instanceof FactsParseError) throw error
    throw new FactsParseError('无法读取真源技能等价组：knowledge/raw/技能等价组.md')
  }
}
