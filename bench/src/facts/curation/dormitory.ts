import type { CurationBatch } from './types.js'

/** 宿舍人工优化批次：补充干员级组合协作导航。 */
export const DORMITORY_CURATIONS: CurationBatch = {
  room: '宿舍',
  skills: [],
  grants: [],
  operators: [
    // 来源：knowledge/guides/组合/制造站组合.md「深海猎人组：中枢协作、制造席位与心情代价」
    {
      operatorId: '斯卡蒂',
      notes: '本卡属「深海猎人组」：精零可在制造站承担计数，由中枢歌蕾蒂娅提供加成；歌蕾蒂娅推荐精二，其余猎人按持有情况分站。',
    },
    // 来源：knowledge/guides/组合/贸易站组合.md「格拉斯哥帮组：同站成员计数与中枢协作」
    {
      operatorId: '推进之王',
      notes: '本卡属「格拉斯哥帮组」（本卡精零即可），与摩根进驻同一座贸易站；完整分工见同名组合词条。',
    },
  ],
}
