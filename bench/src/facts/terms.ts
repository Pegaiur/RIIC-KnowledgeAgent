import type { RecordCard } from './card.js'

export type OperatorRef = `operator:${string}`
export type ComboRef = `combo:${string}`

export interface EvidenceRef {
  path: string
  section: string
}

export type MemberRole = 'core' | 'important' | 'secondary' | 'support' | 'optional'

export interface ComboMember {
  target: OperatorRef
  role: MemberRole
}

export interface AliasEntry {
  text: string
  targets: readonly OperatorRef[]
  evidence: readonly EvidenceRef[]
}

export interface ComboEntry {
  id: ComboRef
  name: string
  members: readonly ComboMember[]
  conditions: readonly string[]
  coverage: 'listed' | 'open'
  openScope?: string
  evidence: readonly EvidenceRef[]
}

export type LegacyEntry =
  | { text: string; action: 'redirect'; target: ComboRef; evidence: readonly EvidenceRef[] }
  | { text: string; action: 'reject'; reason: string; evidence: readonly EvidenceRef[] }

export interface TermCurations {
  aliases: readonly AliasEntry[]
  combos: readonly ComboEntry[]
  legacyNames: readonly LegacyEntry[]
}

/**
 * 校验后的登记数据仍保持声明式结构，供 store 建立运行时索引。
 * 校验器只接收显式卡片与登记，不读取文件或依赖单例。
 */
export type ValidatedTermCurations = Readonly<TermCurations>

const MEMBER_ROLES: readonly MemberRole[] = ['core', 'important', 'secondary', 'support', 'optional']

function fail(message: string): never {
  throw new Error(`事实词条登记失败：${message}`)
}

function assertTrimmedNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label}不能为空`)
  if (value !== value.trim()) fail(`${label}必须已去除首尾空白`)
}

function assertEvidence(evidence: readonly EvidenceRef[], label: string): void {
  if (!Array.isArray(evidence) || evidence.length === 0) fail(`${label}至少需要一条来源`)
  const seen = new Set<string>()
  for (const item of evidence) {
    assertTrimmedNonEmpty(item?.path, `${label}来源路径`)
    assertTrimmedNonEmpty(item?.section, `${label}来源小节`)
    if (item.path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(item.path)) {
      fail(`${label}来源路径必须是仓库相对路径`)
    }
    const key = `${item.path}\u0000${item.section}`
    if (seen.has(key)) fail(`${label}来源重复：${item.path}#${item.section}`)
    seen.add(key)
  }
}

function assertOperatorRef(value: unknown, label: string, cards: ReadonlyMap<string, RecordCard>): asserts value is OperatorRef {
  assertTrimmedNonEmpty(value, label)
  if (!value.startsWith('operator:') || value.length === 'operator:'.length) fail(`${label}必须是 operator:<规范名>`)
  const canonical = value.slice('operator:'.length)
  if (!cards.has(canonical)) fail(`${label}悬空：${canonical}`)
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) fail(`${label}重复：${value}`)
    seen.add(value)
  }
}

function assertTextEntry(entry: { text: string; evidence: readonly EvidenceRef[] }, label: string): void {
  assertTrimmedNonEmpty(entry.text, `${label}名称`)
  assertEvidence(entry.evidence, label)
}

/** 校验别名、搭配和旧称登记；不把跨索引同名当作冲突。 */
export function validateTermCurations(cards: readonly RecordCard[], data: TermCurations): ValidatedTermCurations {
  if (!Array.isArray(data.aliases) || !Array.isArray(data.combos) || !Array.isArray(data.legacyNames)) {
    fail('登记数据缺少 aliases、combos 或 legacyNames 数组')
  }
  const cardsByCanonical = new Map<string, RecordCard>()
  for (const card of cards) {
    if (!card.canonical) fail('校验输入存在空 canonical')
    if (cardsByCanonical.has(card.canonical)) fail(`校验输入 canonical 重复：${card.canonical}`)
    cardsByCanonical.set(card.canonical, card)
  }

  const aliasTexts = data.aliases.map((entry) => entry.text)
  assertUnique(aliasTexts, '别名名称')
  for (const entry of data.aliases) {
    assertTextEntry(entry, '别名')
    if (!Array.isArray(entry.targets) || entry.targets.length === 0) fail(`别名 ${entry.text} 至少需要一个目标`)
    assertUnique(entry.targets as readonly string[], `别名 ${entry.text}目标`)
    for (const target of entry.targets) assertOperatorRef(target, `别名 ${entry.text}目标`, cardsByCanonical)
  }

  const comboNames = data.combos.map((entry) => entry.name)
  const comboIds = data.combos.map((entry) => entry.id)
  assertUnique(comboNames, '搭配名称')
  assertUnique(comboIds, '搭配 ID')
  const comboById = new Map<ComboRef, ComboEntry>()
  for (const entry of data.combos) {
    assertTrimmedNonEmpty(entry.name, '搭配名称')
    assertTrimmedNonEmpty(entry.id, `搭配 ${entry.name} ID`)
    if (entry.id !== `combo:${entry.name}`) fail(`搭配 ${entry.name} ID必须等于 combo:${entry.name}`)
    if (!Array.isArray(entry.members) || entry.members.length === 0) fail(`搭配 ${entry.name}至少需要一个成员`)
    const members = entry.members as readonly ComboMember[]
    const memberTargets = members.map((member) => member.target)
    assertUnique(memberTargets as readonly string[], `搭配 ${entry.name}成员`)
    for (const member of members) {
      assertOperatorRef(member.target, `搭配 ${entry.name}成员`, cardsByCanonical)
      if (!MEMBER_ROLES.includes(member.role)) fail(`搭配 ${entry.name}成员角色无效：${String(member.role)}`)
    }
    if (!Array.isArray(entry.conditions) || entry.conditions.length === 0) fail(`搭配 ${entry.name}至少需要一条条件`)
    for (const condition of entry.conditions) assertTrimmedNonEmpty(condition, `搭配 ${entry.name}条件`)
    if (entry.coverage !== 'listed' && entry.coverage !== 'open') fail(`搭配 ${entry.name} coverage 无效`)
    if (entry.coverage === 'open') assertTrimmedNonEmpty(entry.openScope, `搭配 ${entry.name}开放范围`)
    if (entry.coverage === 'listed' && entry.openScope !== undefined) fail(`搭配 ${entry.name}为 listed 时不能填写开放范围`)
    assertEvidence(entry.evidence, `搭配 ${entry.name}`)
    comboById.set(entry.id, entry)
  }

  const legacyTexts = data.legacyNames.map((entry) => entry.text)
  assertUnique(legacyTexts, '旧称名称')
  for (const entry of data.legacyNames) {
    assertTextEntry(entry, '旧称')
    if (entry.action === 'redirect') {
      assertTrimmedNonEmpty(entry.target, `旧称 ${entry.text}目标`)
      if (!entry.target.startsWith('combo:') || !comboById.has(entry.target)) {
        fail(`旧称 ${entry.text}必须直接指向已登记搭配`)
      }
    } else if (entry.action === 'reject') {
      assertTrimmedNonEmpty(entry.reason, `旧称 ${entry.text}拒绝理由`)
    } else {
      fail(`旧称 ${entry.text}处置动作无效`)
    }
  }

  return data
}

export const EMPTY_TERM_CURATIONS: ValidatedTermCurations = {
  aliases: [],
  combos: [],
  legacyNames: [],
}
