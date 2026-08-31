import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { collectMarkdownFiles, splitChunks } from '../src/corpus.js'

const tmp = mkdtempSync(join(tmpdir(), 'rag-test-corpus-'))
const docsDir = join(tmp, 'docs')

mkdirSync(docsDir, { recursive: true })

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function writeDoc(rel: string, content: string): string {
  const full = join(docsDir, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf-8')
  return full
}

describe('corpus：语料收集与分块', () => {
  it('递归收集 .md 文件', () => {
    writeDoc('0-规则/发电站机制.md', '# 发电站\n## 无人机\n正文A\n## 充能\n正文B\n')
    writeDoc('2-体系/体系总览.md', '# 总览\n## 243 布局\n正文C\n')
    const files = collectMarkdownFiles(docsDir)
    expect(files).toHaveLength(2)
    expect(files.some((f) => f.endsWith('发电站机制.md'))).toBe(true)
  })

  it('按 ## 标题切分，front matter 与注释剔除', () => {
    const file = writeDoc(
      '散件速查.md',
      '---\nfrontmatter: true\n---\n# 散件干员速查\n[//]: # 模板注释\n## 贸易锚点\n焰狐龙梓兰 +10%\n## 办公室\n无',
    )
    const chunks = splitChunks(file, docsDir)
    const headings = chunks.map((c) => c.heading)
    expect(headings).toContain('贸易锚点')
    expect(headings).toContain('办公室')
    expect(headings).not.toContain('散件干员速查')
    const anchor = chunks.find((c) => c.heading === '贸易锚点')!
    expect(anchor.text).toContain('焰狐龙梓兰')
    expect(anchor.text).not.toContain('模板注释')
  })

  it('无标题文档归入（未分段）', () => {
    const file = writeDoc('无标题.md', '只有正文没有标题。\n第二行。\n')
    const chunks = splitChunks(file, docsDir)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].heading).toBe('（未分段）')
  })
})
