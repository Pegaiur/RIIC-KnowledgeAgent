/**
 * 语料加载与分块
 *
 * 输入：arknights-base-vault/docs 目录下全部 .md（递归）
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

  const chunks: DocChunk[] = []
  let heading = '（未分段）'
  let buf: string[] = []
  let headingLine = 0

  const flush = (): void => {
    const text = buf.join('\n').trim()
    if (text.length > 0) {
      chunks.push({
        id: `${relPath}#${heading}`,
        file: relPath,
        heading: heading.replace(/^#{1,6}\s*/, '').trim(),
        text,
      })
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
    buf.push(line)
  }
  flush()
  return chunks
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
