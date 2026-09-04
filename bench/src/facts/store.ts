/**
 * 运行时记录卡内存 store + 检索索引（plan 步骤 5）。
 *
 * 运行时以最终门禁通过的全量 RecordCard 为源；fixture 只保留为回归基线。
 * lookup 返回命中卡列表（合称/子串消歧后置，仅支持单指标签精确命中）；
 * query_operators 做分类过滤（含 termQuery 字面子串）。不做落盘、不做来源标注。
 */
import type { RecordCard } from './card.js'
import { loadValidatedRecordCards } from './final.js'

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
  lookup: (term: string) => RecordCard[]
  queryOperators: (filters: OperatorFilters) => RecordCard[]
}

export interface CardSerializationFilters {
  room?: string
  termQuery?: string
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

/** 从记录卡数组构建检索 store（索引 + 查询函数） */
export function buildCardStore(cards: RecordCard[]): CardStore {
  const byCanonical = new Map<string, RecordCard>()
  const byAlias = new Map<string, string[]>()
  const byTerm = new Map<string, Set<string>>()

  for (const card of cards) {
    if (!card.canonical) throw new Error('记录卡 canonical 不能为空')
    if (byCanonical.has(card.canonical)) throw new Error(`记录卡 canonical 重复：${card.canonical}`)
    byCanonical.set(card.canonical, card)
    addTerm(byTerm, card.canonical, card.canonical)
    for (const alias of card.aliases) {
      addTerm(byTerm, alias, card.canonical)
      const list = byAlias.get(alias) ?? []
      list.push(card.canonical)
      byAlias.set(alias, list)
    }
    for (const skill of card.skills) {
      addTerm(byTerm, skill.name, card.canonical)
      for (const equivalenceName of skill.equivalenceSkillNames ?? []) addTerm(byTerm, equivalenceName, card.canonical)
    }
    for (const group of card.skillGroups) addTerm(byTerm, group, card.canonical)
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

  return { cards, byCanonical, byAlias, byTerm, lookup, queryOperators }
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

/** 渲染命中卡列表为工具结果文本（单卡限额 1KB，摘要 + 技能效果原文） */
export function serializeCards(cards: RecordCard[], filters: CardSerializationFilters = {}): string {
  if (cards.length === 0) return '（无匹配记录卡）'
  return cards.map((card) => serializeCard(card, filters)).join('\n\n')
}

function serializeCard(card: RecordCard, filters: CardSerializationFilters): string {
  const scopedSkills = skillsInRoom(card, filters.room)
  const q = (filters.termQuery ?? '').trim()
  const matchingSkills = q
    ? scopedSkills.filter((skill) => skillMatchesTerm(skill, q))
    : scopedSkills
  const skills = q && matchingSkills.length > 0 ? matchingSkills : scopedSkills
  const lines = [
    `【${card.canonical}】${card.rarity}星·${card.class}｜设施：${card.rooms.join('、')}｜阵营：${card.factionGroups.join('、') || '无'}`,
  ]
  for (const skill of skills) {
    const note = skill.notes === undefined ? '' : `；备注：${skill.notes}`
    lines.push(`- ${skill.unlockType}「${skill.name}」：${skill.effectText}${note}`)
  }
  if (card.skillGroups.length > 0) lines.push(`技能组：${card.skillGroups.join('、')}`)
  if (card.notes) lines.push(`备注：${card.notes}`)
  const text = lines.join('\n')
  return text.length > 1000 ? `${text.slice(0, 999)}…` : text
}

let singleton: CardStore | undefined

/** 运行时卡 store 单例（模块级惰性；首次调用时执行全量门禁） */
export function getCardStore(): CardStore {
  if (!singleton) singleton = buildCardStore(loadValidatedRecordCards(process.cwd(), 'curated'))
  return singleton
}
