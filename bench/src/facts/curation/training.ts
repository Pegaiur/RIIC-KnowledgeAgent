import type { CurationBatch } from './types.js'

/** 训练室人工优化批次：补充干员级组合协作导航。 */
export const TRAINING_CURATIONS: CurationBatch = {
  room: '训练室',
  skills: [],
  grants: [],
  operators: [
    // 来源：knowledge/guides/贸易站组合.md「深巡＋乌尔比安：贸易站与基建挂件分工」；knowledge/guides/制造站组合.md「深海猎人组：中枢协作、制造席位与心情代价」
    {
      operatorId: '乌尔比安',
      notes: '本卡同时属「深巡＋乌尔比安」与「深海猎人组」：在基建内时为深巡（精二、贸易站）的挂件，触发额外贸易收益，不作为贸易站散件；同时是深海猎人组的重要成员（精零即可，该组以歌蕾蒂娅精二为核心、进驻控制中枢）。',
    },
  ],
}
