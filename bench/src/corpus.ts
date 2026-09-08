/**
 * 语料加载与分块
 *
 * 输入：corpusDir/corpus-manifest.json 显式登记的 Markdown；未登记文件默认不进入检索。
 * 散文语料已废弃（2026-09-03，见 docs/notes-corpus-purge.md），facts-first 重建后 facts 模式由 facts_search 取代
 * 输出：按 ## / ### 标题切分的 DocChunk 数组；超长标题节按段落二次切分。
 */
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path'
import type { DocChunk } from './types.js'

/** 语料清单文件名；清单与 knowledge 内容同根维护。 */
export const CORPUS_MANIFEST_NAME = 'corpus-manifest.json'

interface CorpusManifestDocument {
  files: unknown
}

/**
 * 读取并校验语料清单，返回规范化的内部文档 ID（统一使用 `/`）。
 * 清单文件本身不参与检索；只有其中登记的 Markdown 文件会被解析。
 */
export function loadCorpusManifest(corpusRoot: string): string[] {
  const root = resolve(corpusRoot)
  const entries = readManifestEntries(root)
  return resolveManifestFiles(root, entries).map((item) => item.docId)
}

/** 按显式清单收集 Markdown 文件路径；生产入口始终读取 corpus-manifest.json。 */
export function collectMarkdownFiles(corpusRoot: string): string[] {
  const root = resolve(corpusRoot)
  const entries = readManifestEntries(root)
  return resolveManifestFiles(root, entries).map((item) => item.fullPath)
}

function readManifestEntries(corpusRoot: string): readonly string[] {
  const manifestPath = join(corpusRoot, CORPUS_MANIFEST_NAME)
  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf-8')
  } catch {
    throw new Error(`无法读取语料白名单：${manifestPath}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`语料白名单不是有效 JSON：${manifestPath}`)
  }

  if (!isManifestDocument(parsed) || !Array.isArray(parsed.files)) {
    throw new Error(`语料白名单格式错误：${manifestPath} 必须包含 files 数组`)
  }
  return parsed.files as readonly string[]
}

function isManifestDocument(value: unknown): value is CorpusManifestDocument {
  return typeof value === 'object' && value !== null && 'files' in value
}

interface ResolvedManifestFile {
  fullPath: string
  docId: string
}

function resolveManifestFiles(corpusRoot: string, entries: readonly string[]): ResolvedManifestFile[] {
  const root = resolve(corpusRoot)
  let physicalRoot: string
  try {
    physicalRoot = realpathSync(root)
  } catch {
    throw new Error(`无法解析语料根目录：${root}`)
  }
  const seen = new Set<string>()
  const result: ResolvedManifestFile[] = []

  entries.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`语料白名单第 ${index + 1} 项必须是非空字符串`)
    }

    const manifestPath = entry.trim().replaceAll('\\', '/')
    if (!manifestPath.toLowerCase().endsWith('.md')) {
      throw new Error(`语料白名单第 ${index + 1} 项不是 Markdown 文件：${entry}`)
    }
    if (isAbsolute(entry) || posix.isAbsolute(manifestPath) || win32.isAbsolute(manifestPath)) {
      throw new Error(`语料白名单路径必须是相对语料根目录的路径：${entry}`)
    }

    const fullPath = resolve(root, ...manifestPath.split('/'))
    const relativePath = relative(root, fullPath)
    if (isOutsideRoot(relativePath)) {
      throw new Error(`语料白名单路径越出语料根目录：${entry}`)
    }

    const docId = toDocumentId(relativePath)
    const duplicateKey = process.platform === 'win32' ? docId.toLowerCase() : docId
    if (seen.has(duplicateKey)) {
      throw new Error(`语料白名单存在重复条目：${entry}`)
    }
    seen.add(duplicateKey)

    const lowerDocId = docId.toLowerCase()
    if (lowerDocId === 'skill.md' || lowerDocId.endsWith('/skill.md')) {
      throw new Error(`语料白名单禁止登记 SKILL.md：${entry}`)
    }

    let fileStat: ReturnType<typeof lstatSync>
    try {
      fileStat = lstatSync(fullPath)
    } catch {
      throw new Error(`语料白名单项不存在：${entry}`)
    }
    if (fileStat.isSymbolicLink()) {
      throw new Error(`语料白名单项不允许符号链接：${entry}`)
    }
    if (!fileStat.isFile()) {
      throw new Error(`语料白名单项不是普通文件：${entry}`)
    }

    let physicalFilePath: string
    try {
      physicalFilePath = realpathSync(fullPath)
    } catch {
      throw new Error(`语料白名单项不存在：${entry}`)
    }
    if (isOutsideRoot(relative(physicalRoot, physicalFilePath))) {
      throw new Error(`语料白名单路径越出语料根目录：${entry}`)
    }

    result.push({ fullPath, docId })
  })

  return result
}

function isOutsideRoot(relativePath: string): boolean {
  return relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || win32.isAbsolute(relativePath)
}

function toDocumentId(relativePath: string): string {
  return relativePath.split(/[\\/]+/).join('/')
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

/** 语料统计（白名单文件存在性检查） */
export function corpusStats(dir: string): { files: number; size: number } {
  const files = collectMarkdownFiles(dir)
  let size = 0
  for (const f of files) size += statSync(f).size
  return { files: files.length, size }
}
