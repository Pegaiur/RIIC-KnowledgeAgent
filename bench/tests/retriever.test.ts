import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { buildIndex, currentEntityBoost, search, tokenize } from '../src/retriever.js'
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

describe('retriever：jieba 分词（BENCH_TOKENIZER=jieba，ADR-001）', () => {
  const prev = process.env.BENCH_TOKENIZER
  beforeEach(() => {
    process.env.BENCH_TOKENIZER = 'jieba'
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.BENCH_TOKENIZER
    else process.env.BENCH_TOKENIZER = prev
  })

  it('词级分词与 bigram 的 token 集对照（无 bigram 跨词碎片）', () => {
    const tokens = tokenize('发电站无人机')
    expect(tokens).toContain('发电站')
    expect(tokens).toContain('无人机')
    expect(tokens).not.toContain('人机') // bigram 跨词碎片不应出现
    expect(tokens).not.toContain('电站')
  })

  it('词典词不被切开（ENTITY_WORDS 注册生效）', () => {
    const tokens = tokenize('承曦格雷伊驱动虚拟电站')
    expect(tokens).toContain('承曦格雷伊') // 默认 jieba 会切碎为 承曦/格雷/伊，词典后保持单 token
    expect(tokens).toContain('虚拟电站')
    expect(tokens).not.toContain('格雷')
  })

  it('jieba 模式 BM25 命中相关片段并排首位', () => {
    const chunks: DocChunk[] = [
      { id: 'a', file: 'a.md', heading: '发电站', text: '发电站无人机受到发电站干员影响，充能不设上限。', startLine: 2, endLine: 2 },
      { id: 'b', file: 'b.md', heading: '贸易站', text: '贸易站订单处理与订单上限受控制中枢影响。', startLine: 2, endLine: 2 },
    ]
    const top = search(buildIndex(chunks), '发电站无人机充能机制', 2)
    expect(top[0]).toBe(0)
  })

  it('无相关查询返回空数组（回退宽化后仍无命中不崩溃）', () => {
    const chunks: DocChunk[] = [
      { id: 'a', file: 'a.md', heading: '发电站', text: '发电站无人机充能机制。', startLine: 2, endLine: 2 },
    ]
    const index = buildIndex(chunks)
    expect(search(index, '巫恋裁缝核订单分布', 3)).toEqual([])
  })
})

describe('retriever：P2 实体加权（BENCH_ENTITY_BOOST>0）', () => {
  const prev = process.env.BENCH_ENTITY_BOOST
  afterEach(() => {
    if (prev === undefined) delete process.env.BENCH_ENTITY_BOOST
    else process.env.BENCH_ENTITY_BOOST = prev
  })

  it('默认（未设）时加权因子为 0，保持基线', () => {
    delete process.env.BENCH_ENTITY_BOOST
    expect(currentEntityBoost()).toBe(0)
  })

  it('env 取正数倍率；非正数视为关闭', () => {
    process.env.BENCH_ENTITY_BOOST = '1.5'
    expect(currentEntityBoost()).toBe(1.5)
    process.env.BENCH_ENTITY_BOOST = '0'
    expect(currentEntityBoost()).toBe(0)
    process.env.BENCH_ENTITY_BOOST = '-2'
    expect(currentEntityBoost()).toBe(0)
  })

  it('含专名词元的块命中查询专名，权重放大后仍正确检索', () => {
    process.env.BENCH_ENTITY_BOOST = '1.5'
    const chunks: DocChunk[] = [
      { id: 'a', file: 'a.md', heading: '红松林经验', text: '灰毫 红松骑士团 β 加百分之二十五。', startLine: 2, endLine: 2 },
      { id: 'b', file: 'b.md', heading: '制造', text: '制造站效率受赤金线影响。', startLine: 2, endLine: 2 },
    ]
    const index = buildIndex(chunks)
    // 查询词「灰毫」为实体词（2 字，bigram 下保持单词元），命中含该专名的块
    expect(search(index, '灰毫', 1)[0]).toBe(0)
  })

  it('判别性：boost 改变排序——唯一含实体词的块在放大后反超纯通用词块', () => {
    // 查询「巫恋 效率」：巫恋（实体词）+ 效率（通用词）。
    // 块 A 唯一含实体词「巫恋」；块 B 只含通用词「效率」但词频极高。
    // boost=0：B 靠「效率」高频居首；boost=1.5：A 的「巫恋」被放大后反超。
    const chunks: DocChunk[] = [
      { id: 'a', file: 'a.md', heading: '巫恋', text: '巫恋 低语。', startLine: 2, endLine: 2 },
      { id: 'b', file: 'b.md', heading: '贸易', text: '效率 效率 效率 效率 效率 效率 效率。', startLine: 2, endLine: 2 },
    ]
    const index = buildIndex(chunks)
    delete process.env.BENCH_ENTITY_BOOST
    const baseOrder = search(index, '巫恋 效率', 2)
    process.env.BENCH_ENTITY_BOOST = '1.5'
    const boostOrder = search(index, '巫恋 效率', 2)
    // boost 生效意味着排序被改写（而非维持基线排序）——若实现被删，本断言即失败
    expect(boostOrder.join(',')).not.toBe(baseOrder.join(','))
    // 放大后含实体词「巫恋」的块 A 升至首位
    expect(boostOrder[0]).toBe(0)
    // 基线（未加权）下纯通用词块 B 因「效率」词频更高而居前
    expect(baseOrder[0]).toBe(1)
  })

  it('单字专名（望/砾/夕等）不参与放大，避免歧义词元误命中', () => {
    process.env.BENCH_ENTITY_BOOST = '1.5'
    const chunks: DocChunk[] = [
      { id: 'a', file: 'a.md', heading: '中枢', text: '夕 在 中枢 产 感知。', startLine: 2, endLine: 2 },
      { id: 'b', file: 'b.md', heading: '杂谈', text: '夕 夕 夕 夕 夕 夕 夕。', startLine: 2, endLine: 2 },
    ]
    const index = buildIndex(chunks)
    // 「夕」为单字专名，长度<2 不放大；两块在都是含「夕」的 unigram 时，B 词频高仍靠前（无放大改写）
    const top = search(index, '夕', 1)
    expect(top[0]).toBe(1)
  })
})
