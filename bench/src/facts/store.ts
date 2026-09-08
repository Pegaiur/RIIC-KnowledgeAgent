/**
 * 运行时记录卡内存 store + 检索索引（plan 步骤 5）。
 *
 * 运行时以最终门禁通过的全量 RecordCard 为源；fixture 只保留为回归基线。
 * factsSearch 返回六类规范词条的精确并集；lookup/queryOperators 仅供旧数据调用者和历史回归使用。
 * 不做落盘、不做自然语言解析、不做模糊或子串兜底。
 */
import type { RecordCard } from './card.js'
import { loadValidatedRecordCards } from './final.js'

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
 * TODO(tech-debt) R5-2：历史 lookup 的别名、合称与子串消歧仍未接入独立真源；
 * 待建立别名/合称真源并完成歧义核对后，再决定是否恢复旧数据调用者的多卡解析能力。
 */

export interface FactsMatch {
  card: RecordCard
  categories: FactsMatchCategory[]
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
  /** 当前 facts 对外入口：六类词条精确命中后按卡稳定去重。 */
  factsSearch: (query: string) => FactsMatch[]
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
export function buildCardStore(cards: RecordCard[]): CardStore {
  const byCanonical = new Map<string, RecordCard>()
  const byAlias = new Map<string, string[]>()
  const byTerm = new Map<string, Set<string>>()
  const byFactTerm = new Map<string, Map<FactsMatchCategory, Set<string>>>()

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

  /** facts_search：一个完整词条的精确并集；同卡跨类别只返回一次。 */
  const factsSearch = (query: string): FactsMatch[] => {
    const term = (query ?? '').trim()
    if (!term) return []
    const categories = byFactTerm.get(term)
    if (!categories) return []
    return cards.flatMap((card) => {
      const matched = FACTS_MATCH_CATEGORY_ORDER.filter((category) => categories.get(category)?.has(card.canonical))
      return matched.length > 0 ? [{ card, categories: matched }] : []
    })
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

/** 渲染当前 facts_search 的完整卡结果，并保留每张卡的精确命中依据。 */
export function serializeFactsMatches(query: string, matches: FactsMatch[]): string {
  const term = query.trim()
  if (matches.length === 0) return `未收录精确词条：${term}`
  const categories = FACTS_MATCH_CATEGORY_ORDER.filter((category) => matches.some((match) => match.categories.includes(category)))
    .map((category) => FACTS_MATCH_CATEGORY_LABEL[category])
  const header = `精确词条：${term}\n匹配说明：命中 ${matches.length} 张记录卡；命中类别包括：${categories.join('、')}。以下为完整记录卡。`
  const content = matches.map((match) => serializeCard(match.card, {}, match.categories)).join('\n\n')
  return `${header}\n${content}`
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
  if (!singleton) singleton = buildCardStore(loadValidatedRecordCards(process.cwd(), 'curated'))
  return singleton
}
