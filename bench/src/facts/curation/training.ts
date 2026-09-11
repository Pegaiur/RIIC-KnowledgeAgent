import type { CurationBatch } from './types.js'

/** 训练室人工优化批次：补充干员级组合协作导航。 */
export const TRAINING_CURATIONS: CurationBatch = {
  room: '训练室',
  skills: [],
  grants: [],
  operators: [
    // 来源：knowledge/guides/贸易站组合.md「深巡＋乌尔比安」
    {
      operatorId: '乌尔比安',
      notes: '本卡在基建内时为「深巡＋乌尔比安」关系中的挂件，触发深巡（精二、贸易站）的额外贸易收益；本卡不作为贸易站散件理解。',
    },
  ],
}
