import type { CurationBatch } from './types.js'

/** 宿舍人工优化批次：补充干员级组合协作导航。 */
export const DORMITORY_CURATIONS: CurationBatch = {
  room: '宿舍',
  skills: [],
  grants: [],
  operators: [
    // 来源：knowledge/guides/制造站组合.md「深海猎人组：中枢协作、制造席位与心情代价」
    {
      operatorId: '斯卡蒂',
      notes: '本卡属「深海猎人组」：核心还需歌蕾蒂娅精二进驻控制中枢；乌尔比安、幽灵鲨、安哲拉为重要成员，按持有情况进入制造侧设施。',
    },
    // 来源：knowledge/guides/贸易站组合.md「格拉斯哥帮组：同站成员计数与中枢协作」
    {
      operatorId: '推进之王',
      notes: '本卡属「格拉斯哥帮组」（本卡精零即可），与摩根进驻同一座贸易站；完整分工见同名组合词条。',
    },
  ],
}
