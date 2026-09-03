/**
 * 语料加载与分块
 *
 * 输入：corpusDir 下全部 .md（递归）；散文语料已废弃（2026-09-03，见 docs/notes-corpus-purge.md），facts-first 重建后本加载器由 lookup/query 取代
 * 输出：按 ## / ### 标题切分的 DocChunk 数组；超长标题节按段落二次切分。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { DocChunk } from './types.js'

/** 递归收集 .md 文件路径 */
export function collectMarkdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectMarkdownFiles(full))
    } else if (entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

/**
 * 解析 Markdown：按 ## / ### 标题切分。
 * 标题前的引言归入「正文首部」（若无标题则为（未分段））。
 */
export function splitChunks(filePath: string, corpusRoot: string): DocChunk[] {
  const raw = readFileSync(filePath, 'utf-8')
  const relPath = relative(corpusRoot, filePath).split(sep).join('/')
  const lines = raw.split(/\r?\n/)
  const { docName, operators } = parseDocAnchors(lines)

  const chunks: DocChunk[] = []
  let heading = '（未分段）'
  let buf: string[] = []
  let headingLine = 0
  // 当前 buf 首行在原文中的 1 基行号（用于溯源标注）
  let contentStart = 0

  const flush = (): void => {
    const text = buf.join('\n').trim()
    if (text.length > 0) {
      // trim 会剔除 buf 首尾空行，据此校正行号：startLine/endLine 指向 trim 后正文的实际原文行号
      let first = 0
      while (first < buf.length && buf[first].trim() === '') first++
      let last = buf.length - 1
      while (last >= 0 && buf[last].trim() === '') last--
      const chunk: DocChunk = {
        id: `${relPath}#${heading}`,
        file: relPath,
        heading: heading.replace(/^#{1,6}\s*/, '').trim(),
        text,
        startLine: contentStart + first,
        endLine: contentStart + last,
      }
      // 检索锚点：文档 H1 体系名 + frontmatter operators（仅检索加权；空则不设）
      const anchor = [docName, ...operators].filter(Boolean).join(' ')
      if (anchor) chunk.anchor = anchor
      chunks.push(chunk)
    }
    buf = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = /^(#{2,3})\s+(.+)$/.exec(line)
    if (m && headingLine !== i) {
      // 遇到新标题：先冲刷上一节；标题行本身不入正文
      flush()
      heading = line
      headingLine = i
      continue
    }
    // 跳过文档 front matter 与模板注释（--- 围栏与 [//]: # 注释）
    if (line.startsWith('[//]: #') || line === '---') continue
    if (buf.length === 0) contentStart = i + 1
    buf.push(line)
  }
  flush()
  return chunks
}

/**
 * 提取文件的检索锚点：文档 H1 一级标题（体系名）+ frontmatter `operators: [...]` 干员列表。
 * 无 H1 则 docName 为空；无 operators 则列表为空。均只用于检索加权，不影响展示。
 */
function parseDocAnchors(lines: string[]): { docName: string; operators: string[] } {
  let docName = ''
  let operators: string[] = []
  let inFrontmatter = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '---') {
      inFrontmatter = !inFrontmatter
      continue
    }
    if (!docName) {
      const h1 = /^#\s+(.+)$/.exec(trimmed)
      if (h1) docName = h1[1].trim()
    }
    if (inFrontmatter) {
      const m = /^operators:\s*\[(.*)\]$/.exec(trimmed)
      if (m) operators = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return { docName, operators }
}

/** 超长片段按段落截断，保证单块不超过 maxChars（保留首段信息） */
export function clampTexts(chunks: DocChunk[], maxChars: number): DocChunk[] {
  return chunks.map((c) => {
    if (c.text.length <= maxChars) return c
    const head = c.text.slice(0, Math.floor(maxChars * 0.6))
    const tail = c.text.slice(-Math.floor(maxChars * 0.4))
    return { ...c, text: `${head}\n…（中段省略）…\n${tail}` }
  })
}

/** 加载整个语料库并分块 */
export function loadCorpus(corpusRoot: string, maxChars?: number): DocChunk[] {
  const files = collectMarkdownFiles(corpusRoot)
  const chunks = files.flatMap((f) => splitChunks(f, corpusRoot))
  return maxChars !== undefined ? clampTexts(chunks, maxChars) : chunks
}

/** 语料统计（目录存在性检查） */
export function corpusStats(dir: string): { files: number; size: number } {
  const files = collectMarkdownFiles(dir)
  let size = 0
  for (const f of files) size += statSync(f).size
  return { files: files.length, size }
}
