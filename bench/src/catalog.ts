/**
 * 查询 Agent 关键词目录生成器。
 *
 * 机器汇总（九设施、来源标签、类别名称、已登记组合的枚举）从事实真源取得；规范检索词、
 * 能查什么、工具入口与必要范围等人工说明来自 bench/src/facts/curation/catalog.ts。
 * 生成物写入 knowledge/关键词目录.md，随 knowledge/AGENTS.md 一起送达查询 Agent。
 *
 * 模块顶层不读写文件、不发请求；读取时机由调用方显式选择。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REFERENCE_ROOMS, loadReferenceFacts } from './facts/references.js'
import { TERM_CURATIONS } from './facts/curation/terms.js'
import { CATALOG_DESCRIPTIONS, type CatalogDescriptions, type CatalogText } from './facts/curation/catalog.js'

/** 生成物相对仓库根的路径。 */
export const CATALOG_RELATIVE_PATH = 'knowledge/关键词目录.md'

/**
 * TODO(tech-debt) IDX-1：关键词目录约 1.75 万字符，显式开启 injectKeywordCatalog 时随 system prompt 注入，
 * 多类说明文本重复，成本与时延未测量。重启条件：成本或质量试验表明不划算时，评估压缩呈现（合并同类说明、按需展开），
 * 须保持覆盖与入口如实。默认关闭注入（ADR-022 决策 8）不改变本条债务的对象。
 */
/** 生成物首行说明；提醒人工不要手改。 */
export const CATALOG_GENERATED_HEADER =
  '<!-- 本文件由 bench/src/catalog.ts 从事实真源与人工说明生成，请勿手改；重算入口：node dist/cli.js catalog -->'

const CATALOG_LEGEND =
  '> 入口标记：F = facts_search（facts 登记类别已核对；来源标签用 F：tags 按标签反查持有者）；R = rag_search（有语料，未验证召回排名）。干员名与技能名继续走既有精确索引，不在本目录逐项铺开。'

const TABLE_HEADER = '| 检索词 | 能查什么 | 工具入口 | 必要范围 |'
const TABLE_SEPARATOR = '| --- | --- | --- | --- |'

/** 目录固定呈现顺序：设施 → 产物与功能 → 机制条件 → 资源/类别/技能组 → 组合。 */
const CATALOG_SECTIONS: readonly { id: CatalogSectionId; title: string }[] = [
  { id: 'facilities', title: '一、设施' },
  { id: 'products', title: '二、产物与功能' },
  { id: 'mechanisms', title: '三、机制与条件' },
  { id: 'categories', title: '四、资源 · 类别 · 技能组' },
  { id: 'combos', title: '五、已登记组合' },
]

/** 目录区段标识。 */
export type CatalogSectionId = 'facilities' | 'products' | 'mechanisms' | 'categories' | 'combos'

/** 单个设施与该设施的去重来源标签。 */
export interface CatalogRoomTags {
  room: string
  tags: readonly string[]
}

/** 类别.md 的一个来源区段与其中全部名称（保留同名重复条目）。 */
export interface CatalogCategorySection {
  name: string
  names: readonly string[]
}

/** 已登记组合的名称与其正文来源。 */
export interface CatalogComboInput {
  name: string
  source: string
}

/** 生成器输入：机器汇总 + 人工说明。 */
export interface CatalogInputs {
  rooms: readonly CatalogRoomTags[]
  categorySections: readonly CatalogCategorySection[]
  combos: readonly CatalogComboInput[]
  descriptions: CatalogDescriptions
}

/** 目录条目：四要素 + 区段归属与可选分组（设施来源标签、类别来源区段）。 */
export interface CatalogEntry {
  section: CatalogSectionId
  group?: string
  term: string
  provides: string
  entry: string
  scope: string
}

function entryFromText(section: CatalogSectionId, term: string, text: CatalogText, group?: string): CatalogEntry {
  return {
    section,
    ...(group === undefined ? {} : { group }),
    term,
    provides: text.provides,
    entry: text.entry,
    scope: text.scope,
  }
}

/**
 * 展示检索词：规范词与来源标签不同时附注原始来源标签。
 * tags 入口按来源标签精确匹配，不能用规范词代替；只要规范词不等于标签，就显式给出可直接传入的标签值。
 */
function tagTerm(tag: string, text: CatalogText): string {
  const term = text.term ?? tag
  return term === tag ? term : `${term}（来源标签：${tag}）`
}

function assertCoverage(items: readonly string[], descriptions: Readonly<Record<string, unknown>>, missingLabel: string, extraLabel: string): void {
  for (const item of items) {
    if (descriptions[item] === undefined) throw new Error(`${missingLabel}：${item}`)
  }
  for (const key of Object.keys(descriptions)) {
    if (!items.includes(key)) throw new Error(`${extraLabel}：${key}`)
  }
}

/**
 * 合并机器汇总与人工说明，生成目录条目。
 * 覆盖校验不通过（标签/设施缺说明或说明引用不存在对象）时抛中文错误。
 */
export function buildKeywordCatalog(inputs: CatalogInputs): CatalogEntry[] {
  const { descriptions } = inputs
  const roomNames = inputs.rooms.map((room) => room.room)
  assertCoverage(roomNames, descriptions.facilities, '关键词目录缺少设施说明', '关键词目录引用了不存在的设施')

  const distinctTags: string[] = []
  const tagOrder = new Map<string, number>()
  for (const tag of Object.keys(descriptions.tags)) tagOrder.set(tag, tagOrder.size)
  for (const room of inputs.rooms) {
    for (const tag of room.tags) {
      if (distinctTags.includes(tag)) continue
      distinctTags.push(tag)
    }
  }
  assertCoverage(distinctTags, descriptions.tags, '关键词目录缺少来源标签说明', '关键词目录引用了不存在的来源标签')

  const sectionNames = inputs.categorySections.map((section) => section.name)
  assertCoverage(sectionNames, descriptions.categorySections, '关键词目录缺少类别区段说明', '关键词目录引用了不存在的类别区段')

  const categoryNames = new Set(inputs.categorySections.flatMap((section) => section.names))
  for (const key of Object.keys(descriptions.categoryOverrides ?? {})) {
    if (!categoryNames.has(key)) throw new Error(`关键词目录引用了不存在的类别名：${key}`)
  }

  const entries: CatalogEntry[] = []
  for (const room of inputs.rooms) {
    const text = descriptions.facilities[room.room]
    entries.push(entryFromText('facilities', text.term ?? room.room, text))
  }
  for (const room of inputs.rooms) {
    const tags = [...room.tags].sort((a, b) => (tagOrder.get(a) ?? 0) - (tagOrder.get(b) ?? 0))
    for (const tag of tags) {
      const text = descriptions.tags[tag]
      const override = text.roomOverrides?.[room.room]
      const merged: CatalogText = override === undefined ? text : { ...text, ...override }
      entries.push(entryFromText('facilities', tagTerm(tag, merged), merged, `来源标签 · ${room.room}`))
    }
  }
  for (const item of descriptions.products) entries.push(entryFromText('products', item.term, item))
  for (const item of descriptions.mechanisms) entries.push(entryFromText('mechanisms', item.term, item))
  for (const section of inputs.categorySections) {
    const text = descriptions.categorySections[section.name]
    for (const name of section.names) {
      const override = descriptions.categoryOverrides?.[name]
      const merged: CatalogText = override === undefined ? text : { ...text, ...override }
      entries.push(entryFromText('categories', name, merged, section.name))
    }
  }
  for (const combo of inputs.combos) {
    const provides = combo.source === '' ? descriptions.combos.provides : `${descriptions.combos.provides}（正文：${combo.source}）`
    entries.push(entryFromText('combos', combo.name, { ...descriptions.combos, provides }))
  }
  return entries
}

function entryRow(entry: CatalogEntry): string {
  return `| ${entry.term} | ${entry.provides} | ${entry.entry} | ${entry.scope} |`
}

/** 将目录条目渲染为 Markdown；同一区段内按分组切表。 */
export function renderKeywordCatalog(entries: readonly CatalogEntry[]): string {
  const lines: string[] = [CATALOG_GENERATED_HEADER, '', '# 查询关键词目录', '', CATALOG_LEGEND, '']
  for (const section of CATALOG_SECTIONS) {
    const sectionEntries = entries.filter((entry) => entry.section === section.id)
    if (sectionEntries.length === 0) continue
    lines.push(`## ${section.title}`, '')
    let index = 0
    while (index < sectionEntries.length) {
      const group = sectionEntries[index].group
      const chunk: CatalogEntry[] = []
      while (index < sectionEntries.length && sectionEntries[index].group === group) {
        chunk.push(sectionEntries[index])
        index += 1
      }
      if (group !== undefined) lines.push(`### ${group}`, '')
      lines.push(TABLE_HEADER, TABLE_SEPARATOR, ...chunk.map(entryRow), '')
    }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

const CATEGORY_HEADING_PATTERN = /^##\s+(.+?)\s*$/
const CATEGORY_ITEM_PATTERN = /^-\s+\*\*(.+?)\*\*/

/** 解析类别.md 的来源区段与条目名；同名定义按出现次数分别保留。 */
export function parseCategorySections(text: string): CatalogCategorySection[] {
  const sections: { name: string; names: string[] }[] = []
  let current: { name: string; names: string[] } | undefined
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(CATEGORY_HEADING_PATTERN)
    if (heading) {
      current = { name: heading[1].replace(/（\d+\s*条）$/, ''), names: [] }
      sections.push(current)
      continue
    }
    if (current === undefined) continue
    const item = line.match(CATEGORY_ITEM_PATTERN)
    if (item) current.names.push(item[1])
  }
  if (sections.length === 0) throw new Error('关键词目录无法解析类别区段：knowledge/guides/类别.md')
  for (const section of sections) {
    if (section.names.length === 0) throw new Error(`关键词目录类别区段为空：${section.name}`)
  }
  return sections
}

/** 从仓库真源装载生成器输入。 */
export function loadKeywordCatalogInputs(root: string): CatalogInputs {
  const facts = loadReferenceFacts(root)
  const rooms = REFERENCE_ROOMS.map((room) => {
    const seen = new Set<string>()
    const tags: string[] = []
    for (const fact of facts.skillFacts) {
      if (fact.room !== room) continue
      for (const tag of fact.tags) {
        if (seen.has(tag)) continue
        seen.add(tag)
        tags.push(tag)
      }
    }
    return { room, tags }
  })

  let categoryText: string
  try {
    categoryText = readFileSync(join(root, 'knowledge', 'guides', '类别.md'), 'utf-8')
  } catch {
    throw new Error('关键词目录无法读取类别真源：knowledge/guides/类别.md')
  }

  return {
    rooms,
    categorySections: parseCategorySections(categoryText),
    combos: TERM_CURATIONS.combos.map((combo) => ({ name: combo.name, source: combo.evidence[0]?.path ?? '' })),
    descriptions: CATALOG_DESCRIPTIONS,
  }
}

/** 从真源重算目录 Markdown。 */
export function generateKeywordCatalogMarkdown(root: string): string {
  return renderKeywordCatalog(buildKeywordCatalog(loadKeywordCatalogInputs(root)))
}

function truncateCell(value: string | undefined): string {
  const text = value ?? '<缺失>'
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

/** 比对重算结果与入库文件，返回中文差异摘要；完全一致时返回空数组。 */
export function catalogDifference(expected: string, actual: string): string[] {
  const expectedLines = expected.split('\n')
  const actualLines = actual.split('\n')
  const total = Math.max(expectedLines.length, actualLines.length)
  let firstDiff = -1
  let diffCount = 0
  for (let index = 0; index < total; index += 1) {
    if ((expectedLines[index] ?? '') === (actualLines[index] ?? '')) continue
    diffCount += 1
    if (firstDiff < 0) firstDiff = index
  }
  if (diffCount === 0) return []

  const lines = [`关键词目录与入库文件不一致：差异 ${diffCount} 行（入库 ${actualLines.length} 行 / 重算 ${expectedLines.length} 行）`]
  for (let index = firstDiff; index < total && lines.length < 6; index += 1) {
    if ((expectedLines[index] ?? '') === (actualLines[index] ?? '')) continue
    lines.push(`第 ${index + 1} 行：入库「${truncateCell(actualLines[index])}」→ 重算「${truncateCell(expectedLines[index])}」`)
  }
  return lines
}
