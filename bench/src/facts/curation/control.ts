import type { CurationBatch } from './types.js'

/** 控制中枢人工优化批次：补充干员级组合协作导航。 */
export const CONTROL_CURATIONS: CurationBatch = {
  room: '控制中枢',
  skills: [],
  grants: [],
  operators: [
    // 来源：knowledge/guides/贸易站组合.md「人间烟火组」；knowledge/guides/跨设施组合.md「感知信息组」
    {
      operatorId: '令',
      notes: '本卡同时属「人间烟火组」与「感知信息组」：人间烟火组以本卡、乌有、重岳均精二为核心，乌有在贸易站侧协作，重岳形成资源链；桑葚、琴柳精二为重要增强成员，不是启动必需。感知信息组中本卡精二为次级成员，通过控制中枢技能参与。两组合重叠时按当前主要用途安排，不重复培养。',
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
    // 来源：knowledge/guides/贸易站组合.md「叙拉古」
    {
      operatorId: '八幡海铃',
      notes: '本卡属「叙拉古」（本卡精二），进驻控制中枢；完整组合与重要成员贝洛内见同名组合词条。',
    },
    // 来源：knowledge/guides/贸易站组合.md「喀兰贸易组」
    {
      operatorId: '灵知',
      notes: '本卡属「喀兰贸易组」（本卡精二），负责跨设施喀兰协作；贸易侧核心银灰、孑见同名组合词条。',
    },
    // 来源：knowledge/guides/贸易站组合.md「格拉斯哥帮组」
    {
      operatorId: '戴菲恩',
      notes: '本卡属「格拉斯哥帮组」（本卡精二），进驻控制中枢；摩根、推进之王的同站关系见同名组合词条。',
    },
    // 来源：knowledge/guides/贸易站组合.md「人间烟火组」
    {
      operatorId: '重岳',
      notes: '本卡属「人间烟火组」（本卡精二），负责形成资源链；另两名核心乌有、令见同名组合词条。',
    },
    // 来源：knowledge/guides/制造站组合.md「红松骑士团组」
    {
      operatorId: '薇薇安娜',
      notes: '本卡属「红松骑士团组」（本卡精二），留在控制中枢侧、不进入制造站；经验制造侧安排见同名组合词条。',
    },
    // 来源：knowledge/guides/制造站组合.md「深海猎人组」
    {
      operatorId: '歌蕾蒂娅',
      notes: '本卡属「深海猎人组」（本卡精二），进驻控制中枢；重要成员与制造侧分工见同名组合词条。',
    },
    // 来源：knowledge/guides/跨设施组合.md「龙门中枢组」
    {
      operatorId: '斩业星熊',
      notes: '本卡属「龙门中枢组」（本卡精二）；本组只描述控制中枢关系，完整条件见同名组合词条。',
    },
    // 来源：knowledge/guides/贸易站组合.md「人间烟火组」；knowledge/guides/跨设施组合.md「感知信息组」
    {
      operatorId: '琴柳',
      notes: '本卡同时是「人间烟火组」与「感知信息组」的精二重要成员：人间烟火组中为重要增强；感知信息组中可安排控制中枢或宿舍参与。两组合重叠时按当前主要用途安排，不重复培养。',
    },
    // 来源：knowledge/guides/贸易站组合.md「人间烟火组」；knowledge/guides/跨设施组合.md「感知信息组」
    {
      operatorId: '夕',
      notes: '本卡同时属「人间烟火组」与「感知信息组」：人间烟火组中本卡精零为次级成员；感知信息组中本卡精零为重要成员，进驻控制中枢。两组合重叠时按当前主要用途安排。',
    },
  ],
}
