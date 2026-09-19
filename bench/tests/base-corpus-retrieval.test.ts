import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCorpus } from '../src/corpus.js'
import { buildIndex, search } from '../src/retriever.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const KNOWLEDGE_ROOT = join(ROOT, 'knowledge')

const cases = [
  ['F01', '发电站无人机的充能机制是什么？充能是否会受到发电站干员的影响？', 'base/设施/机制-发电站.md', '无人机充能速度：单站加成与全站合计'],
  ['F02', '制造站受干员技能加成的效率计算规则是怎样的？', 'base/设施/机制-制造站.md', '生产力、心情消耗与已节省计时'],
  ['F03', '贸易站订单的处理机制与订单上限受什么影响？', 'base/设施/机制-贸易站.md', '订单获取效率、处理时间与订单上限'],
  ['F04', '会客室线索获取与线索交流的机制要点是什么？', 'base/设施/机制-会客室.md', '线索交流、传递与回收的条件'],
  ['F05', '办公室的联络速度由什么决定？哪些干员能提供联络速度加成？', 'base/设施/机制-办公室.md', '联络计时、速度加成与间隔换算'],
  ['F06', '控制中枢的加成如何作用于其他基建设施？', 'base/设施/机制-控制中枢.md', '全局心情减免的人数项与设施范围'],
  ['F07', '干员心情消耗与宿舍恢复的规则是什么？', 'base/设施/机制-宿舍.md', '心情恢复公式：宿舍等级、实际氛围与技能'],
  ['F08', '排班轮换策略中常用的三队轮换模式是如何运作的？', 'base/通则/机制-排班与轮换.md', '三组三班结构与设施两半轮转'],
  ['F09', '干员练度与技能等级对基建技能效果的影响规则是什么？', 'base/通则/机制-技能解锁与练度.md', '干员练度、技能解锁档与低星等级门槛'],
  ['F10', 'buff 叠加模型中，不同类型的基建技能效果是如何叠加的？', 'base/通则/机制-后勤技能结算.md', '同种效果取最高、加成叠加与技能替换'],
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

  it('总览将工作状态、换位暖机和队列规则分开定位，保留各自完整条件', () => {
    const chunks = loadCorpus(KNOWLEDGE_ROOT).filter((chunk) => chunk.file === 'base/机制-基建总览.md')
    const state = chunks.find((chunk) => chunk.heading === '进驻标识、工作状态与注意力涣散')
    const seats = chunks.find((chunk) => chunk.heading === '进驻工位匹配、换位与暖机重置')
    const rotation = chunks.find((chunk) => chunk.heading === '预设队列轮换、干员休整与宿舍锁定')
    expect(state?.text).toContain('即使标识为「空闲中/休息中」也算工作状态')
    expect(state?.text).toContain('注意力涣散干员不算工作状态')
    expect(seats?.text).toContain('位置相同')
    expect(seats?.text).toContain('换位时被重置')
    expect(rotation?.text).toContain('3 个预设队列')
    expect(rotation?.text).toContain('干员休整仅在非锁定位置进行')
    expect(state?.text).not.toContain('换位时被重置')
    expect(seats?.text).not.toContain('3 个预设队列')
  })

})
