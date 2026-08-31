import { describe, expect, it } from 'vitest'
import {
  buildGrepPatterns,
  buildGrepResult,
  grepSearch,
  MAX_PATTERN_LEN,
} from '../src/grep-retriever.js'
import type { DocChunk } from '../src/types.js'

function chunk(id: string, file: string, heading: string, text: string): DocChunk {
  return { id, file, heading, text, startLine: 2, endLine: 2 }
}

describe('grep-retriever：字面命中计数检索（P3 对照）', () => {
  it('查询构造：实体词表优先 + 中文段短语，去重', () => {
    const patterns = buildGrepPatterns('德克萨斯 贸易站 效率')
    expect(patterns).toContain('德克萨斯') // 实体优先
    expect(patterns).toContain('贸易站')
    expect(patterns).toContain('效率')
    // 拉丁串整体保留为短语
    expect(buildGrepPatterns('Castle-3 干员')).toContain('Castle-3')
  })

  it('命中排序：专名（实体）> 泛词', () => {
    const chunks: DocChunk[] = [
      chunk('a', 'a.md', '贸易站', '德克萨斯在贸易站，宿舍效率提升。'), // 含实体德克萨斯
      chunk('b', 'b.md', '贸易站', '贸易站订单处理效率高。'), // 不含实体
    ]
    const top = grepSearch(chunks, '德克萨斯 贸易站 效率', 2)
    expect(top[0]).toBe(0) // 含专名的 chunk 命中模式更多，排首位
  })

  it('无命中：grepSearch 返回空，buildGrepResult 提示改述查询', () => {
    const chunks: DocChunk[] = [chunk('a', 'a.md', '贸易站', '订单处理与上限。')]
    expect(grepSearch(chunks, '夜莺', 5)).toEqual([])
    const result = buildGrepResult(chunks, [], '夜莺', 12000)
    expect(result).toContain('未找到匹配')
    expect(result).toContain('夜莺')
  })

  it('正则元字符转义："红松林(+)" 不因字面匹配而抛错', () => {
    const chunks: DocChunk[] = [chunk('a', 'a.md', '红松林', '红松林(+) 实验组表现。')]
    const top = grepSearch(chunks, '红松林(+)', 1)
    expect(top).toEqual([0])
  })

  it('长度超限：query 超长被拒绝，返回空', () => {
    const chunks: DocChunk[] = [chunk('a', 'a.md', '贸易站', '德克萨斯。')]
    const longQuery = '德'.repeat(MAX_PATTERN_LEN + 1)
    expect(grepSearch(chunks, longQuery, 5)).toEqual([])
  })

  it('控制字符：query 含控制字符被拒绝；展示时清理命中行控制字符', () => {
    const chunks: DocChunk[] = [
      chunk('a', 'a.md', '贸易站', '德克萨斯\u0001在贸易站，效率高。'),
    ]
    // 查询含控制字符 → 拒绝
    expect(grepSearch(chunks, '德\x00萨斯', 5)).toEqual([])
    // 正文含控制字符 → 展示时清理
    const result = buildGrepResult(chunks, [0], '德克萨斯', 12000)
    expect(result).not.toContain('\u0001')
    expect(result).toContain('德克萨斯在贸易站')
  })

  it('2 字滑窗回退：整段短语未命中时用 bigram 补充召回', () => {
    const chunks: DocChunk[] = [
      chunk('a', 'a.md', '发电站', '发电站无人机充能机制，充能加速公式详细说明。'),
      chunk('b', 'b.md', '贸易站', '贸易站订单上限。'),
    ]
    // 「充能机制详解」整段不字面出现，但 bigram（充能/能机/机制）命中 chunk a
    const top = grepSearch(chunks, '充能机制详解', 2)
    expect(top[0]).toBe(0)
  })

  it('输出格式：头部含行号范围与命中数', () => {
    const chunks: DocChunk[] = [chunk('a', 'a.md', '贸易站', '德克萨斯在贸易站。')]
    const result = buildGrepResult(chunks, [0], '德克萨斯', 12000)
    expect(result).toContain('【a.md | 贸易站 | L2-2】')
    expect(result).toContain('命中')
    expect(result).toContain('L2: 德克萨斯在贸易站。')
  })
})
