import type { CurationBatch } from './types.js'

/** 控制中枢人工优化批次：补充干员级组合协作导航。 */
export const CONTROL_CURATIONS: CurationBatch = {
  room: '控制中枢',
  skills: [],
  grants: [],
  operators: [
    // 来源：knowledge/guides/贸易站组合.md「人间烟火组」
    {
      operatorId: '令',
      notes: '本卡属「人间烟火组」：完整组合还需乌有精二在贸易站侧协作、重岳精二形成资源链；桑葚、琴柳精二为重要增强成员，不是启动必需。',
    },
    // 来源：knowledge/guides/制造站组合.md「红松骑士团组」
    {
      operatorId: '焰尾',
      notes: '本卡属「红松骑士团组」：完整组合还需薇薇安娜精二同驻控制中枢；经验制造侧至少安排灰毫、远牙、野鬃中的两名精二。',
    },
    // 来源：knowledge/guides/跨设施组合.md「龙门中枢组」
    {
      operatorId: '陈',
      notes: '本卡属「龙门中枢组」：完整组合还需斩业星熊精二同驻控制中枢，才能为制造站提供额外生产力；本组只描述控制中枢关系。',
    },
  ],
}
