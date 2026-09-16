import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectProseTermIssues } from '../prose-terms-check.mjs'

/** 在临时根下写入语料文件，路径按仓库相对路径给出。 */
function writeCorpusFile(root, relativePath, content) {
  const target = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), 'rag-prose-terms-'))
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('prose-terms-check：保留原格式参考资料的精确路径例外', () => {
  it('guides/类别.md 与 guides/歧义.md 命中禁词也不产生问题', () => {
    withRoot((root) => {
      writeCorpusFile(root, 'knowledge/guides/类别.md', [
        '# 类别',
        '',
        '- 角色：按设施分类',
        '- 稀有度：六★及以上',
        '- 订单效率与生产效率',
        '',
      ].join('\n'))
      writeCorpusFile(root, 'knowledge/guides/歧义.md', [
        '# 歧义',
        '',
        '- 体力与经验书',
        '- 线索收集',
        '',
      ].join('\n'))

      expect(collectProseTermIssues(root)).toEqual([])
    })
  })

  it('例外不放宽到整个 guides：同目录其它文件（含同名前缀）仍按仓库相对路径报出', () => {
    withRoot((root) => {
      writeCorpusFile(root, 'knowledge/guides/类别.md', '角色\n')
      writeCorpusFile(root, 'knowledge/guides/歧义.md', '体力\n')
      // 与豁免文件同名前缀、同目录的普通散文，不享受例外。
      writeCorpusFile(root, 'knowledge/guides/类别补充.md', '# 类别补充\n\n该角色精零即可\n')
      // 子目录中的普通散文同样纳入扫描，报出的也是仓库相对路径。
      writeCorpusFile(root, 'knowledge/guides/子目录/组合.md', '# 组合\n\n体力\n')
      writeCorpusFile(root, 'knowledge/base/机制-制造站.md', '# 机制\n\n生产效率\n')

      const issues = collectProseTermIssues(root)
      const files = issues.map((issue) => issue.file)

      expect(files).not.toContain('knowledge/guides/类别.md')
      expect(files).not.toContain('knowledge/guides/歧义.md')
      expect(files).toContain('knowledge/guides/类别补充.md')
      expect(files).toContain('knowledge/guides/子目录/组合.md')
      expect(files).toContain('knowledge/base/机制-制造站.md')
      expect(issues).toContainEqual({
        file: 'knowledge/guides/类别补充.md',
        line: 3,
        term: '角色',
        replacement: '干员',
      })
    })
  })

  it('扫描根不存在或不含 md 时返回空问题集且不报错', () => {
    withRoot((root) => {
      // 临时根为空：knowledge/ 整个不存在。
      expect(collectProseTermIssues(root)).toEqual([])

      // 有文件但不是 markdown。
      writeCorpusFile(root, 'knowledge/guides/说明.txt', '角色与体力\n')
      expect(collectProseTermIssues(root)).toEqual([])

      // 扫描根已存在但为空目录。
      mkdirSync(join(root, 'knowledge', 'base'), { recursive: true })
      expect(collectProseTermIssues(root)).toEqual([])
    })
  })

  it('CLI 直调行为不变：命中禁词退出码 1 并逐条报出，通过时退出码 0 并打印通过', () => {
    withRoot((root) => {
      // 复制脚本到临时根的 scripts/ 下，使其自身定位的仓库根即该临时根。
      const scriptTarget = join(root, 'scripts', 'prose-terms-check.mjs')
      mkdirSync(dirname(scriptTarget), { recursive: true })
      copyFileSync(fileURLToPath(new URL('../prose-terms-check.mjs', import.meta.url)), scriptTarget)
      writeCorpusFile(root, 'knowledge/base/机制-制造站.md', '# 机制\n\n生产效率\n')

      const failed = spawnSync(process.execPath, [scriptTarget], { encoding: 'utf-8', windowsHide: true })
      expect(failed.status).toBe(1)
      expect(failed.stderr).toContain('❌ RAG 散文术语检查失败：发现 1 处非规范写法')
      expect(failed.stderr).toContain('- knowledge/base/机制-制造站.md:3 “生产效率” → 生产力')

      writeCorpusFile(root, 'knowledge/base/机制-制造站.md', '# 机制\n\n生产力\n')
      const passed = spawnSync(process.execPath, [scriptTarget], { encoding: 'utf-8', windowsHide: true })
      expect(passed.status).toBe(0)
      expect(passed.stdout).toContain('✅ RAG 散文术语检查通过')
    })
  })
})
