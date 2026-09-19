#!/usr/bin/env node
/**
 * knowledge/external-corpus-scan — 外部语料导入预检（只读，清洗辅助）
 *
 * 用法：
 *   node scripts/tooling.mjs run knowledge/external-corpus-scan -- --source <外部稿>... [--room <设施>]... [--root <仓库根>] [--json]
 *
 * 口径：
 *   - 大纲：外部稿 1–3 级标题与行号，供选材、拆分与落点判断；front-matter 只在文件首行识别，正文的分隔线不参与。
 *   - 术语预检：命中本库禁词表（与合并门禁同表，scripts/lib/prose-terms.mjs）的位置与规范写法；
 *     另列门禁漏检的导入期提示（如带空格的“精 2”），只提示改写，不进入门禁。
 *   - 命中本地对象，待核对：外部稿中字面命中的技能名（对照 knowledge/facts/技能-<设施>.md）与干员标准名
 *     （始终对照 knowledge/facts/名册.md），按源行共享完整上下文，候选分别保留类型。表格行携带列名，省去对齐填充。字面命中只提示可能的重复劳动，
 *     不代表该段数值、条件或关系已由 facts 覆盖，身份与上下文仍需人工核对。未指定设施时只跳过技能名核对。
 *   - 边界：长名命中不重复算其内部短名（短名在别处独立出现仍提示）；单字名不按长度一刀切排除——单字 ASCII 名按
 *     词边界匹配，中文单字名要求两侧都不是中日韩字符，均标为低置信，仍可能误报。
 * 只读边界：仅读取源文件与 facts 对照集，结果只输出终端；--json 也不写盘、不改正文。
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { resolveRepoRoot } from '../../lib/repo-context.mjs'
import {
  FORBIDDEN_PROSE_TERMS,
  IMPORT_HINT_PROSE_TERMS,
  matchTermsInLine,
} from '../../lib/prose-terms.mjs'

export const SCAN_NAME = '外部语料导入预检'

/** 命中候选的口径说明：终端与 --json 共用同一段文字。 */
export const CATALOG_LIMITATION =
  '字面匹配只提示可能与本地对象重合的位置，不代表该段数值、条件或关系已由 facts 覆盖；对象身份与上下文需人工核对。单字名按保守边界匹配，仍可能误报。'

const CJK_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u
const ASCII_WORD_PATTERN = /[A-Za-z0-9_]/

/** 取仓库相对路径（仓库外路径原样返回）。 */
function displayPath(root, target) {
  const rel = relative(root, target)
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? target : rel.replaceAll('\\', '/')
}

/** 文件读取错误统一转为中文，不向 CLI 暴露底层英文堆栈。 */
function readInput(path) {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    throw new Error(`无法读取文件：${path}（请检查文件类型与读取权限）`)
  }
}

/** 标记可解析正文；围栏、文件头元数据与不确定的缩进代码区域保守排除。 */
function proseLineMask(lines) {
  let frontMatter = lines[0]?.trim() === '---'
  let fence = null
  return lines.map((line, index) => {
    if (frontMatter) {
      if (index > 0 && line.trim() === '---') frontMatter = false
      return false
    }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = null
      return false
    }
    // 四空格或制表符缩进既可能是代码，也可能在列表容器内；不猜测其字段关系。
    if (/^(?: {4}| {0,3}\t)/u.test(line)) return false
    if (marker) {
      fence = marker[1]
      return false
    }
    return true
  })
}

/**
 * 提取 1–3 级标题与行号。
 * front-matter 只认文件首行的 `---` 开关，正文里的 `---` 分隔线不改变解析状态。
 * @param {string} text
 * @returns {{ level: number, title: string, line: number }[]}
 */
export function parseOutline(text) {
  const lines = String(text).split(/\r?\n/u)
  const prose = proseLineMask(lines)

  const outline = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!prose[index]) continue
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(lines[index])
    if (!match) continue
    const level = match[1].length
    if (level > 3) continue
    outline.push({ level, title: match[2], line: index + 1 })
  }
  return outline
}

/**
 * 逐行做术语预检：同一行先报禁词表命中，再报导入期提示。
 * @param {string} text
 * @returns {{ line: number, term: string, replacement: string, kind: string }[]}
 */
export function collectTermIssues(text) {
  const issues = []
  const lines = String(text).split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const forbidden = matchTermsInLine(lines[index], FORBIDDEN_PROSE_TERMS, 'forbidden')
    const hints = matchTermsInLine(lines[index], IMPORT_HINT_PROSE_TERMS, 'import-hint')
    for (const hit of [...forbidden, ...hints]) {
      issues.push({ line: index + 1, ...hit })
    }
  }
  return issues
}

/**
 * 从 facts 技能分片中提取技能名：只取技能行（以“- ”开头）中「」内的名称，去重保序。
 * 公共说明与“例：…”一类示例行不以“- ”开头，天然排除。
 * @param {string} rawText
 * @returns {string[]}
 */
export function parseSkillNames(rawText) {
  const names = []
  const seen = new Set()
  for (const line of String(rawText).split(/\r?\n/u)) {
    if (!/^-\s/u.test(line)) continue
    for (const match of line.matchAll(/「([^」]+)」/gu)) {
      const name = match[1].trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

/** 找出名称在行内的全部出现位置（允许重叠，便于判断长短名覆盖关系）。 */
function findOccurrences(line, name) {
  const occurrences = []
  let from = 0
  for (;;) {
    const start = line.indexOf(name, from)
    if (start === -1) break
    occurrences.push({ start, end: start + name.length })
    from = start + 1
  }
  return occurrences
}

/** 命中两侧都不是“同类字符”（由 predicate 给出）时才算独立出现。 */
function isDelimited(line, start, end, predicate) {
  const before = start > 0 ? line[start - 1] : ''
  const after = end < line.length ? line[end] : ''
  return !predicate(before) && !predicate(after)
}

/** 拆分显式以竖线开头的表格行，保留转义竖线与单元格内容；其他写法交给原文回退。 */
function tableCells(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  const cells = []
  let cell = ''
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === '\\' && index + 1 < trimmed.length) {
      cell += char + trimmed[index + 1]
      index += 1
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  cells.shift()
  if (cell === '') cells.pop()
  return cells
}

/**
 * 为可靠识别的表格数据行补回列名，全文保留；普通行、列数异常与代码示例原样回退。
 * 仅用于预检报告，不改动源文与查询 Agent 的原文坐标。
 */
function lineContexts(lines) {
  const contexts = [...lines]
  const prose = proseLineMask(lines)
  for (let index = 0; index < lines.length; index += 1) {
    if (!prose[index] || !prose[index + 1]) continue
    const header = tableCells(lines[index])
    const separator = tableCells(lines[index + 1] ?? '')
    if (!header?.length || !separator || header.length !== separator.length || !separator.every((cell) => /^:?-{3,}:?$/u.test(cell))) continue
    index += 1
    while (index + 1 < lines.length && prose[index + 1]) {
      const cells = tableCells(lines[index + 1])
      if (!cells) break
      index += 1
      if (cells.length !== header.length) continue
      contexts[index] = cells.map((cell, column) => `${header[column] || `第${column + 1}列`}：${cell || '（空）'}`).join('；')
    }
  }
  return contexts
}

/**
 * 核对外部稿字面命中的本地对象候选。
 * 单字名不按长度一刀切排除：单字 ASCII 名（如 W）按词边界匹配，中文单字名（如 令、夕）要求两侧都不是中日韩字符；
 * 两类都标为低置信。多字名按字面命中，且被更长命中完整覆盖的位置不重复计入。
 *
 * @param {string} text
 * @param {{ rosterNames?: string[], skillNames?: string[] }} catalog
 * @returns {{ name: string, type: string, line: number, confidence: string, context: string }[]}
 */
export function collectFactCandidates(text, { rosterNames = [], skillNames = [] } = {}) {
  const lines = String(text).split(/\r?\n/u)
  const contexts = lineContexts(lines)
  const candidates = []
  const seen = new Set()

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const occurrences = []
    for (const [type, names] of [
      ['skill', skillNames],
      ['operator', rosterNames],
    ]) {
      for (const name of names) {
        if (typeof name !== 'string' || name === '') continue
        const single = [...name].length === 1
        for (const occurrence of findOccurrences(line, name)) {
          if (single) {
            const predicate = ASCII_WORD_PATTERN.test(name)
              ? (char) => char !== '' && ASCII_WORD_PATTERN.test(char)
              : (char) => char !== '' && CJK_PATTERN.test(char)
            if (!isDelimited(line, occurrence.start, occurrence.end, predicate)) continue
          }
          occurrences.push({ ...occurrence, type, name, single })
        }
      }
    }

    const kept = occurrences
      .filter(
        (item) =>
          !occurrences.some(
            (other) =>
              other.end - other.start > item.end - item.start &&
              other.start <= item.start &&
              other.end >= item.end,
          ),
      )
      .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))

    for (const item of kept) {
      const key = `${item.type}\u0000${item.name}\u0000${index}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({
        name: item.name,
        type: item.type,
        line: index + 1,
        confidence: item.single ? 'low' : 'high',
        context: contexts[index],
      })
    }
  }

  return candidates
}

/**
 * 读取 facts 对照集：名册标准名 + 指定设施分片的技能名。
 * 名册或指定分片缺失时报中文错误，不静默降级为“无命中”。
 * @param {string} root 仓库根
 * @param {string[]} rooms 设施名（可为空：只核对干员名）
 */
export function loadFactCatalog(root, rooms = []) {
  const rosterRelative = 'knowledge/facts/名册.md'
  const rosterPath = join(root, ...rosterRelative.split('/'))
  if (!existsSync(rosterPath)) {
    throw new Error(`名册不存在：${rosterRelative}`)
  }
  const rosterNames = []
  for (const line of readInput(rosterPath).split(/\r?\n/u)) {
    const match = /^-\s+(.+?)\s*\|/u.exec(line)
    if (match) rosterNames.push(match[1].trim())
  }

  const skillNames = []
  const seen = new Set()
  for (const room of rooms) {
    const roomRelative = `knowledge/facts/技能-${room}.md`
    const roomPath = join(root, ...roomRelative.split('/'))
    if (!existsSync(roomPath)) {
      throw new Error(`技能分片不存在：${roomRelative}（--room 请填设施名，如 加工站）`)
    }
    for (const name of parseSkillNames(readInput(roomPath))) {
      if (seen.has(name)) continue
      seen.add(name)
      skillNames.push(name)
    }
  }

  return { rosterNames, skillNames }
}

/**
 * 组装单个源文件的预检结果。
 * @param {{ path: string, text: string, rosterNames?: string[], skillNames?: string[] }} input
 */
export function scanSource({ path, text, rosterNames = [], skillNames = [] }) {
  const groups = new Map()
  for (const { line, context, ...candidate } of collectFactCandidates(text, { rosterNames, skillNames })) {
    if (!groups.has(line)) groups.set(line, { line, context, candidates: [] })
    groups.get(line).candidates.push(candidate)
  }
  return {
    path,
    outline: parseOutline(text),
    termIssues: collectTermIssues(text),
    factCandidateGroups: [...groups.values()],
  }
}

/** 命中候选的类型标签。 */
function typeLabel(type) {
  return type === 'skill' ? '技能' : '干员'
}

/** 对照范围说明：未指定设施时明确只跳过技能名核对。 */
export function describeCatalogScope(rooms) {
  if (rooms.length === 0) {
    return '名册（干员标准名）；未指定设施，跳过技能名核对'
  }
  return `名册（干员标准名）；技能分片：${rooms.join('、')}（技能名）`
}

/** 渲染预检结果为终端文本（与 --json 同口径）。 */
export function renderScan(results, { rooms = [] } = {}) {
  const lines = [SCAN_NAME]
  lines.push(`对照范围：${describeCatalogScope(rooms)}`)
  lines.push(`局限：${CATALOG_LIMITATION}`)
  lines.push('')

  const termTotal = results.reduce((acc, item) => acc + item.termIssues.length, 0)
  const groupTotal = results.reduce((acc, item) => acc + item.factCandidateGroups.length, 0)
  const candidateTotal = results.reduce((acc, item) => acc + item.factCandidateGroups.reduce((count, group) => count + group.candidates.length, 0), 0)

  for (const result of results) {
    lines.push(`## ${result.path}`)
    lines.push('')
    lines.push('### 大纲')
    if (result.outline.length === 0) {
      lines.push('- 无标题')
    } else {
      for (const item of result.outline) {
        lines.push(`${'  '.repeat(item.level - 1)}- H${item.level} ${item.title}（L${item.line}）`)
      }
    }
    lines.push('')
    lines.push('### 术语预检（导入前需改写）')
    if (result.termIssues.length === 0) {
      lines.push('- 无')
    } else {
      for (const issue of result.termIssues) {
        const tag = issue.kind === 'forbidden' ? '禁词' : '提示'
        lines.push(`- L${issue.line} [${tag}] “${issue.term}” → ${issue.replacement}`)
      }
    }
    lines.push('')
    lines.push('### 命中本地对象，待核对')
    if (result.factCandidateGroups.length === 0) {
      lines.push('- 无')
    } else {
      for (const group of result.factCandidateGroups) {
        const labels = []
        for (const type of ['skill', 'operator']) {
          const candidates = group.candidates.filter((item) => item.type === type)
          if (candidates.length === 0) continue
          labels.push(`${typeLabel(type)}：${candidates.map((item) => `${item.name}${item.confidence === 'low' ? '（低置信）' : ''}`).join('、')}`)
        }
        lines.push(`- L${group.line} ${labels.join('；')}`, `  上下文：${group.context}`)
      }
    }
    lines.push('')
  }

  lines.push(`汇总：源文件 ${results.length} 个 / 术语命中 ${termTotal} 处 / 对象候选 ${candidateTotal} 条（${groupTotal} 个源行）`)
  return lines.join('\n')
}

function printUsage() {
  process.stderr.write(
    [
      `${SCAN_NAME}（只读）`,
      '用法：node scripts/tooling.mjs run knowledge/external-corpus-scan -- --source <外部稿>... [--room <设施>]... [--root <仓库根>] [--json]',
      '说明：--room 缺省时只跳过技能名核对，干员标准名仍与名册对照。',
      '',
    ].join('\n'),
  )
}

function main() {
  let values
  try {
    ({ values } = parseArgs({
      options: {
        source: { type: 'string', multiple: true, default: [] },
        room: { type: 'string', multiple: true, default: [] },
        root: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
      allowPositionals: false,
    }))
  } catch {
    process.stderr.write('参数错误：请检查选项名称和值，不接受位置参数。\n')
    printUsage()
    process.exitCode = 2
    return
  }

  if (values.source.length === 0) {
    printUsage()
    process.exitCode = 2
    return
  }

  const root = values.root ? resolve(values.root) : resolveRepoRoot(import.meta.url)

  const sources = []
  for (const source of values.source) {
    const absolute = resolve(source)
    if (!existsSync(absolute)) {
      process.stderr.write(`源文件不存在：${source}\n`)
      process.exitCode = 2
      return
    }
    sources.push({ absolute, relative: displayPath(root, absolute) })
  }

  let catalog
  try {
    catalog = loadFactCatalog(root, values.room)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
    return
  }

  const results = sources.map((item) =>
    scanSource({
      path: item.relative,
      text: readInput(item.absolute),
      rosterNames: catalog.rosterNames,
      skillNames: catalog.skillNames,
    }),
  )

  if (values.json) {
    process.stdout.write(
      JSON.stringify(
        {
          rooms: values.room,
          catalogScope: describeCatalogScope(values.room),
          limitation: CATALOG_LIMITATION,
          sources: results,
        },
        null,
        2,
      ) + '\n',
    )
  } else {
    process.stdout.write(renderScan(results, { rooms: values.room }) + '\n')
  }
}

// isMain 守卫：直调时执行；被 import（vitest）时仅暴露纯函数，无副作用。
const isMain =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()
if (isMain) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`预检失败：${error instanceof Error ? error.message : '无法完成扫描'}\n`)
    process.exitCode = 1
  }
}
