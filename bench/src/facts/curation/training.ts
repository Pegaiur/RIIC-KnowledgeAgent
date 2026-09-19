import type { CurationBatch } from './types.js'

/** 训练室人工优化批次：补充干员级组合协作导航。 */
export const TRAINING_CURATIONS: CurationBatch = {
  room: '训练室',
  skills: [],
  grants: [],
  operators: [
    // 来源：knowledge/guides/组合/贸易站组合.md「深巡＋乌尔比安：贸易站与基建挂件分工」；knowledge/guides/组合/制造站组合.md「深海猎人组：中枢协作、制造席位与心情代价」
    {
      operatorId: '乌尔比安',
      notes: '本卡同时属「深巡＋乌尔比安」与「深海猎人组」：精零实际进驻基建可支持贸易站深巡精二；进驻制造站时也承担深海猎人计数，由中枢歌蕾蒂娅提供加成，推荐她精二。',
    },
  ],
}
