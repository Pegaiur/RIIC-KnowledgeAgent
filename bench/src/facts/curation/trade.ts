import type { CurationBatch } from './types.js'

/** 贸易站人工优化批次：只补充技能原文不易直接表达的干员级联动。 */
export const TRADE_CURATIONS: CurationBatch = {
  room: '贸易站',
  skills: [],
  grants: [],
  operators: [
    {
      operatorId: '巫恋',
      notes: '精英2解锁的「低语」与初始「裁缝·α」并存；低语会让同站其他干员提供的订单效率失效，再按人数提高巫恋自身的订单效率。',
    },
    {
      operatorId: '孑',
      notes: '「摊贩经济」与「市井之道」并存：两项按当前订单数互补，合计取决于订单上限；市井之道还会按同站其他干员的效率压低上限，因此精英1并不必然优于精英0。',
    },
  ],
}
