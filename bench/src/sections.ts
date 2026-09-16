/**
 * 原文小节目录：从白名单 Markdown 原文建立 H1–H6 层级快照。
 *
 * 检索仍使用既有 chunks/index；本目录只服务 RAG 展示上下文与 read 阅读。
 * 构建时按 manifest 白名单读取一次原文，运行期不再按路径重新读盘，也不改动现有 chunk 分块。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { collectMarkdownFiles } from './corpus.js'

export const SECTION_DIRECTORY_VERSION = 1 as const

export interface SectionEntry {
  /** 相对文件路径＋标题路径＋出现序号的确定性编码；不替代 chunk ID。 */
  sectionId: string
  /** 相对语料根的 markdown 路径 */
  file: string
  /** 原始标题文本（不含 #）；文档根节点为空字符串 */
  heading: string
  /** 标题层级 1–6；文档根节点为 0 */
  level: number
  /** H1→父标题文本（不含自身） */
  ancestors: string[]
  /** 标题所在行（1 基）；根节点为 0 */
  headingLine: number
  /** 正文起始行（1 基，含）；空正文时小于 startLine 的反向值 */
  startLine: number
  /** 正文结束行（1 基，含） */
  endLine: number
  /** 原文正文，含下级小节；不含标题行与 frontmatter */
  body: string
  /** 同一文件同一标题路径的出现序号（从 1 开始） */
  occurrence: number
  /** 父小节 ID；顶层小节与根节点为空 */
  parentId?: string
  /** 第一个子标题行（1 基）；无子标题为 null。用于父级引导边界。 */
  firstChildHeadingLine: number | null
}

export interface SectionParentLead {
  text: string
  startLine: number
  endLine: number
}

export interface SectionContext {
  /** H1→当前标题；根节点为空数组 */
  headingPath: string[]
  parentLead?: SectionParentLead
}

export interface SectionRef {
  sectionId: string
  heading: string
}

export interface SectionNavigation {
  items: SectionRef[]
  omitted: number
}

export interface SectionDirectory {
  version: typeof SECTION_DIRECTORY_VERSION
  /** 按原文顺序排列的小节。 */
  sections: SectionEntry[]
  get(sectionId: string): SectionEntry | undefined
  /** 把检索命中的 chunk 映射回小节（按文件、标题与来源行）。 */
  findByChunk(file: string, heading: string, startLine: number): SectionEntry | undefined
  contextFor(sectionId: string): SectionContext | undefined
  /** 直接兄弟＋子小节，按原文顺序去重后截断。 */
  navigationFor(sectionId: string, limit?: number): SectionNavigation
  /** 覆盖整个正文（不含 frontmatter，含标题前首部）的文档范围；其 ID 可被 get 解析以续读。 */
  documentRange(file: string): SectionEntry | undefined
}

interface ParsedHeading {
  level: number
  text: string
  /** 1 基行号 */
  line: number
}

interface BodySlice {
  text: string
  startLine: number
  endLine: number
}

export function buildSectionDirectory(corpusRoot: string): SectionDirectory {
  const root = resolve(corpusRoot)
  const files = collectMarkdownFiles(root)
  const sections: SectionEntry[] = []
  /** 每文件一个覆盖整个正文的文档范围；与小节 ID 并存，不进入 sections 数组。 */
  const documentEntries = new Map<string, SectionEntry>()

  for (const fullPath of files) {
    const file = relative(root, fullPath).split(sep).join('/')
    const lines = readFileSync(fullPath, 'utf-8').split(/\r?\n/)
    const { headings, contentStartIndex } = parseHeadings(lines)
    documentEntries.set(file, createDocumentEntry(file, sliceBody(lines, contentStartIndex, lines.length - 1)))
    if (headings.length === 0) {
      const body = sliceBody(lines, contentStartIndex, lines.length - 1)
      sections.push(createEntry({ file, heading: '', level: 0, ancestors: [], headingLine: 0, body, occurrence: 1 }))
      continue
    }

    const stack: SectionEntry[] = []
    const occurrenceCounter = new Map<string, number>()
    headings.forEach((heading, index) => {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) stack.pop()
      const parent = stack[stack.length - 1]
      const ancestors = stack.map((item) => item.heading)
      const occurrenceKey = `${file}\u0000${[...ancestors, heading.text].join('\u0000')}`
      const occurrence = (occurrenceCounter.get(occurrenceKey) ?? 0) + 1
      occurrenceCounter.set(occurrenceKey, occurrence)
      const boundaryIndex = nextBoundaryIndex(headings, index)
      const endIndex = boundaryIndex === null ? lines.length - 1 : boundaryIndex - 1
      const body = sliceBody(lines, heading.line, endIndex)
      const entry = createEntry({
        file,
        heading: heading.text,
        level: heading.level,
        ancestors,
        headingLine: heading.line,
        body,
        occurrence,
        parentId: parent?.sectionId,
      })
      sections.push(entry)
      stack.push(entry)
    })
  }

  const firstChildLines = new Map<string, number>()
  for (const section of sections) {
    if (!section.parentId) continue
    const current = firstChildLines.get(section.parentId)
    if (current === undefined || section.headingLine < current) firstChildLines.set(section.parentId, section.headingLine)
  }
  for (const section of sections) {
    section.firstChildHeadingLine = firstChildLines.get(section.sectionId) ?? null
  }

  const byId = new Map(sections.map((section) => [section.sectionId, section]))
  const documentsById = new Map([...documentEntries.values()].map((entry) => [entry.sectionId, entry]))

  return {
    version: SECTION_DIRECTORY_VERSION,
    sections,
    get: (sectionId) => byId.get(sectionId) ?? documentsById.get(sectionId),
    findByChunk: (file, heading, startLine) => findByChunk(sections, file, heading, startLine),
    contextFor: (sectionId) => contextFor(byId, sectionId),
    navigationFor: (sectionId, limit = 8) => navigationFor(sections, sectionId, limit),
    documentRange: (file) => documentEntries.get(file),
  }
}

/** 文档范围条目：level 0、无标题，正文覆盖整个文件（含标题前首部），ID 可被 get 解析以续读。 */
function createDocumentEntry(file: string, body: BodySlice): SectionEntry {
  return {
    sectionId: `doc:${file}`,
    file,
    heading: '',
    level: 0,
    ancestors: [],
    headingLine: 0,
    startLine: body.startLine,
    endLine: body.endLine,
    body: body.text,
    occurrence: 1,
    firstChildHeadingLine: null,
  }
}

function createEntry(input: {
  file: string
  heading: string
  level: number
  ancestors: string[]
  headingLine: number
  body: BodySlice
  occurrence: number
  parentId?: string
}): SectionEntry {
  const headingPath = input.level === 0 ? [] : [...input.ancestors, input.heading]
  return {
    sectionId: encodeSectionId(input.file, headingPath, input.occurrence),
    file: input.file,
    heading: input.heading,
    level: input.level,
    ancestors: input.ancestors,
    headingLine: input.headingLine,
    startLine: input.body.startLine,
    endLine: input.body.endLine,
    body: input.body.text,
    occurrence: input.occurrence,
    parentId: input.parentId,
    firstChildHeadingLine: null,
  }
}

function encodeSectionId(file: string, headingPath: string[], occurrence: number): string {
  const key = `${file}\u0000${headingPath.join('\u0000')}\u0000${occurrence}`
  return `sec-${createHash('sha256').update(key, 'utf-8').digest('hex').slice(0, 16)}`
}

/** 标题识别忽略 frontmatter 与 fenced code；正文起点为 frontmatter 之后。 */
function parseHeadings(lines: string[]): { headings: ParsedHeading[]; contentStartIndex: number } {
  let contentStartIndex = 0
  const firstContent = lines.findIndex((line) => line.trim() !== '')
  if (firstContent >= 0 && lines[firstContent].trim() === '---') {
    for (let i = firstContent + 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        contentStartIndex = i + 1
        break
      }
    }
  }

  const headings: ParsedHeading[] = []
  let fence: { marker: string; size: number } | null = null
  for (let i = contentStartIndex; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence.marker[0] && fenceMatch[1]!.length >= fence.size) fence = null
      continue
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1]!, size: fenceMatch[1]!.length }
      continue
    }
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) headings.push({ level: match[1]!.length, text: match[2]!.trim(), line: i + 1 })
  }
  return { headings, contentStartIndex }
}

/** 下一个同级或更高级标题的 0 基行下标；没有则返回 null。 */
function nextBoundaryIndex(headings: ParsedHeading[], index: number): number | null {
  const { level } = headings[index]!
  for (let i = index + 1; i < headings.length; i++) {
    if (headings[i]!.level <= level) return headings[i]!.line - 1
  }
  return null
}

/** 截取 [startIndex, endIndex] 行区间（0 基），剔除首尾空行并回写真实行号。 */
function sliceBody(lines: string[], startIndex: number, endIndex: number): BodySlice {
  let first = Math.max(0, startIndex)
  while (first <= endIndex && (lines[first] ?? '').trim() === '') first++
  let last = endIndex
  while (last >= first && (lines[last] ?? '').trim() === '') last--
  if (first > last) return { text: '', startLine: first + 1, endLine: first }
  return { text: lines.slice(first, last + 1).join('\n'), startLine: first + 1, endLine: last + 1 }
}

function findByChunk(sections: SectionEntry[], file: string, heading: string, startLine: number): SectionEntry | undefined {
  const matches = sections.filter(
    (section) => section.file === file && section.heading === heading && section.startLine <= startLine && startLine <= section.endLine,
  )
  if (matches.length > 0) return matches.reduce((best, item) => (item.headingLine > best.headingLine ? item : best))
  const containing = sections.filter(
    (section) => section.file === file && section.startLine <= startLine && startLine <= section.endLine,
  )
  if (containing.length === 0) return undefined
  return containing.reduce((best, item) => {
    if (item.level > best.level) return item
    if (item.level === best.level && item.headingLine > best.headingLine) return item
    return best
  })
}

function contextFor(byId: Map<string, SectionEntry>, sectionId: string): SectionContext | undefined {
  const entry = byId.get(sectionId)
  if (!entry) return undefined
  const headingPath = entry.level === 0 ? [] : [...entry.ancestors, entry.heading]
  const parent = entry.parentId ? byId.get(entry.parentId) : undefined
  if (!parent) return { headingPath }

  const parentLines = parent.body.split('\n')
  const take = parent.firstChildHeadingLine === null
    ? parentLines.length
    : Math.min(parentLines.length, parent.firstChildHeadingLine - parent.startLine)
  let first = 0
  while (first < take && (parentLines[first] ?? '').trim() === '') first++
  let last = take - 1
  while (last >= first && (parentLines[last] ?? '').trim() === '') last--
  if (first > last) return { headingPath }
  return {
    headingPath,
    parentLead: {
      text: parentLines.slice(first, last + 1).join('\n'),
      startLine: parent.startLine + first,
      endLine: parent.startLine + last,
    },
  }
}

function navigationFor(sections: SectionEntry[], sectionId: string, limit: number): SectionNavigation {
  const entry = sections.find((item) => item.sectionId === sectionId)
  if (!entry || limit <= 0) return { items: [], omitted: 0 }
  const ordered = sections.filter((section) => {
    if (section.file !== entry.file || section.sectionId === entry.sectionId) return false
    return section.parentId === entry.parentId || section.parentId === entry.sectionId
  })
  const items = ordered.slice(0, limit).map((section) => ({ sectionId: section.sectionId, heading: section.heading }))
  return { items, omitted: Math.max(0, ordered.length - items.length) }
}
