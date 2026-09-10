import type { ComboEntry, EvidenceRef, MemberRole, OperatorRef, TermCurations } from '../terms.js'

function source(path: string, section: string): EvidenceRef {
  return { path, section }
}

function member(canonical: string, role: MemberRole): { target: OperatorRef; role: MemberRole } {
  return { target: `operator:${canonical}`, role }
}

function combo(
  name: string,
  members: ComboEntry['members'],
  conditions: ComboEntry['conditions'],
  coverage: ComboEntry['coverage'],
  evidence: EvidenceRef,
  openScope?: string,
): ComboEntry {
  return {
    id: `combo:${name}`,
    name,
    members,
    conditions,
    coverage,
    ...(openScope === undefined ? {} : { openScope }),
    evidence: [evidence],
  }
}

const trade = 'knowledge/guides/贸易站组合.md'
const manufacturing = 'knowledge/guides/制造站组合.md'
const crossFacility = 'knowledge/guides/跨设施组合.md'
const ambiguity = 'knowledge/references/歧义.md'

/** 人工确认的入口词条；不从散文运行时解析，也不回写 RecordCard.aliases。 */
export const TERM_CURATIONS: TermCurations = {
  aliases: [
    { text: '维娜', targets: ['operator:维娜·维多利亚'], evidence: [source(ambiguity, '二、简称与合称（人工维护）')] },
    { text: '德狗', targets: ['operator:德克萨斯'], evidence: [source(ambiguity, '二、简称与合称（人工维护）')] },
    { text: '拉狗', targets: ['operator:拉普兰德'], evidence: [source(ambiguity, '二、简称与合称（人工维护）')] },
    { text: '推王', targets: ['operator:推进之王', 'operator:维娜·维多利亚'], evidence: [source(ambiguity, '二、简称与合称（人工维护）')] },
  ],
  combos: [
    combo('龙舌兰组', [
      member('巫恋', 'core'), member('龙舌兰', 'core'),
      member('柏喙', 'optional'), member('折光', 'optional'), member('明椒', 'optional'), member('卡夫卡', 'optional'),
    ], [
      '巫恋与龙舌兰均达到精二',
      '再安排至少一名精二且具备裁缝 β 等价技能的成员，当前来源列明柏喙、折光、明椒或卡夫卡任选',
      '三名成员共同进驻同一座三级贸易站；裁缝选择属于开放成员范围',
    ], 'open', source(trade, '龙舌兰组'), '除来源列明成员外，其他精二且具备裁缝 β 等价技能的成员按实际技能解锁档选择'),
    combo('能天使组', [
      member('能天使', 'core'), member('蕾缪安', 'core'),
    ], [
      '能天使与蕾缪安均达到精二并进驻同一座贸易站',
      '新约能天使和空弦不属于本组',
    ], 'listed', source(trade, '能天使组')),
    combo('叙拉古', [
      member('伺夜', 'core'), member('八幡海铃', 'core'), member('贝洛内', 'important'),
    ], [
      '伺夜与八幡海铃均达到精二；贝洛内精二为重要成员',
      '八幡海铃进驻控制中枢，伺夜与贝洛内进驻同一座贸易站',
      '贝洛内的贸易效果需要基建内有伺夜配合；但书不是本组必要成员',
    ], 'listed', source(trade, '叙拉古')),
    combo('喀兰贸易组', [
      member('灵知', 'core'), member('银灰', 'core'), member('孑', 'core'),
      member('崖心', 'optional'), member('琳琅诗怀雅', 'optional'),
    ], [
      '灵知与银灰达到精二，孑以精一作为贸易侧目标练度；崖心、琳琅诗怀雅精二为订单上限适配成员',
      '灵知负责跨设施喀兰协作，银灰与孑构成贸易侧核心；崖心、琳琅诗怀雅为订单上限适配成员',
      '订单上限是辅助收益，不能改写为固定订单获取效率',
    ], 'listed', source(trade, '喀兰贸易组')),
    combo('格拉斯哥帮组', [
      member('摩根', 'core'), member('戴菲恩', 'core'), member('推进之王', 'core'), member('维娜·维多利亚', 'secondary'),
    ], [
      '摩根、戴菲恩达到精二，推进之王精零即可作为核心',
      '摩根与推进之王进驻同一座贸易站，戴菲恩进驻控制中枢',
      '维娜·维多利亚精二可作为次级增强成员；效果按同站格拉斯哥帮成员数量判断',
    ], 'listed', source(trade, '格拉斯哥帮组')),
    combo('鸿雪杜林组', [
      member('鸿雪', 'core'), member('绮良', 'core'), member('图耶', 'core'),
      member('至简', 'support'), member('桃金娘', 'support'), member('褐果', 'support'), member('杜林', 'support'), member('特克诺', 'support'),
    ], [
      '鸿雪、绮良、图耶均达到精二',
      '至简、桃金娘、褐果、杜林、特克诺五名挂件中放满四名，均精零即可；挂件不设独立培养目标',
      '只有三名核心具备时才称为可启动的鸿雪杜林组，挂件集合按持有情况补足',
    ], 'listed', source(trade, '鸿雪杜林组')),
    combo('人间烟火组', [
      member('乌有', 'core'), member('重岳', 'core'), member('令', 'core'),
      member('桑葚', 'important'), member('琴柳', 'important'),
      member('夕', 'secondary'), member('截云', 'secondary'), member('黍', 'secondary'),
    ], [
      '乌有、重岳、令均达到精二；桑葚、琴柳为重要成员',
      '夕精零、截云精二、黍精二可作为次级成员',
      '这是跨多个设施的资源链，不能压缩成纯人间烟火贸易组',
    ], 'listed', source(trade, '人间烟火组')),
    combo('企鹅物流', [
      member('德克萨斯', 'core'), member('拉普兰德', 'core'), member('能天使', 'important'),
    ], [
      '德克萨斯与拉普兰德达到精二并同站进驻，构成本组成立基础',
      '能天使精二为重要成员；本组可作为能天使组尚未成形时的过渡方案',
      '能天使组已完整时，能天使优先放入能天使组，不为展示两个身份重复生成目标',
    ], 'listed', source(trade, '企鹅物流')),
    combo('深巡＋乌尔比安', [
      member('深巡', 'core'), member('乌尔比安', 'support'),
    ], [
      '深巡达到精二并进驻贸易站',
      '乌尔比安作为基建内挂件，精零即可且不设独立培养目标',
      '乌尔比安在基建内时触发额外贸易收益，缺少时按深巡自身技能判断',
    ], 'listed', source(trade, '深巡＋乌尔比安')),
    combo('自动化组', [
      member('温蒂', 'core'), member('清流', 'core'),
      member('承曦格雷伊', 'important'), member('森蚺', 'important'), member('冬时', 'important'),
      member('异客', 'secondary'), member('掠风', 'secondary'), member('Lancet-2', 'support'),
    ], [
      '温蒂达到精二，清流达到精一，二人为统一核心',
      '承曦格雷伊、森蚺精二，冬时精一为重要成员；异客、掠风为次级成员，Lancet-2 精零且不设独立培养目标',
      '其他成员按当前布局补足发电站或中枢协作，不固定要求二电或三电路线',
    ], 'listed', source(manufacturing, '自动化组')),
    combo('赤金工艺组', [
      member('苍苔', 'core'), member('引星棘刺', 'optional'), member('砾', 'optional'), member('斑点', 'optional'), member('夜烟', 'optional'), member('温米', 'optional'),
    ], [
      '苍苔达到精二',
      '当前可从引星棘刺、砾、斑点、夜烟、温米中选择具备金属工艺类技能的同站成员；站内至少两名该类技能成员（包括苍苔）',
      '砾、斑点常用目标为精一，其余成员不预设统一练度；本组只描述贵金属类配方',
    ], 'open', source(manufacturing, '赤金工艺组'), '其他具有金属工艺类技能的成员按实际技能解锁档判断'),
    combo('红云组', [
      member('红云', 'core'),
      member('酒神', 'important'), member('Miss.Christine', 'important'), member('稀音', 'important'), member('帕拉斯', 'important'), member('刻俄柏', 'important'),
      member('圣约送葬人', 'secondary'), member('娜仁图亚', 'secondary'), member('豆苗', 'secondary'), member('裁度', 'secondary'), member('洋灰', 'secondary'), member('钼铅', 'secondary'),
      member('黑角', 'support'), member('蛇屠箱', 'support'),
    ], [
      '红云达到精一',
      '重要成员任选一条分支完成：①酒神与 Miss.Christine 均达到精二；②稀音、帕拉斯、刻俄柏三人中任选两名达到精二',
      '圣约送葬人精二、娜仁图亚精二、豆苗精一、裁度精二、洋灰精二、钼铅精二为次级成员；黑角和蛇屠箱精零即可作为适配成员，不设独立培养目标',
      '两条重要分支只需完成其中一条，不把两条分支成员都当成必需成员',
    ], 'listed', source(manufacturing, '红云组')),
    combo('红松骑士团组', [
      member('焰尾', 'core'), member('薇薇安娜', 'core'),
      member('灰毫', 'important'), member('远牙', 'important'), member('野鬃', 'important'), member('砾', 'optional'),
    ], [
      '焰尾与薇薇安娜达到精二',
      '灰毫、远牙、野鬃以精二作为目标，实际运行时至少安排其中两名进入经验制造，三名都具备时可全部纳入',
      '砾为可选非硬核成员；焰尾与薇薇安娜留在控制中枢侧，远牙、灰毫、野鬃进入经验制造站',
    ], 'listed', source(manufacturing, '红松骑士团组')),
    combo('深海猎人组', [
      member('歌蕾蒂娅', 'core'), member('乌尔比安', 'important'), member('斯卡蒂', 'important'), member('幽灵鲨', 'important'), member('安哲拉', 'important'),
    ], [
      '歌蕾蒂娅达到精二',
      '乌尔比安、斯卡蒂、幽灵鲨、安哲拉均为重要成员，完整形态要求四人均持有且精零即可',
      '歌蕾蒂娅进驻控制中枢，深海猎人成员按持有情况进入制造侧设施；不把组合收益写成普通制造散件',
    ], 'listed', source(manufacturing, '深海猎人组')),
    combo('泡泡组', [
      member('泡泡', 'core'), member('火神', 'core'), member('贝娜', 'support'),
    ], [
      '泡泡达到精一、火神达到精二，二人同站进驻制造站',
      '贝娜精零等仓库容量或效率适配成员可按持有情况补充；挂件不决定组合能否完成',
      '只有两名核心同站时才按完整泡泡组理解，火神高收益来自组合条件而非单人固定生产力',
    ], 'open', source(manufacturing, '泡泡组'), '其他仓库容量或效率适配成员按实际技能和持有情况补充'),
    combo('水月标准化组', [
      member('水月', 'core'), member('香草', 'optional'), member('杰西卡', 'optional'), member('史都华德', 'optional'), member('海沫', 'optional'), member('罗比菈塔', 'optional'), member('调香师', 'optional'),
      member('涤火杰西卡', 'important'),
    ], [
      '水月达到精二，制造侧再有任意两名具备标准化类技能的成员；香草、杰西卡是常见搭配',
      '史都华德、海沫、罗比菈塔和调香师等可按实际技能解锁档补充，成员范围开放',
      '涤火杰西卡精二进驻控制中枢，不与制造侧位置混写；同名但不同技能解锁档不视为同一效果',
    ], 'open', source(manufacturing, '水月标准化组'), '其他具有标准化类技能的成员按实际技能解锁档加入'),
    combo('莱茵科技', [
      member('多萝西', 'core'), member('淬羽赫默', 'important'), member('娜斯提', 'important'),
    ], [
      '多萝西达到精二；淬羽赫默、娜斯提为精二重要成员',
      '其他具有莱茵科技类制造技能的成员按实际技能解锁档加入，不预设整套固定挂件名单',
      '莱茵生命阵营成员不等于莱茵科技技能成员；娜斯提的赤金效果还要按基建内莱茵生命成员数量判断',
    ], 'open', source(manufacturing, '莱茵科技'), '其他具有莱茵科技类制造技能的成员按实际技能解锁档加入'),
    combo('感知信息组', [
      member('迷迭香', 'core'), member('黑键', 'core'), member('絮雨', 'important'), member('琴柳', 'important'), member('夕', 'important'),
      member('爱丽丝', 'secondary'), member('车尔尼', 'secondary'), member('塑心', 'secondary'), member('令', 'secondary'),
    ], [
      '迷迭香与黑键达到精二',
      '絮雨、琴柳达到精二，夕精零为重要成员；爱丽丝、车尔尼、塑心、令达到精二为次级成员',
      '设施分工：迷迭香进制造站，黑键进贸易站；絮雨进办公室，琴柳进控制中枢或宿舍，夕进控制中枢；爱丽丝、车尔尼、塑心主要通过宿舍侧技能参与，令通过控制中枢技能参与',
      '本组不绑定单一产物，根据当前主要使用的设施理解组合价值',
    ], 'listed', source(crossFacility, '感知信息组')),
    combo('龙门中枢组', [
      member('斩业星熊', 'core'), member('诗怀雅', 'important'), member('陈', 'secondary'),
    ], [
      '斩业星熊达到精二；诗怀雅精零为重要成员，陈精零为次级成员',
      '核心与适配成员共同安排在控制中枢；斩业星熊与龙门近卫局干员同驻时可为制造站提供额外生产力',
      '本组只描述控制中枢关系，不是制造站组合；不沿用龙门中枢制造组名称',
    ], 'listed', source(crossFacility, '龙门中枢组')),
  ],
  legacyNames: [
    { text: '迷迭香感知链', action: 'redirect', target: 'combo:感知信息组', evidence: [source(crossFacility, '感知信息组')] },
    { text: '巫恋裁缝核', action: 'redirect', target: 'combo:龙舌兰组', evidence: [source(trade, '龙舌兰组')] },
    { text: '龙门中枢制造组', action: 'redirect', target: 'combo:龙门中枢组', evidence: [source(crossFacility, '龙门中枢组')] },
  ],
}
