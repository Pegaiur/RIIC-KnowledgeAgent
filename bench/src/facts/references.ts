/**
 * 全量事实加载器（knowledge/raw 下的机械真源）。
 *
 * 只负责从仓库真源读取 9 个设施分片与名册、合并解析结果并执行全量机械门禁；
 * 只读明确指定的文件，不递归扫描 raw；不在模块加载时读取文件，调用方可在测试或运行时显式选择时机。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseOperatorRoster, parseSkillFragment, FactsParseError, type OperatorDefinition, type ParsedSkillFragment, type OperatorSkillGrant, type SkillFact } from './normalized.js'

/** 设施分片的固定顺序，也是批次输出的稳定顺序。 */
export const REFERENCE_ROOMS = [
  '办公室',
  '发电站',
  '会客室',
  '加工站',
  '控制中枢',
  '贸易站',
  '宿舍',
  '训练室',
  '制造站',
] as const

/** 加载后的设施分片，保留源文本用于原文回渲染核对。 */
export interface ReferenceFragment extends ParsedSkillFragment {
  sourceText: string
}

/** 全量 references 的规范化事实集合。 */
export interface ReferenceFacts {
  operators: OperatorDefinition[]
  fragments: ReferenceFragment[]
  skillFacts: SkillFact[]
  grants: OperatorSkillGrant[]
}

interface FragmentSource {
  room: string
  sourceText: string
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item))
}

function validateReplacementGraph(grants: readonly OperatorSkillGrant[]): void {
  const grantById = new Map(grants.map((grant) => [grant.id, grant]))
  for (const grant of grants) {
    if (grant.replacesGrantId === undefined) continue
    const target = grantById.get(grant.replacesGrantId)
    if (!target || target.operatorId !== grant.operatorId || target.sourceOrder >= grant.sourceOrder) {
      throw new FactsParseError(`替换边未闭合：${grant.id}`)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (grantId: string): void => {
    if (visited.has(grantId)) return
    if (visiting.has(grantId)) throw new FactsParseError(`替换边存在环：${grantId}`)
    visiting.add(grantId)
    const grant = grantById.get(grantId)
    if (grant?.replacesGrantId !== undefined) visit(grant.replacesGrantId)
    visiting.delete(grantId)
    visited.add(grantId)
  }
  for (const grant of grants) visit(grant.id)
}

function buildFacts(operators: OperatorDefinition[], sources: readonly FragmentSource[]): ReferenceFacts {
  const sourceRooms = sources.map((source) => source.room)
  if (!sameSet([...REFERENCE_ROOMS], sourceRooms)) {
    throw new FactsParseError('设施分片集合不完整或存在重复')
  }

  const fragments = sources.map(({ room, sourceText }) => ({
    ...parseSkillFragment(room, sourceText, operators),
    sourceText,
  }))
  const grants = fragments.flatMap((fragment) => fragment.grants)
  const grantIds = new Set<string>()
  for (const grant of grants) {
    if (grantIds.has(grant.id)) throw new FactsParseError(`全量事实出现重复 grant：${grant.id}`)
    grantIds.add(grant.id)
  }
  validateReplacementGraph(grants)

  const factsById = new Map<string, SkillFact>()
  for (const fragment of fragments) {
    for (const fact of fragment.skillFacts) {
      const existing = factsById.get(fact.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(fact)) {
        throw new FactsParseError(`全量事实出现冲突 SkillFact：${fact.id}`)
      }
      factsById.set(fact.id, fact)
    }
  }

  const roomsByOperator = new Map<string, Set<string>>()
  for (const fragment of fragments) {
    for (const grant of fragment.grants) {
      const rooms = roomsByOperator.get(grant.operatorId) ?? new Set<string>()
      rooms.add(fragment.room)
      roomsByOperator.set(grant.operatorId, rooms)
    }
  }
  for (const operator of operators) {
    const derivedRooms = [...(roomsByOperator.get(operator.id) ?? [])]
    if (!sameSet(operator.declaredRooms, derivedRooms)) {
      throw new FactsParseError(`干员设施集合与 grant 不一致：${operator.canonical}`)
    }
  }

  return {
    operators,
    fragments,
    skillFacts: [...factsById.values()],
    grants,
  }
}

/** 从已读取的名册和设施源文本构建全量事实，便于测试时注入文本。 */
export function parseReferenceFacts(nameListText: string, sources: readonly FragmentSource[]): ReferenceFacts {
  return buildFacts(parseOperatorRoster(nameListText), sources)
}

/** 从仓库根读取名册和 9 个技能分片（knowledge/raw 下的机械真源），并执行全量门禁。 */
export function loadReferenceFacts(root: string): ReferenceFacts {
  const rawDir = join(root, 'knowledge', 'raw')
  let nameListText: string
  try {
    nameListText = readFileSync(join(rawDir, '名册.md'), 'utf-8')
  } catch {
    throw new FactsParseError('无法读取真源名册：knowledge/raw/名册.md')
  }

  const sources: FragmentSource[] = []
  for (const room of REFERENCE_ROOMS) {
    try {
      sources.push({ room, sourceText: readFileSync(join(rawDir, `技能-${room}.md`), 'utf-8') })
    } catch {
      throw new FactsParseError(`无法读取真源技能分片：knowledge/raw/技能-${room}.md`)
    }
  }
  return parseReferenceFacts(nameListText, sources)
}
