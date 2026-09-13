/**
 * 正式质量基线的机械校验。
 *
 * AGENTS.md 的「## 质量基线」段表格是基线的唯一记录处；本模块只校验一件事：
 * bench/results/ 下的每份结果是否都已在该表登记，避免新结果未登记即被当作
 * 基线使用。表中的哈希列仅供人工核对，不参与机械校验，也不反向校验已登记项。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SECTION_HEADING = '## 质量基线'

export interface QualityBaselineSummary {
  resultCount: number
}

/** 列出 bench/results/ 下的结果文件名（不存在目录时视为空集）。 */
function listResultFiles(root: string): string[] {
  const resultsRoot = join(root, 'bench', 'results')
  if (!existsSync(resultsRoot)) return []
  return readdirSync(resultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
}

/** 截取 AGENTS.md 中「## 质量基线」段（到下一个二级标题或文件末尾为止）。 */
function extractSection(text: string): string {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === SECTION_HEADING)
  if (start < 0) throw new Error(`质量基线段缺失：AGENTS.md 未找到「${SECTION_HEADING}」`)
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) {
      end = index
      break
    }
  }
  return lines.slice(start + 1, end).join('\n')
}

/** 从段内表格首列提取已登记的结果文件名（跳过表头与分隔行）。 */
function parseResultNames(section: string): Set<string> {
  const names = new Set<string>()
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1)
    const first = (cells[0] ?? '').replace(/`/g, '').trim()
    if (!first.endsWith('.json')) continue
    names.add(first)
  }
  return names
}

/** 读取 AGENTS.md 质量基线段表格，返回已登记的结果文件名集合。 */
export function readBaselineResults(root: string): Set<string> {
  const agentsPath = join(root, 'AGENTS.md')
  if (!existsSync(agentsPath)) throw new Error(`质量基线记录缺失：未找到 ${agentsPath}`)
  return parseResultNames(extractSection(readFileSync(agentsPath, 'utf-8')))
}

/**
 * 聚合校验质量基线表，把全部错误追加到共享 errors（同 validateSharedSnapshots 风格）。
 * 本函数自身无错误时返回 { resultCount }，否则返回 null。
 */
export function validateQualityBaseline(root: string, errors: string[]): QualityBaselineSummary | null {
  const before = errors.length
  let registered: Set<string>
  try {
    registered = readBaselineResults(root)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return null
  }

  if (registered.size === 0) errors.push('质量基线表为空：至少需要登记 1 条结果')

  const results = listResultFiles(root)
  for (const name of results) {
    if (!registered.has(name)) errors.push(`bench/results 存在未登记的结果：${name}`)
  }

  if (errors.length !== before) return null
  return { resultCount: results.length }
}
