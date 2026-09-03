import { describe, expect, it } from 'vitest'
import { parseNameRow, verifyMechanicalCard } from '../src/facts/mechanical.js'
import { FACTS_FIXTURES } from '../src/facts/fixtures.js'
import type { RecordCard } from '../src/facts/card.js'

describe('mechanical：名册.md 解析（程序化预填机械字段）', () => {
  it('解析「单设施、无组」的行', () => {
    expect(parseNameRow('- 刻俄柏 | ☆6 | 术师 | 制造站')).toEqual({
      canonical: '刻俄柏',
      rarity: '☆6',
      class: '术师',
      rooms: ['制造站'],
      groups: [],
    })
  })

  it('解析「多设施、有组」的行（顿号分隔房间与组）', () => {
    expect(parseNameRow('- 森蚺 | ☆6 | 重装 | 制造站、控制中枢 | 萨尔贡')).toEqual({
      canonical: '森蚺',
      rarity: '☆6',
      class: '重装',
      rooms: ['制造站', '控制中枢'],
      groups: ['萨尔贡'],
    })
  })

  it('名册行缺失所属组时 groups 为空数组', () => {
    expect(parseNameRow('- 伊内丝 | ☆6 | 先锋 | 会客室、办公室').groups).toEqual([])
  })
})

describe('程序化核对断言：机械字段与 references 逐字 0 差异', () => {
  for (const { card, source } of FACTS_FIXTURES) {
    it(`${card.canonical} 的 canonical/rarity/class/rooms/groups 全部逐字命中 references 原行（0 差异）`, () => {
      const res = verifyMechanicalCard(card, source)
      expect(res.ok).toBe(true)
      expect(res.mismatches).toEqual([])
    })
  }

  it('篡改机械字段（非法房间）被断言打回', () => {
    const { card, source } = FACTS_FIXTURES[0]
    const tampered: RecordCard = { ...card, rooms: ['宿舍'] }
    const res = verifyMechanicalCard(tampered, source)
    expect(res.ok).toBe(false)
    expect(res.mismatches).toContain('rooms：宿舍')
  })

  it('机械字段缺失（空 canonical）被断言打回', () => {
    const { card, source } = FACTS_FIXTURES[1]
    const tampered: RecordCard = { ...card, canonical: '' }
    expect(verifyMechanicalCard(tampered, source).ok).toBe(false)
  })
})
