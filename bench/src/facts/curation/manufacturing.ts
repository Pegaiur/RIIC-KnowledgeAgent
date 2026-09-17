import type { CurationBatch } from './types.js'

/** 制造站人工优化批次：补充干员级组合协作导航。 */
export const MANUFACTURING_CURATIONS: CurationBatch = {
  room: '制造站',
  skills: [],
  grants: [],
  operators: [
    // 来源：knowledge/guides/制造站组合.md「红云组」
    {
      operatorId: '红云',
      notes: '红云组以本卡精一为核心；同站重要搭配任选一条：酒神和 Miss.Christine（均精二），或稀音、帕拉斯、刻俄柏中任选两名精二。两条分支择一即可，可用 facts_search 搜索「红云组」核对成员技能与解锁条件。',
    },
    // 来源：knowledge/guides/制造站组合.md「泡泡组」
    {
      operatorId: '泡泡',
      notes: '本卡属「泡泡组」：完整组合还需火神精二同站进驻制造站；火神收益来自组合条件，不等同单人固定生产力。',
    },
    // 来源：knowledge/guides/制造站组合.md「自动化组」
    {
      operatorId: '温蒂',
      notes: '本卡属「自动化组」：统一核心还需清流精一；承曦格雷伊、森蚺、冬时等按当前布局补足发电站或中枢协作。',
    },
    // 来源：knowledge/guides/跨设施组合.md「感知信息组：资源用途与跨设施分工」
    {
      operatorId: '迷迭香',
      notes: '本卡属「感知信息组」：核心还需黑键精二进驻贸易站；絮雨、琴柳、夕等按设施分工参与，本组不绑定单一产物。',
    },
    // 来源：knowledge/guides/制造站组合.md「莱茵科技」
    {
      operatorId: '多萝西',
      notes: '本卡属「莱茵科技」：重要增强成员为淬羽赫默、娜斯提（均精二）；其他持莱茵科技类技能的成员按解锁档加入；莱茵生命阵营成员不等同于本组成员。',
    },
    // 来源：knowledge/guides/制造站组合.md「水月标准化组」；knowledge/raw/技能-制造站.md「水月 ☆6 · 特种」
    {
      operatorId: '水月',
      notes: '水月标准化组以水月精二为核心；同一制造站另配两名已解锁标准化类技能的干员，与水月共三人。可用 facts_search 搜索「标准化类技能」选择适配成员，按各自技能解锁条件核对。',
    },
    // 来源：knowledge/guides/制造站组合.md「自动化组」
    {
      operatorId: '清流',
      notes: '本卡属「自动化组」（本卡精一），与温蒂共同构成统一核心；完整分工见同名组合词条。',
    },
    // 来源：knowledge/guides/制造站组合.md「泡泡组」
    {
      operatorId: '火神',
      notes: '本卡属「泡泡组」（本卡精二）；组合条件收益，不等同单人固定生产力，完整条件见同名组合词条。',
    },
    // 来源：knowledge/guides/制造站组合.md「赤金工艺组」「红松骑士团组」
    {
      operatorId: '砾',
      notes: '本卡同时出现在「赤金工艺组」与「红松骑士团组」，两处均为可选成员（赤金工艺组持金属工艺类技能、常用目标精一；红松骑士团组为非硬核成员），不决定任一组合能否启动。',
    },
  ],
}
