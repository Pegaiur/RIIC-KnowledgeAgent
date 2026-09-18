/**
 * RAG 玩家侧散文术语检查。
 *
 * 只扫描人工清洗层 knowledge/base 与 knowledge/guides；knowledge/raw 为版本控制内的
 * 机械真源，保留字段格式与原始措辞，不整套进入本检查。
 * knowledge/guides/类别.md 与 knowledge/guides/歧义.md 是保留原格式的参考资料，
 * 按下方精确路径整文件豁免（规则见 docs/rules/rag-prose-terminology.md）。
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, extname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

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

const forbiddenTerms = [
  { pattern: /星级/u, replacement: '稀有度' },
  { pattern: /(?:[1-6]|[一二三四五六])★|☆[1-6一二三四五六]|[1-6]星/u, replacement: '一星～六星的中文写法' },
  { pattern: /精英\s*[012零一二]|精[012]|[eE][012]/u, replacement: '精零、精一或精二' },
  { pattern: /无(?:额外)?练度要求|没有额外练度要求|练度无要求|无练度门槛|不(?:需要|要求)额外培养/u, replacement: '精零即可；若表达推荐策略则用“不设独立培养目标”' },
  { pattern: /订单效率|贸易效率/u, replacement: '订单获取效率' },
  { pattern: /生产效率/u, replacement: '生产力' },
  { pattern: /联络效率/u, replacement: '联络速度' },
  { pattern: /仓库容量上限|仓库上限/u, replacement: '仓库容量' },
  { pattern: /体力/u, replacement: '心情' },
  { pattern: /经验书/u, replacement: '作战记录' },
  { pattern: /角色|人物/u, replacement: '干员' },
  { pattern: /线索收集/u, replacement: '线索搜集' },
  { pattern: /技能档/u, replacement: '技能解锁档' },
]

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
        for (const term of forbiddenTerms) {
          const match = term.pattern.exec(lines[index])
          if (!match) continue
          issues.push({
            file: relativePath,
            line: index + 1,
            term: match[0],
            replacement: term.replacement,
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
