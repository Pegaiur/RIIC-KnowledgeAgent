import type { ComboEntry, EvidenceRef, MemberRole, OperatorRef, SubstringEntry, TermCurations } from '../terms.js'

function source(path: string, section: string): EvidenceRef {
  return { path, section }
}

function member(canonical: string, role: MemberRole): { target: OperatorRef; role: MemberRole } {
  return { target: `operator:${canonical}`, role }
}

function substring(shortName: string, longName: string, evidence: EvidenceRef): SubstringEntry {
  return { text: shortName, targets: [`operator:${longName}`], evidence: [evidence] }
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

const trade = 'knowledge/guides/组合/贸易站组合.md'
const manufacturing = 'knowledge/guides/组合/制造站组合.md'
const crossFacility = 'knowledge/guides/组合/跨设施组合.md'
const ambiguity = 'knowledge/guides/歧义.md'
const substringSection = '一、子串包含对（31 组，自动生成）'

/** 人工确认的入口词条；不从散文运行时解析，也不回写 RecordCard.aliases。 */
export const TERM_CURATIONS: TermCurations = {
  aliases: [
    { text: '维娜', targets: ['operator:维娜·维多利亚'], evidence: [source(ambiguity, '二、简称与合称（人工维护）')] },
    { text: '德狗', targets: ['operator:德克萨斯'], evidence: [source(ambiguity, '二、简称与合称（人工维护）')] },
    { text: '拉狗', targets: ['operator:拉普兰德'], evidence: [source(ambiguity, '二、简称与合称（人工维护）')] },
    { text: '推王', targets: ['operator:推进之王', 'operator:维娜·维多利亚'], evidence: [source(ambiguity, '二、简称与合称（人工维护）')] },
  ],
  substrings: [
    substring('临光', '耀骑士临光', source(ambiguity, substringSection)),
    substring('克洛丝', '寒芒克洛丝', source(ambiguity, substringSection)),
    substring('凛冬', '怒潮凛冬', source(ambiguity, substringSection)),
    substring('凯尔希', '凯尔希·思衡托', source(ambiguity, substringSection)),
    substring('初雪', '圣聆初雪', source(ambiguity, substringSection)),
    substring('嘉维尔', '百炼嘉维尔', source(ambiguity, substringSection)),
    substring('夜刀', '麒麟R夜刀', source(ambiguity, substringSection)),
    substring('安洁莉娜', '予愿安洁莉娜', source(ambiguity, substringSection)),
    substring('幽灵鲨', '归溟幽灵鲨', source(ambiguity, substringSection)),
    substring('德克萨斯', '缄默德克萨斯', source(ambiguity, substringSection)),
    substring('惊蛰', '司霆惊蛰', source(ambiguity, substringSection)),
    substring('拉普兰德', '荒芜拉普兰德', source(ambiguity, substringSection)),
    substring('斯卡蒂', '浊心斯卡蒂', source(ambiguity, substringSection)),
    substring('星源', '溯光星源', source(ambiguity, substringSection)),
    substring('星熊', '斩业星熊', source(ambiguity, substringSection)),
    substring('杰西卡', '涤火杰西卡', source(ambiguity, substringSection)),
    substring('格雷伊', '承曦格雷伊', source(ambiguity, substringSection)),
    substring('梓兰', '焰狐龙梓兰', source(ambiguity, substringSection)),
    substring('棘刺', '引星棘刺', source(ambiguity, substringSection)),
    substring('炎熔', '炎狱炎熔', source(ambiguity, substringSection)),
    substring('空爆', '雷狼龙S空爆', source(ambiguity, substringSection)),
    substring('能天使', '新约能天使', source(ambiguity, substringSection)),
    substring('艾雅法拉', '纯烬艾雅法拉', source(ambiguity, substringSection)),
    substring('芙蓉', '濯尘芙蓉', source(ambiguity, substringSection)),
    substring('苇草', '焰影苇草', source(ambiguity, substringSection)),
    substring('诗怀雅', '琳琅诗怀雅', source(ambiguity, substringSection)),
    substring('调香师', '撷英调香师', source(ambiguity, substringSection)),
    substring('赫默', '淬羽赫默', source(ambiguity, substringSection)),
    substring('送葬人', '圣约送葬人', source(ambiguity, substringSection)),
    substring('银灰', '凛御银灰', source(ambiguity, substringSection)),
    substring('黑角', '火龙S黑角', source(ambiguity, substringSection)),
  ],
  combos: [
    combo('龙舌兰组', [
      member('巫恋', 'core'), member('龙舌兰', 'core'),
      member('柏喙', 'optional'), member('折光', 'optional'), member('明椒', 'optional'), member('卡夫卡', 'optional'),
    ], [
      '巫恋达到精二；龙舌兰精零可以过渡，推荐精二提高报酬',
      '完整配置第三席选精二裁缝 β 等价技能成员，当前柏喙、折光、明椒或卡夫卡任选；缺少时按普通填位、但书或跨站挂件的剩余作用安排',
      '三名成员共同进驻同一座三级贸易站；裁缝选择属于开放成员范围',
    ], 'open', source(trade, '龙舌兰组：效率归零、裁缝概率与订单报酬'), '除来源列明成员外，其他精二且具备裁缝 β 等价技能的成员按实际技能解锁档选择'),
    combo('能天使组', [
      member('能天使', 'core'), member('蕾缪安', 'core'),
    ], [
      '能天使与蕾缪安均达到精二并进驻同一座贸易站',
      '新约能天使和空弦不属于本组',
    ], 'listed', source(trade, '能天使组：双核心同站与成员边界')),
    combo('叙拉古', [
      member('伺夜', 'core'), member('八幡海铃', 'core'), member('贝洛内', 'important'),
    ], [
      '推荐伺夜、八幡海铃精二，贝洛内精二同站；缺海铃时伺夜与贝洛内仍保留自身加速',
      '八幡海铃进驻控制中枢，伺夜与贝洛内进驻同一座贸易站',
      '贝洛内的贸易效果需要基建内有伺夜配合；但书不是本组必要成员',
    ], 'listed', source(trade, '叙拉古：中枢与贸易站分工')),
    combo('喀兰贸易组', [
      member('灵知', 'core'), member('银灰', 'core'), member('孑', 'core'),
      member('崖心', 'optional'), member('琳琅诗怀雅', 'optional'),
    ], [
      '灵知与银灰达到精二，孑以精一作为贸易侧目标练度；崖心、琳琅诗怀雅精二为订单上限适配成员',
      '灵知负责跨设施喀兰协作，银灰与孑构成贸易侧核心；崖心、琳琅诗怀雅为订单上限适配成员',
      '订单上限是辅助收益，不能改写为固定订单获取效率',
    ], 'listed', source(trade, '喀兰贸易组：跨设施协作与订单上限适配')),
    combo('格拉斯哥帮组', [
      member('摩根', 'core'), member('戴菲恩', 'core'), member('推进之王', 'core'), member('维娜·维多利亚', 'secondary'),
    ], [
      '摩根精二与推进之王精零同站即可协作，戴菲恩精二为中枢增强',
      '摩根与推进之王进驻同一座贸易站，戴菲恩进驻控制中枢',
      '维娜·维多利亚精二可提供自身加速，但不增加格拉斯哥帮成员计数，也不替代推进之王的具名条件',
    ], 'listed', source(trade, '格拉斯哥帮组：同站成员计数与中枢协作')),
    combo('鸿雪杜林组', [
      member('鸿雪', 'core'), member('绮良', 'core'), member('图耶', 'core'),
      member('至简', 'support'), member('桃金娘', 'support'), member('褐果', 'support'), member('杜林', 'support'), member('特克诺', 'support'),
    ], [
      '完整配置推荐鸿雪、绮良、图耶均达到精二',
      '至简、桃金娘、褐果、杜林、特克诺五名挂件中放满四名，均精零即可；挂件不设独立培养目标',
      '缺成员或挂件不足时，按剩余真实与虚拟产线及当班读取者重算；虚拟产线不生产实物赤金',
    ], 'listed', source(trade, '鸿雪杜林组：贸易核心与杜林挂件')),
    combo('人间烟火组', [
      member('乌有', 'core'), member('重岳', 'core'), member('令', 'core'),
      member('桑葚', 'important'), member('琴柳', 'important'),
      member('夕', 'secondary'), member('截云', 'secondary'), member('黍', 'secondary'),
    ], [
      '乌有、重岳、令均达到精二；桑葚、琴柳均达到精二，为重要成员',
      '夕精零、截云精二、黍精二可作为次级成员',
      '这是跨多个设施的资源链，不能压缩成纯人间烟火贸易组',
    ], 'listed', source(trade, '人间烟火组：跨设施资源链与贸易用途')),
    combo('企鹅物流', [
      member('德克萨斯', 'core'), member('拉普兰德', 'core'), member('能天使', 'important'),
    ], [
      '德克萨斯与拉普兰德精零同站即可启动；拉普兰德精二提高订单上限，德克萨斯精二另有与能天使的心情配合',
      '能天使精二为重要成员；本组可作为能天使组尚未成形时的过渡方案',
      '能天使组已完整时，能天使优先放入能天使组，不为展示两个身份重复生成目标',
    ], 'listed', source(trade, '企鹅物流：同站协作与能天使的取舍')),
    combo('深巡＋乌尔比安', [
      member('深巡', 'core'), member('乌尔比安', 'support'),
    ], [
      '深巡达到精二并进驻贸易站',
      '乌尔比安作为基建内挂件，精零即可且不设独立培养目标',
      '乌尔比安在基建内时触发额外贸易收益，缺少时按深巡自身技能判断',
    ], 'listed', source(trade, '深巡＋乌尔比安：贸易站与基建挂件分工')),
    combo('自动化组', [
      member('温蒂', 'core'), member('清流', 'core'),
      member('承曦格雷伊', 'important'), member('森蚺', 'important'), member('冬时', 'important'),
      member('异客', 'secondary'), member('掠风', 'secondary'), member('Lancet-2', 'support'),
    ], [
      '赤金完整配置推荐温蒂精二、清流精一；温蒂精零已有自动化，通用制造分支可配森蚺、冬时而不带清流',
      '承曦格雷伊、森蚺精二，冬时精一为重要成员；异客、掠风均达到精二，为次级成员，Lancet-2 精零且不设独立培养目标',
      '其他成员按当前布局补足发电站或中枢协作，不固定要求二电或三电路线',
    ], 'listed', source(manufacturing, '自动化组：第三人、发电站协作与归零范围')),
    combo('赤金工艺组', [
      member('苍苔', 'core'), member('引星棘刺', 'optional'), member('砾', 'optional'), member('斑点', 'optional'), member('夜烟', 'optional'), member('温米', 'optional'),
    ], [
      '苍苔达到精二',
      '当前可从引星棘刺、砾、斑点、夜烟、温米中选择具备金属工艺类技能的同站成员；站内至少两名该类技能成员（包括苍苔）',
      '砾、斑点常用目标为精一，其余成员不预设统一练度；本组只描述贵金属类配方',
    ], 'open', source(manufacturing, '赤金工艺组：同站技能成员与贵金属配方'), '其他具有金属工艺类技能的成员按实际技能解锁档判断'),
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
    ], 'listed', source(manufacturing, '红云组：仓库容量转化与成员分支')),
    combo('红松骑士团组', [
      member('焰尾', 'core'), member('薇薇安娜', 'core'),
      member('灰毫', 'important'), member('远牙', 'important'), member('野鬃', 'important'), member('砾', 'optional'),
    ], [
      '焰尾与薇薇安娜达到精二',
      '灰毫、远牙、野鬃推荐精二并进入作战记录制造，按持有情况同站或分站；缺成员时比较实际受益人数',
      '砾为可选非硬核成员；焰尾与薇薇安娜留在控制中枢侧，远牙、灰毫、野鬃进入经验制造站',
    ], 'listed', source(manufacturing, '红松骑士团组：中枢与经验制造分工')),
    combo('深海猎人组', [
      member('歌蕾蒂娅', 'core'), member('乌尔比安', 'important'), member('斯卡蒂', 'important'), member('幽灵鲨', 'important'), member('安哲拉', 'important'),
    ], [
      '歌蕾蒂娅精零已有初始加成，推荐精二提升加成与单站上限',
      '乌尔比安、斯卡蒂、幽灵鲨、安哲拉均为重要成员，完整形态要求四人均持有且精零即可',
      '歌蕾蒂娅进驻控制中枢，深海猎人成员按持有情况进入制造侧设施；不把组合收益写成普通制造散件',
    ], 'listed', source(manufacturing, '深海猎人组：中枢协作、制造席位与心情代价')),
    combo('泡泡组', [
      member('泡泡', 'core'), member('火神', 'core'), member('贝娜', 'support'),
    ], [
      '泡泡达到精一、火神达到精二，二人同站进驻制造站',
      '贝娜精零等仓库容量或效率适配成员可按持有情况补充；挂件不决定组合能否完成',
      '只有两名核心同站时才按完整泡泡组理解，火神高收益来自组合条件而非单人固定生产力',
    ], 'open', source(manufacturing, '泡泡组：同站核心与仓库容量转化'), '其他仓库容量或效率适配成员按实际技能和持有情况补充'),
    combo('水月标准化组', [
      member('水月', 'core'), member('香草', 'optional'), member('杰西卡', 'optional'), member('史都华德', 'optional'), member('海沫', 'optional'), member('罗比菈塔', 'optional'), member('调香师', 'optional'),
      member('涤火杰西卡', 'important'),
    ], [
      '水月达到精二，制造侧再有任意两名具备标准化类技能的成员；香草、杰西卡是常见搭配',
      '史都华德、海沫、罗比菈塔和调香师等可按实际技能解锁档补充，成员范围开放',
      '涤火杰西卡精二进驻控制中枢，不与制造侧位置混写；同名但不同技能解锁档不视为同一效果',
    ], 'open', source(manufacturing, '水月标准化组：技能成员条件与中枢分工'), '其他具有标准化类技能的成员按实际技能解锁档加入'),
    combo('莱茵科技', [
      member('多萝西', 'core'), member('淬羽赫默', 'important'), member('娜斯提', 'important'),
    ], [
      '推荐多萝西与淬羽赫默精二；娜斯提精零已有莱茵科技，精二用于阵营计数的赤金增强',
      '其他具有莱茵科技类制造技能的成员按实际技能解锁档加入，不预设整套固定挂件名单',
      '莱茵生命阵营成员不等于莱茵科技技能成员；娜斯提的赤金效果还要按基建内莱茵生命成员数量判断',
    ], 'open', source(manufacturing, '莱茵科技：制造技能协作与阵营计数边界'), '其他具有莱茵科技类制造技能的成员按实际技能解锁档加入'),
    combo('感知信息组', [
      member('迷迭香', 'core'), member('黑键', 'core'), member('絮雨', 'important'), member('琴柳', 'important'), member('夕', 'important'),
      member('爱丽丝', 'secondary'), member('车尔尼', 'secondary'), member('塑心', 'secondary'), member('令', 'secondary'),
    ], [
      '完整配置推荐迷迭香与黑键精二，单终端也可运行，按实际资源重新计算收益',
      '絮雨、爱丽丝、车尔尼、令精二参与资源供给，夕精零按心情档供给；塑心精零即可提供无声共鸣；琴柳精二只作办公室补速选择',
      '设施分工：迷迭香进制造站，黑键进贸易站；絮雨进办公室，琴柳进控制中枢或宿舍，夕进控制中枢；爱丽丝、车尔尼、塑心主要通过宿舍侧技能参与，令通过控制中枢技能参与',
      '本组不绑定单一产物，根据当前主要使用的设施理解组合价值',
    ], 'listed', source(crossFacility, '感知信息组：资源用途与跨设施分工')),
    combo('龙门中枢组', [
      member('斩业星熊', 'core'), member('诗怀雅', 'important'), member('陈', 'secondary'),
    ], [
      '斩业星熊达到精二；诗怀雅精零为重要成员，陈精零为次级成员',
      '核心与适配成员共同安排在控制中枢；斩业星熊与龙门近卫局干员同驻时可为制造站提供额外生产力',
      '本组只描述控制中枢关系，不是制造站组合',
    ], 'listed', source(crossFacility, '龙门中枢组：中枢成员协作与制造站加成')),
  ],
}
