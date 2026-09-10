/**
 * 活动 plan 扫描共享库。
 *
 * doc-check D1 与 release/check P1 共用本模块，统一「活动 plan 枚举」与「验收清单/冻结标记解析」口径，
 * 避免勾选与冻结判定各自实现而漂移；严重度与输出格式仍由各调用方决定。
 */
import { existsSync, readdirSync } from 'node:fs'

/**
 * 枚举活动 plan 文件名：docs/ 下 plan-*.md、排除 *-notes.md（实施笔记），按名称排序。
 * @param {string} docsDir docs 目录绝对路径
 * @returns {string[]} 活动 plan 文件名
 */
export function listActivePlans(docsDir) {
  if (!existsSync(docsDir)) return []
  return readdirSync(docsDir)
    .filter(f => f.startsWith('plan-') && f.endsWith('.md') && !f.endsWith('-notes.md'))
    .sort()
}

/**
 * 解析活动 plan 的验收清单与冻结标记。
 * @param {string} content plan 全文
 * @returns {{ open: { line: number, text: string }[], done: { line: number, text: string }[], frozen: boolean }}
 */
export function parsePlanChecklist(content) {
  const open = []
  const done = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*-\s*\[([ x])\]/.exec(lines[i])
    if (!match) continue
    const item = { line: i + 1, text: lines[i].trim() }
    if (match[1] === ' ') open.push(item)
    else done.push(item)
  }
  return { open, done, frozen: content.includes('已完成于') }
}
