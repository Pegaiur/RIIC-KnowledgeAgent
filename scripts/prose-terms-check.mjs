/**
 * RAG 玩家侧散文术语检查。
 *
 * 只扫描人工清洗层 knowledge/base 与 knowledge/guides；正式 facts 输入与 raw 临时稿
 * 保留各自字段格式和原始措辞，不进入本检查。
 * knowledge/guides/类别.md 与 knowledge/guides/歧义.md 是保留原格式的参考资料，
 * 按下方精确路径整文件豁免（规格见 docs/spec/rag-prose-terminology.md）。
 *
 * 禁词表真源为 scripts/lib/prose-terms.mjs（与外部语料导入预检共用），本脚本只负责扫描范围与退出码。
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, extname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { FORBIDDEN_PROSE_TERMS, matchTermsInLine } from './lib/prose-terms.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '..')

const scanRoots = ['knowledge/base', 'knowledge/guides']

/**
 * 保留原格式的参考资料：按精确仓库相对路径整文件豁免。
 * 只登记这两个文件，不按头注、文件名模式或整个 knowledge/guides 放宽。
 */
const preservedReferenceFiles = new Set([
  'knowledge/guides/类别.md',
  'knowledge/guides/歧义.md',
])

const forbiddenTerms = FORBIDDEN_PROSE_TERMS

function collectMarkdownFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) return collectMarkdownFiles(path)
    return entry.isFile() && extname(entry.name) === '.md' ? [path] : []
  })
}

/**
 * 扫描扫描根下的散文语料，返回问题数组（仓库相对路径、行号、命中词与替换建议）。
 * 目录不存在或无 markdown 时返回空数组，不抛错。
 * @param {string} targetRoot 仓库根；CLI 传脚本自身定位的仓库根，测试可注入临时根
 */
export function collectProseTermIssues(targetRoot) {
  const resolvedRoot = resolve(targetRoot)
  const issues = []
  for (const scanRoot of scanRoots) {
    for (const file of collectMarkdownFiles(resolve(resolvedRoot, scanRoot))) {
      const relativePath = relative(resolvedRoot, file).replaceAll('\\', '/')
      // 精确路径例外：保留原格式的参考资料整文件跳过禁词匹配。
      if (preservedReferenceFiles.has(relativePath)) continue
      const lines = readFileSync(file, 'utf8').split(/\r?\n/u)
      for (let index = 0; index < lines.length; index += 1) {
        for (const hit of matchTermsInLine(lines[index], forbiddenTerms, 'forbidden')) {
          issues.push({
            file: relativePath,
            line: index + 1,
            term: hit.term,
            replacement: hit.replacement,
          })
        }
      }
    }
  }
  return issues
}

// isMain 守卫：直调时执行检查；被 import（vitest）时仅暴露纯函数，无副作用。
const isMain =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()
if (isMain) {
  const issues = collectProseTermIssues(root)
  if (issues.length > 0) {
    console.error(`❌ RAG 散文术语检查失败：发现 ${issues.length} 处非规范写法`)
    for (const issue of issues) {
      console.error(`- ${issue.file}:${issue.line} “${issue.term}” → ${issue.replacement}`)
    }
    process.exitCode = 1
  } else {
    console.log('✅ RAG 散文术语检查通过')
  }
}
