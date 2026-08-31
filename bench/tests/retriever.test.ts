import { describe, expect, it } from 'vitest'
import { buildIndex, search, tokenize } from '../src/retriever.js'
import type { DocChunk } from '../src/types.js'

describe('retriever：分词与 BM25 检索', () => {
  it('中文串生成 bigram 与 unigram', () => {
    const tokens = tokenize('发电站无人机')
    expect(tokens).toContain('发电')
    expect(tokens).toContain('电站')
    expect(tokens).toContain('无人')
    expect(tokens).toContain('人机')
    expect(tokens).toContain('发')
  })

  it('拉丁词降序保留并小写化', () => {
    const tokens = tokenize('LMD 干员 243')
    expect(tokens).toContain('lmd')
    expect(tokens).toContain('243')
  })

  it('BM25 命中相关片段并排首位', () => {
    const chunks: DocChunk[] = [
      { id: 'a', file: 'a.md', heading: '发电站', text: '发电站无人机受到发电站干员影响，充能不设上限，溢满不停工。', startLine: 2, endLine: 2 },
      { id: 'b', file: 'b.md', heading: '贸易站', text: '贸易站订单处理与订单上限受控制中枢影响。', startLine: 2, endLine: 2 },
      { id: 'c', file: 'c.md', heading: '宿舍', text: '干员心情在宿舍恢复，恢复速度受寢室等级影响。', startLine: 2, endLine: 2 },
    ]
    const index = buildIndex(chunks)
    const top = search(index, '发电站无人机充能机制', 2)
    expect(top[0]).toBe(0)
    expect(top).toHaveLength(2)
  })

  it('空语料返回空结果', () => {
    const index = buildIndex([])
    expect(search(index, '任何查询', 5)).toEqual([])
  })

  it('锚定：体系名经 anchor 可命中不含体系名的答案块', () => {
    const anchored: DocChunk[] = [
      { id: 'a', file: 'a.md', heading: '一句话结论', text: '核心双人产出木天蓼，缺一不可。', anchor: '怪猎中枢 火龙S黑角 麒麟R夜刀', startLine: 2, endLine: 2 },
      { id: 'b', file: 'b.md', heading: '排班', text: '中枢干员随体系班次轮换。', startLine: 2, endLine: 2 },
    ]
    // 无锚定：答案块 a 不含体系名词元，查体系名命中的是含「中枢」的 b
    const noAnchor = search(buildIndex(anchored.map(({ anchor, ...rest }) => rest)), '怪猎中枢', 1)
    // 有锚定：a 经 anchor 命中体系名词元，排首位
    const withAnchor = search(buildIndex(anchored), '怪猎中枢', 1)
    expect(noAnchor[0]).toBe(1)
    expect(withAnchor[0]).toBe(0)
  })
})
