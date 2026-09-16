/**
 * read 工具的分页组装（ADR-022 决策 1–3、6）。
 *
 * 同一次装配快照内返回所读范围的原文子树与明确登记的关联事实：两侧各有独立偏移、独立完成状态
 * 与可直接复制的 next_call；元数据、登记来源、正文与卡片分享同一预算，正文每页不超过 6000 UTF-16
 * 字符，事实按完整对象分页。只做文本组装与送达观测，不读盘、不检索，也不改动原文目录、关联索引
 * 与 facts 真源。
 */
import type { ReadBodyRange, ReadDeliveredObject, ReadFactsPage } from './delivery.js'
import { serializeCard, skillProjection, type CardStore } from './facts/store.js'
import { serializeConceptCard, type ProseReadObject } from './prose-links.js'
import type { SectionDirectory, SectionEntry } from './sections.js'

/** 单次 read 的正文页上限（UTF-16 字符，ADR-022 决策 3）。 */
export const READ_BODY_PAGE_CHARS = 6000
/** 导航分区最多列出的小节数。 */
const READ_NAVIGATION_LIMIT = 8

const PART_RANGE = '【阅读范围】'
const PART_PAGE = '【分页】'
const PART_BODY = '【原文】'
const PART_FACTS = '【关联事实】'
const PART_NAV = '【导航】'
const EMPTY_PART = '（无本页内容）'
const OBJECT_SEPARATOR = '\n\n'
/** 组装正文/事实之外的固定开销：分区之间的换行与两个分区标题行。 */
const FIXED_OVERHEAD = 1 + PART_BODY.length + 1 + 1 + PART_FACTS.length + 1

export interface ReadPageInput {
  section: SectionEntry
  directory: SectionDirectory
  /** 该读取范围的最终合并去重对象序列（readObjectsFor 结果） */
  objects: ProseReadObject[]
  /** 记录卡来源；仅当对象序列含卡片引用时提供。 */
  store?: CardStore
  /** 原文正文的 UTF-16 起始索引 */
  offset: number
  /** 关联对象序列的起始下标 */
  factsOffset: number
  maxChars: number
  factsResultVersion: number
}

export interface ReadPageDelivery {
  /** 送达了正文时为范围对象；已观察无正文证据时为 null；无法取得时省略。 */
  bodyRange?: ReadBodyRange | null
  /** 完成了事实分页时为分页计数；无法取得时省略。 */
  factsPage?: ReadFactsPage | null
  /** 实际送达的对象；失败在送达前时省略。 */
  deliveredObjects?: ReadDeliveredObject[]
}

export interface ReadPageResult {
  data: string
  status: 'success' | 'empty' | 'error' | 'invalid_params'
  hitIds: string[]
  injectedIds: string[]
  delivery: ReadPageDelivery
}

/** 分页元数据（ADR-022 决策 2）：字段名与顺序固定，「【分页】」下为单行合法 JSON。 */
interface ReadPageMeta {
  section_id: string
  offset: number
  next_offset: number | null
  body_complete: boolean
  body_total_chars: number
  facts_offset: number
  next_facts_offset: number | null
  facts_complete: boolean
  facts_total: number
  facts_returned: number
  facts_result_version: number
  complete: boolean
  next_call: { name: 'read'; arguments: { section_id: string; offset: number; facts_offset: number } } | null
}

interface RenderedObject {
  text: string
  delivered: ReadDeliveredObject
}

interface Allocation {
  bodyText: string
  factsText: string
  factsCount: number
}

/**
 * 组装一次 read 页。范围校验、容量分配、元数据与 next_call 都在这里确定；
 * 超出可用容量时明确报错，不返回半张卡，也不给出不前进的续读。
 */
export function buildReadPage(input: ReadPageInput): ReadPageResult {
  const { section, directory, store, maxChars } = input
  const bodyTotal = section.body.length
  const factsTotal = input.objects.length

  if (input.offset > bodyTotal) {
    return invalid(`read 的 offset 超出正文长度（${bodyTotal}）：${input.offset}。不会自动截到末尾。`)
  }
  if (isInsideSurrogatePair(section.body, input.offset)) {
    return invalid(`read 的 offset 不能落在 UTF-16 代理对中间：${input.offset}。`)
  }
  if (input.factsOffset > factsTotal) {
    return invalid(`read 的 facts_offset 超出关联对象数（${factsTotal}）：${input.factsOffset}。`)
  }

  const missingRefs = input.objects.flatMap((object) => object.kind === 'card'
    && input.store?.byCanonical.get(object.canonical) === undefined ? [object.canonical] : [])
  if (missingRefs.length > 0) {
    return failed(`read 关联登记引用的记录卡缺失：${missingRefs.join('、')}；不会返回半张卡或其余对象，请核对关联登记与事实真源。`, beforeSendDelivery(input))
  }
  const rendered = input.objects.map((object) => renderReadObject(object, store, directory))

  // 元数据先占预算：用最长可能的数字位数与存在的 next_call 估计上界，页后再序列化验证。
  // 整段能一次读完时不需要为续读预留空间，因此另算一份不含 next_call 的额度作为回退候选。
  const rangeWorst = worstRangeLine(section).length
  const reserve = rangeWorst + worstPageLine(section, bodyTotal, factsTotal, input, true).length + FIXED_OVERHEAD
  const completeReserve = rangeWorst + worstPageLine(section, bodyTotal, factsTotal, input, false).length + FIXED_OVERHEAD
  let availableBudget = maxChars - reserve
  if (availableBudget < 1 && maxChars - completeReserve >= 1) availableBudget = maxChars - completeReserve
  if (availableBudget < 1) return failed(capacityMessage(maxChars, reserve), beforeSendDelivery(input))

  const bodyRemaining = bodyTotal - input.offset
  const factsRemaining = factsTotal - input.factsOffset
  // 尚有事实时，首个待送对象必须整卡放得下；否则本页只会是不可前进的空页。
  const firstFact = factsRemaining > 0 ? rendered[input.factsOffset]! : undefined
  if (firstFact !== undefined && firstFact.text.length > availableBudget) {
    return failed(overCapacityMessage(input, firstFact.text.length, availableBudget), beforeSendDelivery(input))
  }

  let allocation = allocate(rendered, input, availableBudget, factsRemaining, bodyRemaining)
  let core = renderCore(section, input, allocation)
  // 页后重新序列化验证总上限；仅在极窄配置下需要收缩正文，绝不对最终字符串硬切。
  for (let attempt = 0; core.data.length > maxChars && attempt < 4; attempt++) {
    availableBudget -= core.data.length - maxChars
    if (availableBudget < 1) return failed(capacityMessage(maxChars, reserve), beforeSendDelivery(input))
    // 收缩后首个待送对象可能已放不下：必须在分配前重新确认，不能返回没有证据又不前进的页。
    if (firstFact !== undefined && firstFact.text.length > availableBudget) {
      return failed(overCapacityMessage(input, firstFact.text.length, availableBudget), beforeSendDelivery(input))
    }
    allocation = allocate(rendered, input, availableBudget, factsRemaining, bodyRemaining)
    core = renderCore(section, input, allocation)
  }
  if (core.data.length > maxChars) return failed(capacityMessage(maxChars, reserve), beforeSendDelivery(input))
  // 单次成功分页至少推进一个偏移：未完整却两侧都没有新增内容时明确报错，不给原地不动的续读。
  if (!core.meta.complete && allocation.bodyText.length === 0 && allocation.factsCount === 0) {
    return failed(noProgressMessage(maxChars, availableBudget), beforeSendDelivery(input))
  }

  const data = appendNavigation(core.data, navigationLines(section, directory), maxChars)
  const { meta } = core
  const deliveredObjects = rendered
    .slice(input.factsOffset, input.factsOffset + allocation.factsCount)
    .map((item) => item.delivered)
  const hitIds = dedupe(deliveredObjects.flatMap((object) => (object.kind === 'card' ? [object.canonical] : [])))
  const docOffset = documentOffsetFor(section, directory)
  const delivery: ReadPageDelivery = {
    factsPage: {
      offset: input.factsOffset,
      nextOffset: meta.next_facts_offset,
      total: factsTotal,
      returned: allocation.factsCount,
      complete: meta.facts_complete,
    },
    deliveredObjects,
  }
  if (docOffset !== undefined) {
    delivery.bodyRange = allocation.bodyText.length === 0
      ? null
      : {
          file: section.file,
          sectionId: section.sectionId,
          offset: input.offset,
          endOffset: input.offset + allocation.bodyText.length,
          docOffset: docOffset + input.offset,
          docEndOffset: docOffset + input.offset + allocation.bodyText.length,
          startLine: core.startLine,
          endLine: core.endLine,
          complete: meta.body_complete,
        }
  }

  return {
    data,
    status: allocation.bodyText.length > 0 || allocation.factsCount > 0 ? 'success' : 'empty',
    hitIds,
    injectedIds: [...hitIds],
    delivery,
  }
}

/** 用同一次分配结果渲染四个固定分区，并给出对应的分页元数据与行范围。 */
function renderCore(
  section: SectionEntry,
  input: ReadPageInput,
  allocation: Allocation,
): { data: string; meta: ReadPageMeta; startLine: number; endLine: number } {
  const bodyTotal = section.body.length
  const factsTotal = input.objects.length
  const bodyComplete = input.offset + allocation.bodyText.length >= bodyTotal
  const nextOffset = bodyComplete ? null : input.offset + allocation.bodyText.length
  const factsComplete = input.factsOffset + allocation.factsCount >= factsTotal
  const nextFactsOffset = factsComplete ? null : input.factsOffset + allocation.factsCount
  const complete = bodyComplete && factsComplete
  const nextCall: ReadPageMeta['next_call'] = complete
    ? null
    : {
        name: 'read',
        arguments: {
          section_id: section.sectionId,
          // 已读完的一侧用总长度/总对象数，续读另一侧时不重复送达。
          offset: bodyComplete ? bodyTotal : nextOffset!,
          facts_offset: factsComplete ? factsTotal : nextFactsOffset!,
        },
      }
  const meta: ReadPageMeta = {
    section_id: section.sectionId,
    offset: input.offset,
    next_offset: nextOffset,
    body_complete: bodyComplete,
    body_total_chars: bodyTotal,
    facts_offset: input.factsOffset,
    next_facts_offset: nextFactsOffset,
    facts_complete: factsComplete,
    facts_total: factsTotal,
    facts_returned: allocation.factsCount,
    facts_result_version: input.factsResultVersion,
    complete,
    next_call: nextCall,
  }
  const startLine = section.startLine + countNewlines(section.body.slice(0, input.offset))
  const endLine = allocation.bodyText.length === 0 ? startLine - 1 : startLine + countNewlines(allocation.bodyText)
  const data = [
    renderRangeLine(section, { startLine, endLine, empty: allocation.bodyText.length === 0 }),
    renderPageLine(meta),
    `${PART_BODY}\n${allocation.bodyText || EMPTY_PART}`,
    `${PART_FACTS}\n${allocation.factsText || EMPTY_PART}`,
  ].join('\n')
  return { data, meta, startLine, endLine }
}

/** 容量分配：先保下一完整事实，再按剩余额度分配正文与其他完整事实。 */
function allocate(
  rendered: readonly RenderedObject[],
  input: ReadPageInput,
  available: number,
  factsRemaining: number,
  bodyRemaining: number,
): Allocation {
  let bodyText = ''
  if (factsRemaining === 0) {
    // 无待送事实：正文独用可用额度（仍受单页上限约束）。
    bodyText = cutBodyPage(input.section.body, input.offset, Math.min(READ_BODY_PAGE_CHARS, available))
  } else if (bodyRemaining === 0) {
    // 正文已读完：事实独用可用额度。
    bodyText = ''
  } else {
    const firstLength = rendered[input.factsOffset]!.text.length
    const bodyBudget = Math.min(READ_BODY_PAGE_CHARS, available - firstLength - OBJECT_SEPARATOR.length)
    bodyText = bodyBudget > 0 ? cutBodyPage(input.section.body, input.offset, bodyBudget) : ''
  }

  let used = bodyText.length
  let factsText = ''
  let factsCount = 0
  for (let index = input.factsOffset; index < input.objects.length; index++) {
    const text = rendered[index]!.text
    const separator = factsText ? OBJECT_SEPARATOR.length : 0
    // 不跳过前面的对象挑短卡：装不下即停。
    if (used + separator + text.length > available) break
    factsText += `${factsText ? OBJECT_SEPARATOR : ''}${text}`
    used += separator + text.length
    factsCount++
  }
  return { bodyText, factsText, factsCount }
}

/** 正文页：优先完整行，超长单行按字符切，任何切点都不拆 UTF-16 代理对。 */
function cutBodyPage(body: string, offset: number, budget: number): string {
  const slice = body.slice(offset, offset + budget)
  if (offset + slice.length >= body.length) return dropTrailingHighSurrogate(slice)
  const newline = slice.lastIndexOf('\n')
  if (newline > 0) return slice.slice(0, newline)
  return dropTrailingHighSurrogate(slice)
}

function dropTrailingHighSurrogate(text: string): string {
  if (text.length === 0) return text
  const last = text.charCodeAt(text.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text
}

function isInsideSurrogatePair(body: string, offset: number): boolean {
  if (offset <= 0 || offset >= body.length) return false
  const before = body.charCodeAt(offset - 1)
  const after = body.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

function renderRangeLine(section: SectionEntry, page: { startLine: number; endLine: number; empty: boolean }): string {
  const path = section.level === 0 && section.heading === ''
    ? '（文档根节点）'
    : [...section.ancestors, section.heading].join(' > ')
  const lineRange = page.empty ? '无' : `L${page.startLine}-${page.endLine}`
  return `${PART_RANGE}${section.file}｜标题路径：${path}｜section_id：${section.sectionId}｜原文行范围：${lineRange}`
}

function renderPageLine(meta: ReadPageMeta): string {
  return `${PART_PAGE}${JSON.stringify(meta)}`
}

/** 上界估计：所有数字按最大位数；withNextCall 决定是否为续读调用预留（实际只会更短）。 */
function worstPageLine(
  section: SectionEntry,
  bodyTotal: number,
  factsTotal: number,
  input: ReadPageInput,
  withNextCall: boolean,
): string {
  const digits = Math.max(1, String(Math.max(bodyTotal, factsTotal)).length)
  const big = Number('9'.repeat(digits))
  return renderPageLine({
    section_id: section.sectionId,
    offset: input.offset,
    next_offset: withNextCall ? big : null,
    body_complete: !withNextCall,
    body_total_chars: bodyTotal,
    facts_offset: input.factsOffset,
    next_facts_offset: withNextCall ? big : null,
    facts_complete: !withNextCall,
    facts_total: factsTotal,
    facts_returned: big,
    facts_result_version: input.factsResultVersion,
    complete: !withNextCall,
    next_call: withNextCall
      ? { name: 'read', arguments: { section_id: section.sectionId, offset: big, facts_offset: big } }
      : null,
  })
}

function worstRangeLine(section: SectionEntry): string {
  const lastLine = section.startLine + countNewlines(section.body)
  return renderRangeLine(section, { startLine: section.startLine, endLine: lastLine, empty: false })
}

/** 导航分区：直接父级范围入口与同级/子小节导航；只用余量，整行保留 ID，按行裁减并记录省略数。 */
function navigationLines(section: SectionEntry, directory: SectionDirectory): { lines: string[]; omitted: number } {
  const lines: string[] = []
  const parentLine = renderParentRangeLine(section, directory)
  if (parentLine) lines.push(parentLine)
  // 同小节导航上限截断的条目同样属于「省略」，不只统计预算放不下的行。
  const navigation = directory.navigationFor(section.sectionId, READ_NAVIGATION_LIMIT)
  for (const item of navigation.items) {
    lines.push(`- ${item.sectionId}｜${item.heading}`)
  }
  return { lines, omitted: navigation.omitted }
}

function appendNavigation(
  data: string,
  navigation: { lines: readonly string[]; omitted: number },
  maxChars: number,
): string {
  if (navigation.lines.length === 0) return data
  const overhead = 1 + PART_NAV.length + 1
  const remaining = maxChars - data.length - overhead
  if (remaining <= 0) return data
  const total = navigation.lines.length + navigation.omitted
  const tailFor = (keptCount: number): string => {
    const omitted = total - keptCount
    return omitted > 0 ? `\n（省略 ${omitted} 项）` : ''
  }
  const kept: string[] = []
  let used = 0
  for (const line of navigation.lines) {
    const added = (kept.length > 0 ? 1 : 0) + line.length
    if (used + added + tailFor(kept.length + 1).length > remaining) break
    kept.push(line)
    used += added
  }
  if (kept.length === 0) return data
  return `${data}\n${PART_NAV}\n${kept.join('\n')}${tailFor(kept.length)}`
}

/** 直接父级范围入口：完整 ID、文件、标题路径与正文长度；无父级返回 null，不虚造。 */
function renderParentRangeLine(section: SectionEntry, directory: SectionDirectory): string | null {
  if (!section.parentId) return null
  const parent = directory.get(section.parentId)
  if (!parent) return null
  const path = [...parent.ancestors, parent.heading].join(' > ')
  return `父级范围：${parent.sectionId}｜${parent.file}｜标题路径：${path}｜正文 ${parent.body.length} 字符（包含下级小节的原文范围）`
}

/** 登记来源的可读定位：优先文件＋标题路径；同文件同标题路径的重复标题附出现序号，避免显示时合并。 */
function originLocation(directory: SectionDirectory, sectionId: string): string {
  const section = directory.get(sectionId)
  if (!section) return sectionId
  const headingPath = sectionHeadingPath(section)
  const path = headingPath.length === 0 ? '（文档根节点）' : headingPath.join(' > ')
  const duplicated = directory.sections.filter(
    (candidate) => candidate.file === section.file && sameHeadingPath(candidate, headingPath),
  ).length > 1
  return duplicated
    ? `${section.file}#${path}（出现序号 ${section.occurrence}）`
    : `${section.file}#${path}`
}

/** 小节的标题路径（H1→当前标题；文档根为空数组）。 */
function sectionHeadingPath(section: SectionEntry): string[] {
  return section.level === 0 ? [] : [...section.ancestors, section.heading]
}

function sameHeadingPath(section: SectionEntry, headingPath: readonly string[]): boolean {
  const candidate = sectionHeadingPath(section)
  return candidate.length === headingPath.length && candidate.every((part, index) => part === headingPath[index])
}

/** 该对象的全部登记来源随对象一起送入模型（ADR-022 决策 4、6）；来源文本同样计入本页容量。 */
function renderOriginLine(object: ProseReadObject, directory: SectionDirectory): string {
  const sectionIds = dedupe(object.origins.map((origin) => origin.sectionId))
  return `登记来源：${sectionIds.map((sectionId) => originLocation(directory, sectionId)).join('；')}`
}

/** 送达对象文本与观测：operator 引用给完整卡，skill 引用只给指定 grant 及被替换链。 */
function renderReadObject(
  object: ProseReadObject,
  store: CardStore | undefined,
  directory: SectionDirectory,
): RenderedObject {
  const originLine = renderOriginLine(object, directory)
  if (object.kind === 'concept') {
    return {
      text: `${serializeConceptCard(object.concept)}\n${originLine}`,
      delivered: {
        kind: 'concept',
        file: object.concept.file,
        headingPath: [...object.concept.headingPath],
        occurrence: object.concept.occurrence,
        ...(object.concept.term === undefined ? {} : { term: object.concept.term }),
        ...(object.concept.termOccurrence === undefined ? {} : { termOccurrence: object.concept.termOccurrence }),
        startLine: object.concept.startLine,
        endLine: object.concept.endLine,
        origins: object.origins.map((origin) => ({ ...origin })),
      },
    }
  }
  const card = store?.byCanonical.get(object.canonical)
  if (card === undefined) throw new Error(`read 关联记录卡缺失：${object.canonical}`)
  const origins = object.origins.map((origin) => ({ ...origin }))
  if (object.projection === 'skills') {
    const projection = skillProjection(card, object.explicitGrantIds)
    return {
      text: `${serializeCard(card, { projectionGrantIds: object.explicitGrantIds })}\n${originLine}`,
      delivered: {
        kind: 'card',
        canonical: object.canonical,
        projection: 'skills',
        grantIds: projection.skills.flatMap((skill) => (skill.grantId === undefined ? [] : [skill.grantId])),
        origins,
      },
    }
  }
  return {
    text: `${serializeCard(card, {})}\n${originLine}`,
    delivered: {
      kind: 'card',
      canonical: object.canonical,
      projection: 'full',
      grantIds: card.skills.flatMap((skill) => (skill.grantId === undefined ? [] : [skill.grantId])),
      origins,
    },
  }
}

function describeObject(object: ProseReadObject): string {
  if (object.kind === 'concept') {
    return `概念 ${object.concept.file}#${object.concept.headingPath.join(' > ')}｜${object.concept.name}`
  }
  return `记录卡 ${object.canonical}`
}

/** 小节正文在文档范围正文中的起始 UTF-16 位移；同一次目录快照内计算，取不到时返回 undefined。 */
function documentOffsetFor(section: SectionEntry, directory: SectionDirectory): number | undefined {
  const doc = directory.documentRange(section.file)
  if (!doc) return undefined
  if (section.sectionId === doc.sectionId) return 0
  const delta = section.startLine - doc.startLine
  if (delta <= 0) return 0
  let index = -1
  for (let step = 0; step < delta; step++) {
    index = doc.body.indexOf('\n', index + 1)
    if (index < 0) break
  }
  if (index >= 0) return index + 1
  const found = doc.body.indexOf(section.body)
  return found >= 0 ? found : undefined
}

function capacityMessage(maxChars: number, reserve: number): string {
  return `read 无法在 maxContextChars=${maxChars} 内返回阅读内容：分页元数据已占约 ${reserve} 字符。请提高 maxContextChars 后重试。`
}

function overCapacityMessage(input: ReadPageInput, required: number, available: number): string {
  return `read 关联对象超过阅读容量：${describeObject(input.objects[input.factsOffset]!)} 需 ${required} 字符，`
    + `本页可用容量 ${available} 字符。请缩小阅读范围、改用现有 facts 入口或提高 maxContextChars；`
    + '不会返回半张卡或不可前进的续读。'
}

function noProgressMessage(maxChars: number, available: number): string {
  return `read 本页可用容量放不下任何原文或关联对象：剩余额度约 ${available} 字符（maxContextChars=${maxChars}）。`
    + '不会返回不可前进的续读，请提高 maxContextChars 后重试。'
}

function invalid(message: string): ReadPageResult {
  return { data: message, status: 'invalid_params', hitIds: [], injectedIds: [], delivery: {} }
}

/** 送达前失败：不记实际范围，也不写成空关联；已取得对象序列时登记事实页（returned=0、complete=false，不伪造下一调用）。 */
function beforeSendDelivery(input: ReadPageInput): ReadPageDelivery {
  return {
    factsPage: {
      offset: input.factsOffset,
      nextOffset: null,
      total: input.objects.length,
      returned: 0,
      // 失败页没有完成任何送达，即使偏移恰好落在对象序列末尾也按契约记为未完成。
      complete: false,
    },
  }
}

function failed(message: string, delivery: ReadPageDelivery = {}): ReadPageResult {
  return { data: message, status: 'error', hitIds: [], injectedIds: [], delivery }
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function countNewlines(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  return count
}
