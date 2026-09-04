import { describe, expect, it } from 'vitest'
import { loadValidatedRecordCards } from '../src/facts/final.js'
import { getCardStore } from '../src/facts/store.js'

const ROOT = process.cwd()

describe('final gate：全量事实与运行时记录卡', () => {
  it('通过全量计数、替换关系、类别等价组和 fixture 兼容回归', () => {
    const cards = loadValidatedRecordCards(ROOT, 'raw')

    expect(cards).toHaveLength(425)
    expect(cards.flatMap((card) => card.skills)).toHaveLength(913)
    expect(cards.find((card) => card.canonical === '丰川祥子')?.skills.filter((skill) => skill.name.includes('丰富工作经验'))).toHaveLength(2)
  })

  it('运行时 store 只暴露最终门禁通过的 425 张卡', () => {
    expect(getCardStore().cards).toHaveLength(425)
  })
})
