import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCorpus } from '../src/corpus.js'
import { buildIndex, search } from '../src/retriever.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const KNOWLEDGE_ROOT = join(ROOT, 'knowledge')

const cases = [
  ['F01', '发电站无人机的充能机制是什么？充能是否会受到发电站干员的影响？', 'base/机制-发电站.md', '无人机充能速度'],
  ['F02', '制造站受干员技能加成的效率计算规则是怎样的？', 'base/机制-制造站.md', '生产力与心情消耗'],
  ['F03', '贸易站订单的处理机制与订单上限受什么影响？', 'base/机制-贸易站.md', '订单获取效率、处理时间与订单上限'],
  ['F04', '会客室线索获取与线索交流的机制要点是什么？', 'base/机制-会客室.md', '线索交流与传递'],
  ['F05', '办公室的联络速度由什么决定？哪些干员能提供联络速度加成？', 'base/机制-办公室.md', '联络计时与速度'],
  ['F06', '控制中枢的加成如何作用于其他基建设施？', 'base/机制-控制中枢.md', '全局心情减免与作用范围'],
  ['F07', '干员心情消耗与宿舍恢复的规则是什么？', 'base/机制-宿舍.md', '心情恢复公式'],
  ['F08', '排班轮换策略中常用的三队轮换模式是如何运作的？', 'base/机制-心情与工休.md', '组合与宿舍约束'],
  ['F09', '干员练度与技能等级对基建技能效果的影响规则是什么？', 'base/机制-技能解锁与练度.md', '练度、技能等级与解锁档位'],
  ['F10', 'buff 叠加模型中，不同类型的基建技能效果是如何叠加的？', 'base/机制-后勤技能结算.md', '取最高与可叠加'],
] as const

describe('base 机制块 BM25 定位回归', () => {
  it.each(cases)('%s 的目标机制块进入 top 5', (_id, query, targetFile, targetHeading) => {
    const chunks = loadCorpus(KNOWLEDGE_ROOT)
    const index = buildIndex(chunks)
    const top = search(index, query, 5).map((idx) => chunks[idx])
    expect(
      top.some((chunk) => chunk.file === targetFile && chunk.heading === targetHeading),
      `查询“${query}”未定位到 ${targetFile} 的“${targetHeading}”机制块`,
    ).toBe(true)
  })
})
