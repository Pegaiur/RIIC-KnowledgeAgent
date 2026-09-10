/**
 * 运行时记录卡内存 store + 检索索引（plan 步骤 5）。
 *
 * 运行时以最终门禁通过的全量 RecordCard 为源；fixture 只保留为回归基线。
 * factsSearch 返回六类规范词条与人工登记入口的查询级结果；lookup/queryOperators 仅供旧数据调用者和历史回归使用。
 * 不做落盘、不做自然语言解析、不做模糊或子串兜底。
 */
import type { RecordCard } from './card.js'
import { TERM_CURATIONS } from './curation/terms.js'
import { loadValidatedRecordCards } from './final.js'
import {
  EMPTY_TERM_CURATIONS,
  validateTermCurations,
  type AliasEntry,
  type ComboEntry,
  type EvidenceRef,
  type LegacyEntry,
  type OperatorRef,
  type SubstringEntry,
  type TermCurations,
} from './terms.js'

export type FactsMatchCategory = 'operator' | 'skill' | 'skillGroup' | 'room' | 'faction' | 'class'

export const FACTS_MATCH_CATEGORY_ORDER: readonly FactsMatchCategory[] = [
  'operator', 'skill', 'skillGroup', 'room', 'faction', 'class',
]

export const FACTS_MATCH_CATEGORY_LABEL: Record<FactsMatchCategory, string> = {
  operator: '干员正式名',
  skill: '技能',
  skillGroup: '技能组',
  room: '设施',
  faction: '阵营',
  class: '职业',
}

/**
 * TODO(tech-debt) R5-2：历史 lookup 仍未迁移到 facts 词条登记；
 * 待另行决策并完成旧调用者兼容核对后，再决定是否恢复其别名、合称与子串解析能力。
 */

export interface FactsMatch {
  card: RecordCard
  categories: FactsMatchCategory[]
}

export type ResolutionPath =
  | { kind: 'exact'; category: FactsMatchCategory; term: string; memberIds: string[] }
  | { kind: 'alias'; term: string; targets: OperatorRef[]; memberIds: string[]; evidence: EvidenceRef[] }
  | { kind: 'substring'; term: string; targets: OperatorRef[]; memberIds: string[]; evidence: EvidenceRef[] }
  | { kind: 'combo'; term: string; combo: ComboEntry; memberIds: string[] }
  | { kind: 'legacy'; term: string; combo: ComboEntry; memberIds: string[]; evidence: EvidenceRef[] }
  | { kind: 'rejected'; term: string; reason: string; evidence: EvidenceRef[]; memberIds: [] }

export interface FactsSearchResult {
  query: string
  paths: ResolutionPath[]
  matches: FactsMatch[]
}

/** query_operators 过滤条件（正向条件由派发层校验；不含数值 minEff / 效率排序） */
export interface OperatorFilters {
  room?: string
  faction?: string
  profession?: string
  /** 按 canonical 排除 */
  excludeIds?: string[]
  /** 终止词：对 name/target/effectText/notes/aliases 字面子串 */
  termQuery?: string
}

/** 记录卡检索 store */
export interface CardStore {
  cards: RecordCard[]
  /** canonical → 卡 */
  byCanonical: Map<string, RecordCard>
  /** 单目标别名 → canonical[]（当前 fixtures aliases=[]，结构就绪） */
  byAlias: Map<string, string[]>
  /** 检索词 → canonical[]（canonical / aliases / skills[].name / skillGroups） */
  byTerm: Map<string, Set<string>>
  /** 统一 facts 词条 → 各命中类别 → canonical 集合；不含别名、备注或全文。 */
  byFactTerm: Map<string, Map<FactsMatchCategory, Set<string>>>
  /** 当前 facts 对外入口：六类词条与人工登记入口全部命中，按卡稳定去重。 */
  factsSearch: (query: string) => FactsSearchResult
  lookup: (term: string) => RecordCard[]
  queryOperators: (filters: OperatorFilters) => RecordCard[]
}

export interface CardSerializationFilters {
  room?: string
  termQuery?: string
  /** 标记 query_operators 输出，以加入卡级属性与技能投影范围说明。 */
  queryOperators?: boolean
}

function addTerm(byTerm: Map<string, Set<string>>, term: string, canonical: string): void {
  if (!term) return
  let set = byTerm.get(term)
  if (!set) {
    set = new Set()
    byTerm.set(term, set)
  }
  set.add(canonical)
}

function addFactTerm(
  byFactTerm: Map<string, Map<FactsMatchCategory, Set<string>>>,
  term: string,
  category: FactsMatchCategory,
  canonical: string,
): void {
  if (!term) return
  let categories = byFactTerm.get(term)
  if (!categories) {
    categories = new Map()
    byFactTerm.set(term, categories)
  }
  let canonicals = categories.get(category)
  if (!canonicals) {
    canonicals = new Set()
    categories.set(category, canonicals)
  }
  canonicals.add(canonical)
}

/** 从记录卡数组构建检索 store（索引 + 查询函数） */
export function buildCardStore(cards: RecordCard[], terms: TermCurations = EMPTY_TERM_CURATIONS): CardStore {
  const byCanonical = new Map<string, RecordCard>()
  const byAlias = new Map<string, string[]>()
  const byTerm = new Map<string, Set<string>>()
  const byFactTerm = new Map<string, Map<FactsMatchCategory, Set<string>>>()
  const aliasesByTerm = new Map<string, AliasEntry[]>()
  const substringsByTerm = new Map<string, SubstringEntry>()
  const combosByTerm = new Map<string, ComboEntry>()
  const combosById = new Map<string, ComboEntry>()
  const legacyByTerm = new Map<string, LegacyEntry[]>()

  for (const card of cards) {
    if (!card.canonical) throw new Error('记录卡 canonical 不能为空')
    if (byCanonical.has(card.canonical)) throw new Error(`记录卡 canonical 重复：${card.canonical}`)
    byCanonical.set(card.canonical, card)
    addTerm(byTerm, card.canonical, card.canonical)
    addFactTerm(byFactTerm, card.canonical, 'operator', card.canonical)
    for (const alias of card.aliases) {
      addTerm(byTerm, alias, card.canonical)
      const list = byAlias.get(alias) ?? []
      list.push(card.canonical)
      byAlias.set(alias, list)
    }
    for (const skill of card.skills) {
      addTerm(byTerm, skill.name, card.canonical)
      addFactTerm(byFactTerm, skill.name, 'skill', card.canonical)
      for (const equivalenceName of skill.equivalenceSkillNames ?? []) {
        addTerm(byTerm, equivalenceName, card.canonical)
        addFactTerm(byFactTerm, equivalenceName, 'skill', card.canonical)
      }
    }
    for (const group of card.skillGroups) {
      addTerm(byTerm, group, card.canonical)
      addFactTerm(byFactTerm, group, 'skillGroup', card.canonical)
    }
    for (const room of card.rooms) addFactTerm(byFactTerm, room, 'room', card.canonical)
    for (const faction of card.factionGroups) addFactTerm(byFactTerm, faction, 'faction', card.canonical)
    addFactTerm(byFactTerm, card.class, 'class', card.canonical)
  }

  const validatedTerms = validateTermCurations(cards, terms)
  for (const alias of validatedTerms.aliases) aliasesByTerm.set(alias.text, [alias])
  for (const substring of validatedTerms.substrings) substringsByTerm.set(substring.text, substring)
  for (const combo of validatedTerms.combos) {
    combosByTerm.set(combo.name, combo)
    combosById.set(combo.id, combo)
  }
  for (const legacy of validatedTerms.legacyNames) {
    const entries = legacyByTerm.get(legacy.text) ?? []
    entries.push(legacy)
    legacyByTerm.set(legacy.text, entries)
  }

  /** facts_search：精确、别名、子串、搭配和旧称路径全部收集；同卡只返回一次。 */
  const factsSearch = (query: string): FactsSearchResult => {
    const term = (query ?? '').trim()
    if (!term) return { query: term, paths: [], matches: [] }
    const categories = byFactTerm.get(term)
    const memberIdsForTargets = (targets: readonly OperatorRef[]): string[] => {
      const targetCanonicals = new Set(targets.map((target) => target.slice('operator:'.length)))
      return cards.filter((card) => targetCanonicals.has(card.canonical)).map((card) => card.canonical)
    }

    const exactPaths: ResolutionPath[] = []
    for (const category of FACTS_MATCH_CATEGORY_ORDER) {
      const memberIds = cards
        .filter((card) => categories?.get(category)?.has(card.canonical) ?? false)
        .map((card) => card.canonical)
      if (memberIds.length > 0) exactPaths.push({ kind: 'exact', category, term, memberIds })
    }

    const aliasPaths: ResolutionPath[] = []
    for (const alias of aliasesByTerm.get(term) ?? []) {
      aliasPaths.push({
        kind: 'alias',
        term,
        targets: [...alias.targets],
        memberIds: memberIdsForTargets(alias.targets),
        evidence: [...alias.evidence],
      })
    }

    const comboPaths: ResolutionPath[] = []
    const combo = combosByTerm.get(term)
    if (combo) {
      comboPaths.push({
        kind: 'combo',
        term,
        combo,
        memberIds: memberIdsForTargets(combo.members.map((member) => member.target)),
      })
    }

    const legacyPaths: ResolutionPath[] = []
    const rejectedPaths: ResolutionPath[] = []
    for (const legacy of legacyByTerm.get(term) ?? []) {
      if (legacy.action === 'redirect') {
        const target = combosById.get(legacy.target)
        if (target !== undefined) {
          legacyPaths.push({
            kind: 'legacy',
            term,
            combo: target,
            memberIds: memberIdsForTargets(target.members.map((member) => member.target)),
            evidence: [...legacy.evidence],
          })
        }
      } else {
        rejectedPaths.push({ kind: 'rejected', term, reason: legacy.reason, evidence: [...legacy.evidence], memberIds: [] })
      }
    }

    // 子串路径是否产出取决于同查询其它路径的成员并集，因此最后判定，再按固定顺序并入。
    const nonSubstringPaths = [...exactPaths, ...aliasPaths, ...comboPaths, ...legacyPaths, ...rejectedPaths]
    const substringPaths: ResolutionPath[] = []
    const substring = substringsByTerm.get(term)
    if (substring) {
      const covered = new Set(nonSubstringPaths.flatMap((path) => path.memberIds))
      const allCovered = substring.targets.every((target) => covered.has(target.slice('operator:'.length)))
      if (!allCovered) {
        substringPaths.push({
          kind: 'substring',
          term,
          targets: [...substring.targets],
          memberIds: memberIdsForTargets(substring.targets),
          evidence: [...substring.evidence],
        })
      }
    }

    const paths = [...exactPaths, ...aliasPaths, ...substringPaths, ...comboPaths, ...legacyPaths, ...rejectedPaths]
    const matchedIds = new Set(paths.flatMap((path) => path.memberIds))
    const matches = cards.flatMap((card) => {
      if (!matchedIds.has(card.canonical)) return []
      const exactCategories = FACTS_MATCH_CATEGORY_ORDER.filter((category) => categories?.get(category)?.has(card.canonical) ?? false)
      return [{ card, categories: exactCategories }]
    })
    return { query: term, paths, matches }
  }

  /** lookup：精确 term → 命中卡列表（canonical/别名/技能名/技能组 均在 byTerm 统一解析） */
  const lookup = (term: string): RecordCard[] => {
    const t = (term ?? '').trim()
    if (!t) return []
    const canonicals = byTerm.get(t)
    if (!canonicals) return []
    return [...canonicals].map((c) => byCanonical.get(c)).filter((c): c is RecordCard => c !== undefined)
  }

  /** query_operators：分类过滤（含 termQuery 字面子串、excludeIds 按 canonical） */
  const queryOperators = (filters: OperatorFilters): RecordCard[] => {
    const q = (filters.termQuery ?? '').trim()
    const excludeIds = new Set((filters.excludeIds ?? []).map((id) => id.trim()).filter(Boolean))
    return cards.filter((card) => {
      if (filters.room && !card.rooms.includes(filters.room)) return false
      if (filters.faction && !card.factionGroups.includes(filters.faction)) return false
      if (filters.profession && card.class !== filters.profession) return false
      if (excludeIds.has(card.canonical)) return false
      if (q && !matchTermQuery(card, q, filters.room)) return false
      return true
    })
  }

  return { cards, byCanonical, byAlias, byTerm, byFactTerm, factsSearch, lookup, queryOperators }
}

function skillsInRoom(card: RecordCard, room?: string): RecordCard['skills'] {
  if (!room) return card.skills
  return card.skills.filter((skill) => skill.room === room || (
    skill.room === undefined && card.rooms.length === 1 && card.rooms[0] === room
  ))
}

/** termQuery 子串命中：room 存在时只检查该设施技能，卡级字段仍全卡匹配。 */
function matchTermQuery(card: RecordCard, q: string, room?: string): boolean {
  if (card.canonical.includes(q)) return true
  if (card.aliases.some((a) => a.includes(q))) return true
  if (skillsInRoom(card, room).some((skill) => skillMatchesTerm(skill, q))) return true
  const cardScopeSafe = room === undefined || (card.rooms.length === 1 && card.rooms[0] === room)
  if (cardScopeSafe && card.skillGroups.some((g) => g.includes(q))) return true
  return cardScopeSafe && card.notes.includes(q)
}

function skillMatchesTerm(skill: RecordCard['skills'][number], q: string): boolean {
  return skill.name.includes(q)
    || skill.target.includes(q)
    || skill.effectText.includes(q)
    || (skill.notes?.includes(q) ?? false)
    || (skill.skillCategories?.some((category) => category.includes(q)) ?? false)
    || (skill.equivalenceSkillNames?.some((name) => name.includes(q)) ?? false)
}

/** 渲染命中卡列表为工具结果文本；保留全部审定备注和替换关系。 */
export function serializeCards(cards: RecordCard[], filters: CardSerializationFilters = {}): string {
  const content = cards.length === 0
    ? '（无匹配记录卡）'
    : cards.map((card) => serializeCard(card, filters)).join('\n\n')
  return filters.queryOperators ? `${operatorScopeNotice()}\n${content}` : content
}

/** 渲染当前 facts_search 的查询级结果，并保留路径与完整卡片。 */
export function serializeFactsMatches(result: FactsSearchResult): string {
  const term = result.query.trim()
  if (result.paths.length === 0) return `未收录精确词条：${term}`
  const exactPaths = result.paths.filter((path): path is Extract<ResolutionPath, { kind: 'exact' }> => path.kind === 'exact')
  const categories = FACTS_MATCH_CATEGORY_ORDER.filter((category) => exactPaths.some((path) => path.category === category))
    .map((category) => FACTS_MATCH_CATEGORY_LABEL[category])
  if (exactPaths.length === result.paths.length) {
    const header = `精确词条：${term}\n匹配说明：命中 ${result.matches.length} 张记录卡；命中类别包括：${categories.join('、')}。以下为完整记录卡。`
    const content = result.matches.map((match) => serializeCard(match.card, {}, match.categories)).join('\n\n')
    return `${header}\n${content}`
  }
  const pathText = result.paths.map(renderResolutionPath).join('\n')
  const summary = result.matches.length === 0
    ? '匹配说明：本次路径没有可返回的记录卡。'
    : `匹配说明：命中 ${result.matches.length} 张去重后的记录卡；以下为完整记录卡。`
  const content = result.matches.map((match) => serializeCard(match.card, {}, match.categories)).join('\n\n')
  return `词条解析：${term}\n命中路径：\n${pathText}\n${summary}${content ? `\n${content}` : ''}`
}

function renderResolutionPath(path: ResolutionPath): string {
  if (path.kind === 'exact') return `- 精确：${FACTS_MATCH_CATEGORY_LABEL[path.category]}；命中 ${path.memberIds.length} 张记录卡`
  if (path.kind === 'alias') {
    return `- 别名：${path.term} → ${path.targets.map((target) => target.slice('operator:'.length)).join('、')}；来源：${renderEvidence(path.evidence)}；命中 ${path.memberIds.length} 张记录卡`
  }
  if (path.kind === 'substring') {
    return `- 子串：${path.term} → ${path.targets.map((target) => target.slice('operator:'.length)).join('、')}；来源：${renderEvidence(path.evidence)}；命中 ${path.memberIds.length} 张记录卡`
  }
  if (path.kind === 'combo') return renderComboPath('组合', path.term, path.combo, path.memberIds)
  if (path.kind === 'legacy') {
    return `${renderComboPath('旧称', path.term, path.combo, path.memberIds)}；来源：${renderEvidence(path.evidence)}`
  }
  return `- 拒绝：${path.term}；理由：${path.reason}；依据：${renderEvidence(path.evidence)}`
}

function renderComboPath(kind: string, term: string, combo: ComboEntry, memberIds: readonly string[]): string {
  const members = combo.members.map((member) => `${member.target.slice('operator:'.length)}（${memberRoleLabel(member.role)}）`).join('、')
  const coverage = combo.coverage === 'open' ? `开放、非穷尽：${combo.openScope}` : '来源列明成员范围'
  return `- ${kind}：${term} → ${combo.name}；成员：${members}；条件：${combo.conditions.join('；')}；覆盖：${coverage}；来源：${renderEvidence(combo.evidence)}；命中 ${memberIds.length} 张记录卡`
}

function memberRoleLabel(role: ComboEntry['members'][number]['role']): string {
  return { core: '核心', important: '重要', secondary: '次级', support: '挂件', optional: '可选' }[role]
}

function renderEvidence(evidence: readonly EvidenceRef[]): string {
  return evidence.map((item) => `${item.path}#${item.section}`).join('；')
}

function operatorScopeNotice(): string {
  return '查询范围说明：卡头中的设施、阵营、职业，以及技能组和卡级备注属于干员全局属性，不代表当前设施专属；下方技能按本次查询条件投影，未必包含该卡全部技能。'
}

function serializeCard(card: RecordCard, filters: CardSerializationFilters, matchCategories?: FactsMatchCategory[]): string {
  const scopedSkills = skillsInRoom(card, filters.room)
  const q = (filters.termQuery ?? '').trim()
  const matchingSkills = q
    ? scopedSkills.filter((skill) => skillMatchesTerm(skill, q))
    : scopedSkills
  const skills = q && matchingSkills.length > 0 ? matchingSkills : scopedSkills
  const lines = [
    `【${card.canonical}】${card.rarity}星·${card.class}｜设施：${card.rooms.join('、')}｜阵营：${card.factionGroups.join('、') || '无'}`,
  ]
  if (matchCategories && matchCategories.length > 0) {
    lines.push(`匹配类别：${matchCategories.map((category) => FACTS_MATCH_CATEGORY_LABEL[category]).join('、')}`)
  }
  for (const skill of skills) {
    const room = skill.room?.trim() || '未知设施'
    const note = skill.notes === undefined ? '' : `；备注：${skill.notes}`
    const replaced = skill.replacesGrantId === undefined
      ? undefined
      : card.skills.find((candidate) => candidate.grantId === skill.replacesGrantId)
    const replacement = replaced === undefined ? '' : `；替换「${replaced.name}」`
    lines.push(`- 【设施：${room}】${skill.unlockType}「${skill.name}」：${skill.effectText}${replacement}${note}`)
  }
  if (card.skillGroups.length > 0) lines.push(`技能组：${card.skillGroups.join('、')}`)
  if (card.notes) lines.push(`备注：${card.notes}`)
  return lines.join('\n')
}

let singleton: CardStore | undefined

/** 运行时卡 store 单例（模块级惰性；首次调用时执行全量门禁） */
export function getCardStore(): CardStore {
  if (!singleton) singleton = buildCardStore(loadValidatedRecordCards(process.cwd(), 'curated'), TERM_CURATIONS)
  return singleton
}
