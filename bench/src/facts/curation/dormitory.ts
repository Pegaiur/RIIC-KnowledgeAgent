import type { CurationBatch } from './types.js'

/** 宿舍人工优化批次：补充干员级组合协作导航。 */
export const DORMITORY_CURATIONS: CurationBatch = {
  room: '宿舍',
  skills: [],
  grants: [],
  operators: [
    // 来源：knowledge/guides/制造站组合.md「深海猎人组」
    {
      operatorId: '斯卡蒂',
      notes: '本卡属「深海猎人组」：核心还需歌蕾蒂娅精二进驻控制中枢；乌尔比安、幽灵鲨、安哲拉为重要成员，按持有情况进入制造侧设施。',
    },
  ],
}
