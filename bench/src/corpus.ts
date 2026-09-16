/**
 * 语料加载与分块
 *
 * 输入：corpusDir/corpus-manifest.json 显式登记的 Markdown（仅接受 base/ 与 guides/ 前缀）；未登记文件默认不进入检索。
 * gold 定位目录（loadGoldAnchorChunks）另行叠加显式声明的 raw 机械真源，与检索范围分离。
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
    // 按归一化后的目标限制范围，避免 base/../raw/ 一类路径绕过（ADR-021）。
    if (!isFulltextFile(docId)) {
      throw new Error(`语料白名单只允许登记 base/ 与 guides/ 下的文件：${entry}`)
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
    // 父目录也可能是链接；物理目标即使仍在语料根内，也不能落入 raw 等非检索目录。
    if (!isFulltextFile(toDocumentId(relative(physicalRoot, physicalFilePath)))) {
      throw new Error(`语料白名单只允许登记 base/ 与 guides/ 下的文件：${entry}`)
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

/** 原文扩展候选：manifest 登记的 base 与 guides 语料（ADR-013；raw 不进入检索与阅读目录）。 */
export function isFulltextFile(file: string): boolean {
  return file.startsWith('base/') || file.startsWith('guides/')
}

/** 加载整个语料库并分块：范围等于 manifest 声明的全部块（ADR-021，不再有技能表过滤）。 */
export function loadCorpus(corpusRoot: string, maxChars?: number): DocChunk[] {
  const files = collectMarkdownFiles(corpusRoot)
  const chunks = files.flatMap((f) => splitChunks(f, corpusRoot))
  return maxChars !== undefined ? clampTexts(chunks, maxChars) : chunks
}

/**
 * gold 完整定位目录（ADR-021 步骤 6）：manifest 原文分块 + 显式传入的 raw 机械真源分块。
 * 与检索范围分离：只用于解析 gold 定位，不参与排序，也不进入模型原文阅读目录。
 * 只读调用方给出的显式清单，不递归扫描 raw；路径越界、非 raw/、符号链接或缺失都直接失败。
 */
export function loadGoldAnchorChunks(corpusRoot: string, rawDocIds: readonly string[]): DocChunk[] {
  const root = resolve(corpusRoot)
  const rawFiles = resolveRawSourceFiles(root, rawDocIds)
  return [...loadCorpus(root), ...rawFiles.flatMap((file) => splitChunks(file, root))]
}

/** 校验并解析 raw 真源清单为绝对路径；与 manifest 白名单共用同样的越界与链接检查。 */
function resolveRawSourceFiles(corpusRoot: string, docIds: readonly string[]): string[] {
  let physicalRoot: string
  try {
    physicalRoot = realpathSync(corpusRoot)
  } catch {
    throw new Error(`无法解析语料根目录：${corpusRoot}`)
  }

  return docIds.map((docId, index) => {
    if (typeof docId !== 'string' || docId.trim().length === 0) {
      throw new Error(`gold 定位真源第 ${index + 1} 项必须是非空字符串`)
    }
    const normalizedPath = docId.trim().replaceAll('\\', '/')
    if (!normalizedPath.toLowerCase().endsWith('.md')) {
      throw new Error(`gold 定位真源只接受 Markdown 文件：${docId}`)
    }
    if (isAbsolute(docId) || posix.isAbsolute(normalizedPath) || win32.isAbsolute(normalizedPath)) {
      throw new Error(`gold 定位真源必须是相对语料根目录的路径：${docId}`)
    }
    if (!normalizedPath.startsWith('raw/')) {
      throw new Error(`gold 定位真源只接受 raw/ 下的文件：${docId}`)
    }

    const fullPath = resolve(corpusRoot, ...normalizedPath.split('/'))
    if (isOutsideRoot(relative(corpusRoot, fullPath))) {
      throw new Error(`gold 定位真源路径越出语料根目录：${docId}`)
    }

    let fileStat: ReturnType<typeof lstatSync>
    try {
      fileStat = lstatSync(fullPath)
    } catch {
      throw new Error(`gold 定位真源不存在：${docId}`)
    }
    if (fileStat.isSymbolicLink()) {
      throw new Error(`gold 定位真源不允许符号链接：${docId}`)
    }
    if (!fileStat.isFile()) {
      throw new Error(`gold 定位真源不是普通文件：${docId}`)
    }

    let physicalFilePath: string
    try {
      physicalFilePath = realpathSync(fullPath)
    } catch {
      throw new Error(`gold 定位真源不存在：${docId}`)
    }
    const physicalDocId = toDocumentId(relative(physicalRoot, physicalFilePath))
    if (isOutsideRoot(relative(physicalRoot, physicalFilePath)) || !physicalDocId.startsWith('raw/')) {
      throw new Error(`gold 定位真源路径越出 raw/ 目录：${docId}`)
    }

    return fullPath
  })
}

/** 语料统计（白名单文件存在性检查） */
export function corpusStats(dir: string): { files: number; size: number } {
  const files = collectMarkdownFiles(dir)
  let size = 0
  for (const f of files) size += statSync(f).size
  return { files: files.length, size }
}
