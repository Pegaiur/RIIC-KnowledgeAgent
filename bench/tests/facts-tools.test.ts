import { describe, expect, it, beforeEach, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { buildIndex } from '../src/retriever.js'
import { buildSystemPrompt, queryOperatorsTool, runQuery, lookupTool } from '../src/agent.js'
import { buildCardStore, getCardStore, serializeCards } from '../src/facts/store.js'
import { FACTS_FIXTURES } from '../src/facts/fixtures.js'
import type { ProviderResult } from '../src/types.js'
import type { DocChunk } from '../src/types.js'
import type { RecordCard } from '../src/facts/card.js'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))
vi.mock('../src/provider.js', () => ({ callLLM: mockCall }))

function toolName(tool: Record<string, unknown>): string {
  const fn = tool.function as { name: string }
  return fn.name
}

describe('store：lookup 解析', () => {
  const store = buildCardStore(FACTS_FIXTURES)

  it('canonical 精确命中单卡', () => {
    const hits = store.lookup('刻俄柏')
    expect(hits).toHaveLength(1)
    expect(hits[0].canonical).toBe('刻俄柏')
  })

  it('技能名命中（裁缝·α → 巫恋）', () => {
    expect(store.lookup('裁缝·α').map((c) => c.canonical)).toEqual(['巫恋'])
  })

  it('技能组命中（莱茵科技类技能 → 多萝西）', () => {
    expect(store.lookup('莱茵科技类技能').map((c) => c.canonical)).toEqual(['多萝西'])
  })

  it('等价组技能名展开命中全部同效持有者', () => {
    expect(new Set(getCardStore().lookup('裁缝·β').map((card) => card.canonical))).toEqual(new Set(['卡夫卡', '折光', '明椒', '柏喙']))
  })

  it('未命中返回空列表', () => {
    expect(store.lookup('不存在的干员')).toEqual([])
  })
})

describe('store：queryOperators 分类过滤', () => {
  const store = getCardStore()

  it('按设施 room 过滤', () => {
    const canonicals = store.queryOperators({ room: '制造站' }).map((c) => c.canonical)
    expect(canonicals).toContain('刻俄柏')
    expect(canonicals).toContain('森蚺')
    expect(canonicals).not.toContain('巫恋')
  })

  it('按阵营 faction 过滤（怪物猎人小队 → 3）', () => {
    expect(store.queryOperators({ faction: '怪物猎人小队' })).toHaveLength(3)
  })

  it('按职业 profession 过滤（近卫）', () => {
    const canonicals = store.queryOperators({ profession: '近卫' }).map((c) => c.canonical)
    expect(canonicals).toContain('火龙S黑角')
    expect(canonicals).not.toContain('森蚺') // 森蚺为重装
  })

  it('组合过滤（萨尔贡 + 制造站 → 森蚺）', () => {
    const canonicals = store.queryOperators({ faction: '萨尔贡', room: '制造站' }).map((c) => c.canonical)
    expect(canonicals).toContain('森蚺')
  })

  it('termQuery 字面子串命中（木天蓼 → 怪猎三卡）', () => {
    expect(store.queryOperators({ termQuery: '木天蓼' })).toHaveLength(3)
  })

  it('excludeIds 按 canonical 排除', () => {
    const canonicals = store.queryOperators({ room: '制造站', excludeIds: ['  森蚺 ', '', '   '] }).map((c) => c.canonical)
    expect(canonicals).not.toContain('森蚺')
  })

  it('不存在的设施返回空', () => {
    expect(store.queryOperators({ room: '不存在设施' })).toEqual([])
  })

  it('room + termQuery 必须命中同一设施技能，不能跨设施串线', () => {
    const multiRoom: RecordCard = {
      canonical: '跨设施样例',
      aliases: [],
      rarity: '6',
      class: '术师',
      rooms: ['制造站', '会客室'],
      factionGroups: [],
      skillGroups: [],
      skills: [
        { name: '制造技能', unlockType: '初始解锁', target: '', effectText: '制造站专用关键词', room: '制造站', grantId: 'grant:1' },
        { name: '会客技能', unlockType: '初始解锁', target: '', effectText: '会客室其他内容', room: '会客室', grantId: 'grant:2' },
      ],
      notes: '',
    }
    const scopedStore = buildCardStore([multiRoom])
    expect(scopedStore.queryOperators({ room: '制造站', termQuery: '制造站专用' })).toHaveLength(1)
    expect(scopedStore.queryOperators({ room: '会客室', termQuery: '制造站专用' })).toHaveLength(0)
    const serialized = serializeCards(scopedStore.queryOperators({ room: '会客室' }), { room: '会客室' })
    expect(serialized).toContain('会客技能')
    expect(serialized).not.toContain('制造技能')
  })

  it('旧多设施 fixture 缺少技能 room 时宁可不命中，也不跨设施串线', () => {
    expect(store.queryOperators({ room: '控制中枢', termQuery: '每个发电站' })).toEqual([])
  })

  it('技能类别和人工备注也必须受 room 作用域约束', () => {
    expect(store.queryOperators({ room: '办公室', termQuery: '莱茵科技类技能' }).map((card) => card.canonical)).not.toContain('淬羽赫默')
    expect(store.queryOperators({ room: '会客室', termQuery: '标准化类技能' }).map((card) => card.canonical)).not.toContain('杰西卡')
    expect(store.queryOperators({ room: '办公室', termQuery: '技能级人工确认说明' })).toEqual([])
  })

  it('拒绝重复 canonical，避免索引静默覆盖', () => {
    expect(() => buildCardStore([FACTS_FIXTURES[0], { ...FACTS_FIXTURES[0] }])).toThrow('记录卡 canonical 重复')
  })

  it('serializeCards 渲染命中卡', () => {
    const text = serializeCards(store.lookup('迷迭香'))
    expect(text).toContain('迷迭香')
    expect(text).toContain('6星')
    expect(text).toContain('超感')
  })
})

describe('agent：facts 工具 schema 与系统提示', () => {
  it('lookup/query_operators 为两个独立 schema（函数名不同）', () => {
    expect(toolName(lookupTool())).toBe('lookup')
    expect(toolName(queryOperatorsTool())).toBe('query_operators')
  })

  it('lookup 暴露 term 参数；query_operators 暴露过滤字段', () => {
    const lf = lookupTool().function as { parameters: { required: string[]; properties: Record<string, unknown> } }
    expect(lf.parameters.required).toEqual(['term'])
    const qo = queryOperatorsTool().function as { description: string; parameters: { properties: Record<string, unknown> } }
    for (const f of ['room', 'faction', 'profession', 'excludeIds', 'termQuery']) {
      expect(qo.parameters.properties[f]).toBeDefined()
    }
    expect(qo.parameters.properties.rarity).toBeUndefined()
    expect(qo.description).not.toContain('星级')
  })

  it('系统提示 facts 分支描述两工具与检索上限', () => {
    const prompt = buildSystemPrompt('facts')
    expect(prompt).toContain('lookup')
    expect(prompt).toContain('query_operators')
    expect(prompt).toContain('知识库未查到')
    expect(prompt).not.toContain('星级')
  })
})

describe('runQuery（facts 模式）', () => {
  const chunks: DocChunk[] = []
  const queryOperatorsSpy = vi.spyOn(getCardStore(), 'queryOperators')
  const INVALID_QUERY_RESULT = '查询参数无效：请至少提供非空的设施、阵营、职业或关键词。'

  function toolCall(name: string, args: string) {
    return { id: 'call_1', name, arguments: args }
  }

  function providerResult(partial: Partial<ProviderResult>): ProviderResult {
    return {
      content: null,
      toolCalls: [],
      usage: { input: 100, output: 50, cached: 0, reasoning: 0 },
      model: 'qwen',
      truncated: false,
      ...partial,
    }
  }

  beforeEach(() => {
    mockCall.mockReset()
    queryOperatorsSpy.mockClear()
  })

  async function runQueryOperatorsCall(argumentsText: string) {
    const config = loadConfig()
    config.retriever = 'facts'
    config.maxRounds = 1
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('query_operators', argumentsText) } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    const result = await runQuery(
      { id: 'INVALID', category: 'fact', question: '测试 query_operators 参数' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )
    const secondCallMessages = mockCall.mock.calls[1]?.[0] as Array<{ role: string; content: string }> | undefined
    const toolResult = secondCallMessages?.find((message) => message.role === 'tool')?.content
    return { result, toolResult }
  }

  it.each([
    ['空对象', '{}'],
    ['非法 JSON', '{'],
    ['空白 termQuery', '{"termQuery":"   "}'],
    ['仅 excludeIds', '{"excludeIds":["刻俄柏"]}'],
    ['仅已删除 rarity', '{"rarity":"5"}'],
  ])('%s 被拒绝，且不查询或序列化干员卡', async (_label, argumentsText) => {
    const { result, toolResult } = await runQueryOperatorsCall(argumentsText)

    expect(toolResult).toBe(INVALID_QUERY_RESULT)
    expect(toolResult).not.toContain('【')
    expect(toolResult).not.toContain('刻俄柏')
    expect(queryOperatorsSpy).not.toHaveBeenCalled()
    expect(result.toolRounds).toBe(1)
  })

  it.each([
    ['room', '{"room":"  制造站 "}', { room: '制造站' }],
    ['faction', '{"faction":"  萨尔贡 "}', { faction: '萨尔贡' }],
    ['profession', '{"profession":"  近卫 "}', { profession: '近卫' }],
    ['termQuery', '{"termQuery":"  木天蓼 "}', { termQuery: '木天蓼' }],
  ])('%s 作为单独正向条件有效并完成 trim', async (_label, argumentsText, expectedFilters) => {
    await runQueryOperatorsCall(argumentsText)
    expect(queryOperatorsSpy).toHaveBeenCalledWith(expectedFilters)
  })

  it('有效正向条件下 excludeIds 元素 trim 且忽略空字符串', async () => {
    const { toolResult } = await runQueryOperatorsCall('{"room":"  制造站 ","excludeIds":["  森蚺 ","","   "]}')

    expect(toolResult).toBeDefined()
    expect(toolResult).not.toContain('【森蚺】')
    expect(queryOperatorsSpy).toHaveBeenCalledWith({ room: '制造站', excludeIds: ['森蚺'] })
  })

  it('facts 模式暴露 lookup，派发并统计工具调用', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    config.maxRounds = 3
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('lookup', '{"term":"刻俄柏"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '刻俄柏 制造站仓库上限+8' }))

    const result = await runQuery(
      { id: 'T01', category: 'fact', question: '刻俄柏有什么技能？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('刻俄柏 制造站仓库上限+8')
    expect(result.toolTrace[0]).toEqual(['lookup'])
    expect(result.records[0].tools).toEqual(['lookup'])
  })

  it('facts 模式同时支持 query_operators 派发', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    config.maxRounds = 3
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('query_operators', '{"room":"制造站"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '制造站干员包括……' }))

    const result = await runQuery(
      { id: 'T02', category: 'fact', question: '制造站有哪些干员？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('制造站干员包括……')
    expect(result.records[0].tools).toEqual(['query_operators'])
  })

  it('facts 工具超出检索预算时提示上限，不反复检索', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    config.maxRounds = 2
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('lookup', '{"term":"刻俄柏"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('lookup', '{"term":"能天使"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    const result = await runQuery(
      { id: 'T03', category: 'fact', question: '刻俄柏？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('最终答案')
    // 第 2 次已达 MAX_RAG_CALLS=2 上限，第 3 轮（兜底）无工具调用直接作答
    expect(result.toolRounds).toBe(2)
    expect(result.records[1].tools).toEqual(['lookup'])
  })

  it('facts 工具请求超过检索预算后注入「已达上限」提示文本，不反复检索', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    config.maxRounds = 3
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('lookup', '{"term":"刻俄柏"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('lookup', '{"term":"能天使"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('lookup', '{"term":"夕"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    const result = await runQuery(
      { id: 'T04', category: 'fact', question: '刻俄柏？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('最终答案')
    expect(result.toolRounds).toBe(3)
    // 第 4 轮（兜底）请求前的 messages 应含第 3 轮注入的「已达上限」提示
    const msgs = mockCall.mock.calls[3]?.[0] as Array<{ role: string; content: string }>
    expect(msgs.some((m) => m.role === 'tool' && m.content.includes('已达到知识库检索上限'))).toBe(true)
  })
})
