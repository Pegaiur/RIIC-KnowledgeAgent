/**
 * references 机械字段解析 + 程序化核对断言（plan 步骤 2）。
 *
 * 机械字段来自「名册.md」行 `- 标准名 | ☆N | 职业 | 设施、设施 | 组、组`；
 * 语义字段由 LLM 转录 + 人工抽检，不在此解析、不参与 0 差异断言。
 */
import type { RecordCard } from './card.js'

/** 从名册.md 单行解析出的机械字段 */
export interface NameRowFields {
  canonical: string
  rarity: string
  class: string
  rooms: string[]
  groups: string[]
}

/**
 * 解析名册.md 一行（`- 标准名 | ☆N | 职业 | 设施、设施 [| 组、组]`）为机械字段。
 * 设施/组用「、」分隔；组列可为空（返回空数组）。
 */
export function parseNameRow(line: string): NameRowFields {
  const parts = line.replace(/^-\s*/, '').trim().split('|').map((s) => s.trim())
  const canonical = parts[0] ?? ''
  const rarity = parts[1] ?? ''
  const class_ = parts[2] ?? ''
  const rooms = (parts[3] ?? '').split('、').map((s) => s.trim()).filter(Boolean)
  const groups = (parts[4] ?? '').split('、').map((s) => s.trim()).filter(Boolean)
  return { canonical, rarity, class: class_, rooms, groups }
}

/**
 * 按标准名从名册.md 全文定位其原始行（`- 标准名 | …`）。
 * canonical 需是「所属组/其他干员名」之外的精确行首匹配，避免子串误配（如「能天使」≠「新约能天使」）。
 * 返回去掉行首 `- ` 前导的原行；未命中返回 null。
 */
export function findNameRow(nameListText: string, canonical: string): string | null {
  const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^-\\s*${escaped}\\s*\\|`)
  for (const line of nameListText.split(/\r?\n/)) {
    if (re.test(line)) return line.trim()
  }
  return null
}

/** 程序化核对断言结果（ok=false 即「未过、打回」；mismatches 供人工定位） */
export interface VerificationResult {
  ok: boolean
  mismatches: string[]
}

/**
 * 程序化核对断言：机械字段（canonical/rarity/class/rooms/groups）须逐字出现在 references 原行，0 差异。
 * 单一实现双消费（转录核对 + 后续复用）；语义字段不在本断言范围内。
 */
export function verifyMechanicalCard(card: RecordCard, sourceLine: string): VerificationResult {
  const mismatches: string[] = []
  if (!card.canonical || !sourceLine.includes(card.canonical)) mismatches.push(`canonical：${card.canonical || '(空)'}`)
  if (!card.rarity || !sourceLine.includes(card.rarity)) mismatches.push(`rarity：${card.rarity || '(空)'}`)
  if (!card.class || !sourceLine.includes(card.class)) mismatches.push(`class：${card.class || '(空)'}`)
  for (const room of card.rooms) {
    if (!sourceLine.includes(room)) mismatches.push(`rooms：${room}`)
  }
  for (const group of card.groups) {
    if (!sourceLine.includes(group)) mismatches.push(`groups：${group}`)
  }
  return { ok: mismatches.length === 0, mismatches }
}
