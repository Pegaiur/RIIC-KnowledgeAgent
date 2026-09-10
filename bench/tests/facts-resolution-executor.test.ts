import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import * as stores from '../src/facts/store.js'
import type { RecordCard } from '../src/facts/card.js'
import { buildIndex } from '../src/retriever.js'
import { createKnowledgeToolExecutor, serializeToolResult, type ToolExecutionResult } from '../src/tool-executor.js'

function executor(limit = 1) {
  const config = loadConfig()
  config.retriever = 'facts'
  return createKnowledgeToolExecutor({
    config, query: { id: 'RESOLUTION', category: 'fact', question: '词条协议回归' },
    chunks: [], index: buildIndex([]),
  }, limit)
}

function call(query: string, id = 'facts') {
  return { id, name: 'facts_search', arguments: JSON.stringify({ query }) }
}

function expectEnvelope(item: ToolExecutionResult, expectedIds: string[]) {
  expect(item.hitIds).toEqual(expectedIds)
  expect(item.injectedIds).toEqual(expectedIds)
  expect(item.factsResult).toMatchObject({
    factsResultVersion: 3, matchedCount: expectedIds.length, returnedCount: expectedIds.length, complete: true,
  })
  const envelope = JSON.parse(serializeToolResult(item))
  expect(envelope).toMatchObject({
    status: item.status, executed: item.executed, data: item.data,
    ...item.factsResult,
  })
  expect(item.data.match(/^【/gmu) ?? []).toHaveLength(expectedIds.length)
  for (const name of expectedIds) expect(item.data).toContain(`【${name}】`)
}

afterEach(() => vi.restoreAllMocks())

describe('真实词条的 executor 解析协议', () => {
  it('推王保留两名目标并计入 hitIds，不选择默认对象', async () => {
    const batch = await executor().executeBatch([call('推王')])
    const item = batch.results[0]!
    expect(item).toMatchObject({ status: 'success', executed: true })
    expectEnvelope(item, ['推进之王', '维娜·维多利亚'])
    expect(item.factsResult?.resolution.paths).toEqual([{
      kind: 'alias', term: '推王', targets: ['operator:推进之王', 'operator:维娜·维多利亚'],
      memberIds: ['推进之王', '维娜·维多利亚'], evidence: expect.any(Array),
    }])
  })

  it('叙拉古分别保留真实阵营和搭配成员，共享卡只输出和计数一次', async () => {
    const item = (await executor().executeBatch([call('叙拉古')])).results[0]!
    const paths = item.factsResult!.resolution.paths
    expect(paths.map((path) => path.kind)).toEqual(['exact', 'combo'])
    // 阵营名单取自 references/类别.md，搭配名单取自 guides/贸易站组合.md。
    const faction = '安洁莉娜、拉普兰德、普罗旺斯、红云、布洛卡、巫恋、铃兰、贾维、奥斯塔、斥罪、子月、伺夜、阿罗玛、忍冬、裁度、荒芜拉普兰德、贝洛内、复奏'.split('、')
    expect(paths[0]).toMatchObject({ kind: 'exact', category: 'faction' })
    expect([...paths[0]!.memberIds].sort()).toEqual(faction.sort())
    expect(paths[1]).toMatchObject({ kind: 'combo', combo: { id: 'combo:叙拉古' } })
    expect([...paths[1]!.memberIds].sort()).toEqual(['伺夜', '八幡海铃', '贝洛内'].sort())
    expect(item.hitIds).toHaveLength(19)
    expect(new Set(item.hitIds)).toEqual(new Set([...faction, '八幡海铃']))
    expectEnvelope(item, item.hitIds!)
    expect(item).toMatchObject({ status: 'success', executed: true })
  })

  it('企鹅物流仅返回已登记搭配，不伪造真源中不存在的阵营路径', async () => {
    const item = (await executor().executeBatch([call('企鹅物流')])).results[0]!
    expect(item.factsResult?.resolution.paths).toMatchObject([{ kind: 'combo', combo: { id: 'combo:企鹅物流' } }])
    expectEnvelope(item, ['能天使', '德克萨斯', '拉普兰德'])
  })

  it('莱茵科技的开放范围不影响已匹配卡的 complete', async () => {
    const item = (await executor().executeBatch([call('莱茵科技')])).results[0]!
    expect(item.factsResult?.resolution.paths).toMatchObject([{
      kind: 'combo', combo: { coverage: 'open', openScope: expect.stringContaining('莱茵科技类制造技能') },
    }])
    expectEnvelope(item, ['多萝西', '娜斯提', '淬羽赫默'])
    expect(item.data).toContain('开放、非穷尽')
  })

  it.each(['德狼', '能蕾', '银崖', '孑拉德'])('%s 不作为简写合称接入', async (query) => {
    const item = (await executor().executeBatch([call(query)])).results[0]!
    expect(item).toMatchObject({ status: 'empty', executed: true, factsResult: { resolution: { paths: [] } } })
    expectEnvelope(item, [])
  })
})

describe('拒绝及错误路径的 executor 边界', () => {
  it.each([false, true])('旧称拒绝与精确命中共存=%s 时保留路径、状态及真实计数', async (withExact) => {
    const card: RecordCard = {
      canonical: '拒绝词', aliases: [], rarity: '4', class: '医疗', rooms: [], factionGroups: [], skillGroups: [], skills: [], notes: '',
    }
    const store = stores.buildCardStore(withExact ? [card] : [], {
      aliases: [], substrings: [], combos: [], legacyNames: [{
        text: '拒绝词', action: 'reject', reason: '此旧称解释已废弃',
        evidence: [{ path: 'knowledge/guides/测试.md', section: '测试依据' }],
      }],
    })
    vi.spyOn(stores, 'getCardStore').mockReturnValue(store)
    const batch = await executor().executeBatch([call('拒绝词')])
    const item = batch.results[0]!
    expect(item).toMatchObject({ status: withExact ? 'success' : 'empty', executed: true })
    expectEnvelope(item, withExact ? ['拒绝词'] : [])
    expect(item.factsResult?.resolution.paths.map((path) => path.kind)).toEqual(withExact ? ['exact', 'rejected'] : ['rejected'])
    expect(item.factsResult?.resolution.paths.at(-1)).toMatchObject({ kind: 'rejected', reason: '此旧称解释已废弃', memberIds: [] })
    expect(item.data).toContain('此旧称解释已废弃')
    expect(item.data).not.toContain('未收录精确词条')
    expect(batch.snapshot).toMatchObject({ used: 1, executed: 1, remaining: 0 })
  })

  it('store 加载失败、参数无效及预算拒绝不伪造 resolution', async () => {
    const getStore = vi.spyOn(stores, 'getCardStore').mockImplementation(() => { throw new Error('测试 store 加载失败') })
    const batch = await executor(2).executeBatch([call(' ', 'invalid'), call('推王', 'error'), call('维娜', 'denied')])
    expect(batch.results.map((item) => [item.status, item.executed])).toEqual([
      ['invalid_params', false], ['error', true], ['budget_exhausted', false],
    ])
    expect(batch.results[1]?.data).toContain('测试 store 加载失败')
    expect(getStore).toHaveBeenCalledTimes(1)
    for (const item of batch.results) {
      expect(item.factsResult).toBeUndefined()
      const envelope = JSON.parse(serializeToolResult(item))
      expect(envelope).not.toHaveProperty('resolution')
      expect(envelope).not.toHaveProperty('factsResultVersion')
    }
    expect(batch.snapshot).toMatchObject({ used: 2, executed: 1, denied: 1, remaining: 0 })
  })
})
