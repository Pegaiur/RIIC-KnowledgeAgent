/**
 * 记录卡标杆条目（fixture）：首批 5 个干员，作为转录/核对的基准值。
 *
 * 条目本体为 RecordCard，不携带 source 字段（plan 非目标「不做来源标注」）；
 * 程序化 0 差异核对时，由调用方按 canonical 从真源名册（knowledge/raw/名册.md）
 * 解析出该行（见 mechanical.findNameRow），再行比对，避免条目自带出处造成自证。
 * 语义字段（aliases/skillGroups/skills/notes）为人工从机械真源转录的兼容基准值，供回归对照；
 * 运行时全量卡的技能名、解锁文本和机械字段由 parseSkillFragment 等解析器确定性生成，fixture 不作为运行时事实源。
 */
import type { RecordCard } from './card.js'

/** 标杆条目：干员记录卡（覆盖 F/G 事实类 + S02/S04/S06 体系题相关干员，共 16 名，含单/多设施、有/无组、歧义组等形态） */
export const FACTS_FIXTURES: RecordCard[] = [
  {
    // 单设施、无组
    canonical: '刻俄柏',
    aliases: [],
    rarity: '6',
    class: '术师',
    rooms: ['制造站'],
    factionGroups: [],
    skillGroups: [],
    skills: [
      {
        name: '“都想要”',
        unlockType: '初始解锁',
        target: '仓库容量',
        effectText: '进驻制造站时，仓库容量上限+8，心情每小时消耗-0.25',
      },
      {
        name: '“等不及”',
        unlockType: '精英 2 解锁',
        target: '通用生产；作用产物：赤金/作战记录/源石碎片',
        effectText: '进驻制造站后，生产力首小时+20%，此后每小时+1%，最终达到+25%',
      },
    ],
    notes: '',
  },
  {
    // 单设施、有组（莱茵生命），含技能组（莱茵科技类技能）
    canonical: '多萝西',
    aliases: [],
    rarity: '6',
    class: '特种',
    rooms: ['制造站'],
    factionGroups: ['莱茵生命'],
    skillGroups: ['莱茵科技类技能'],
    skills: [
      {
        name: '源石技艺理论应用',
        unlockType: '初始解锁',
        target: '作用产物：赤金/作战记录/源石碎片；引用术语：莱茵科技类技能',
        effectText: '进驻制造站时，当前制造站内每个莱茵科技类技能为自身+5%的生产力',
      },
      {
        name: '莱茵科技·β',
        unlockType: '精英 2 解锁',
        target: '通用生产；作用产物：赤金/作战记录/源石碎片',
        effectText: '进驻制造站时，生产力+25%',
      },
    ],
    notes: '',
  },
  {
    // 多设施、有组（萨尔贡），含「提升替换」语义
    canonical: '森蚺',
    aliases: [],
    rarity: '6',
    class: '重装',
    rooms: ['制造站', '控制中枢'],
    factionGroups: ['萨尔贡'],
    skillGroups: [],
    skills: [
      {
        name: '自动化·α',
        unlockType: '初始解锁',
        target: '通用生产；作用产物：赤金/作战记录/源石碎片',
        effectText: '进驻制造站时，当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力），每个发电站为当前制造站+5%的生产力',
      },
      {
        name: '自动化·β',
        unlockType: '精英 2 提升，替换「自动化·α」',
        target: '通用生产；作用产物：赤金/作战记录/源石碎片',
        effectText: '进驻制造站时，当前制造站内其他干员提供的生产力全部归零（不包含根据设施数量提供加成的生产力），每个发电站为当前制造站+10%的生产力',
      },
      {
        name: '我寻思能行',
        unlockType: '精英 2 解锁',
        target: '',
        effectText: '进驻控制中枢时，如果Lancet-2进驻在发电站，发电站额外+2（仅影响设施数量）',
      },
    ],
    notes: '',
  },
  {
    // 歧义组（所属组「能天使」），需设施消歧
    canonical: '能天使',
    aliases: [],
    rarity: '6',
    class: '狙击',
    rooms: ['贸易站'],
    factionGroups: ['能天使'],
    skillGroups: [],
    skills: [
      {
        name: '企鹅物流·α',
        unlockType: '初始解锁',
        target: '订单效率',
        effectText: '进驻贸易站时，订单获取效率+20%',
      },
      {
        name: '物流专家',
        unlockType: '精英 2 提升，替换「企鹅物流·α」',
        target: '订单效率',
        effectText: '进驻贸易站时，订单获取效率+35%',
      },
    ],
    notes: '与「新约能天使」同名（所属组能天使）；用户点明贸易站时按设施判断，否则应反问。',
  },
  {
    // 多设施、无组（会客室 + 办公室），技能跨两个分片
    canonical: '伊内丝',
    aliases: [],
    rarity: '6',
    class: '先锋',
    rooms: ['会客室', '办公室'],
    factionGroups: [],
    skillGroups: [],
    skills: [
      {
        name: '聚影',
        unlockType: '精英 2 解锁',
        target: '无特别加成',
        effectText: '进驻会客室时，线索搜集速度提升20%，此后每小时提升2%，最终达到30%',
      },
      {
        name: '人事管理·β',
        unlockType: '初始解锁',
        target: '联络速度',
        effectText: '进驻人力办公室时，人脉资源的联络速度+35%',
      },
    ],
    notes: '',
  },
  // ===== S02 怪猎中枢体系（怪物猎人小队）=====
  {
    // 怪物猎人小队 · 控制中枢
    canonical: '火龙S黑角',
    aliases: [],
    rarity: '5',
    class: '近卫',
    rooms: ['控制中枢'],
    factionGroups: ['怪物猎人小队'],
    skillGroups: [],
    skills: [
      {
        name: '团队合作',
        unlockType: '初始解锁',
        target: '引用术语：怪物猎人小队/木天蓼',
        effectText: '进驻控制中枢时，控制中枢内每有1名怪物猎人小队干员，则木天蓼+2',
      },
      {
        name: '秘传交涉术',
        unlockType: '精英 2 解锁',
        target: '订单效率；引用术语：怪物猎人小队',
        effectText: '当与怪物猎人小队干员进驻控制中枢一起工作时，所有贸易站订单效率+7%（同种效果取最高）',
      },
    ],
    notes: '与「黑角」（贸易站、制造站）为子串歧义（不同干员，设施不重叠）；S02 怪猎中枢体系核心。',
  },
  {
    canonical: '麒麟R夜刀',
    aliases: [],
    rarity: '6',
    class: '特种',
    rooms: ['控制中枢'],
    factionGroups: ['怪物猎人小队'],
    skillGroups: [],
    skills: [
      {
        name: '耐力回复',
        unlockType: '初始解锁',
        target: '引用术语：木天蓼',
        effectText: '进驻控制中枢时，自身心情每小时消耗+0.5，木天蓼+8',
      },
      {
        name: '以身作则',
        unlockType: '精英 2 解锁',
        target: '生产力；引用术语：怪物猎人小队',
        effectText: '当与怪物猎人小队干员进驻控制中枢一起工作时，所有制造站生产力+2%（同种效果取最高）',
      },
    ],
    notes: '与「夜刀」（贸易站、制造站）为子串歧义（不同干员，设施不重叠）；S02 怪猎中枢体系核心。',
  },
  {
    canonical: '泰拉大陆调查团',
    aliases: [],
    rarity: '1',
    class: '狙击',
    rooms: ['贸易站', '制造站'],
    factionGroups: ['怪物猎人小队'],
    skillGroups: [],
    skills: [
      {
        name: '可爱的艾露猫',
        unlockType: '初始解锁',
        target: '订单效率/订单上限；引用术语：木天蓼',
        effectText: '进驻贸易站时，订单获取效率+5%，且订单上限+2，同时每有1个木天蓼，则订单获取效率+3%',
      },
      {
        name: '可靠的随从们',
        unlockType: '等级 30 解锁',
        target: '通用生产/仓库容量；作用产物：赤金/作战记录/源石碎片；引用术语：木天蓼',
        effectText: '进驻制造站时，仓库容量上限+8，生产力+5%，同时每有1个木天蓼，则生产力+1%',
      },
    ],
    notes: 'S02 怪猎中枢体系的木天蓼兑现载体（提供艾露猫/随从们技能，消费木天蓼）。',
  },
  // ===== S04 龙舌兰组体系 =====
  {
    canonical: '巫恋',
    aliases: [],
    rarity: '5',
    class: '辅助',
    rooms: ['贸易站'],
    factionGroups: ['叙拉古'],
    skillGroups: [],
    skills: [
      {
        name: '裁缝·α',
        unlockType: '初始解锁',
        target: '高品质',
        effectText: '进驻贸易站时，小幅提升当前贸易站高品质贵金属订单的出现概率（工作时长影响概率），心情每小时消耗-0.25',
      },
      {
        name: '低语',
        unlockType: '精英 2 解锁',
        target: '订单效率',
        effectText: '进驻贸易站时，当前贸易站内其他干员提供的订单获取效率全部归零，且每人为自身+45%订单获取效率，同时全体心情每小时消耗+0.25',
      },
    ],
    notes: '裁缝等价组成员（千金的眼光＝懂行＝手工艺品·α＝裁缝·α＝鉴定师的眼光）；「低语」为裁缝核：归零其他干员订单效率并自叠加（+45%/人）。',
  },
  // ===== S06 感知信息组体系 =====
  {
    canonical: '迷迭香',
    aliases: [],
    rarity: '6',
    class: '狙击',
    rooms: ['制造站'],
    factionGroups: ['精英干员'],
    skillGroups: [],
    skills: [
      {
        name: '超感',
        unlockType: '初始解锁',
        target: '引用术语：感知信息/思维链环',
        effectText: '进驻制造站时，宿舍内每有1名干员则感知信息+1，同时每1点感知信息转化为1点思维链环',
      },
      {
        name: '念力',
        unlockType: '初始解锁',
        target: '通用生产；作用产物：赤金/作战记录/源石碎片；引用术语：思维链环',
        effectText: '进驻制造站时，每2点思维链环+1%生产力',
      },
      {
        name: '意识实体',
        unlockType: '精英 2 提升，替换「念力」',
        target: '通用生产；作用产物：赤金/作战记录/源石碎片；引用术语：思维链环',
        effectText: '进驻制造站时，每1点思维链环+1%生产力',
      },
    ],
    notes: 'S06 感知链体系核心（感知信息→思维链环→生产力）；「意识实体」替换「念力」生效，非并存。',
  },
  {
    canonical: '黑键',
    aliases: [],
    rarity: '6',
    class: '术师',
    rooms: ['贸易站'],
    factionGroups: [],
    skillGroups: [],
    skills: [
      {
        name: '乐感',
        unlockType: '初始解锁',
        target: '引用术语：感知信息/无声共鸣',
        effectText: '进驻贸易站时，宿舍内每有1名干员则感知信息+1，同时每1点感知信息转化为1点无声共鸣',
      },
      {
        name: '徘徊旋律',
        unlockType: '初始解锁',
        target: '订单效率；引用术语：无声共鸣',
        effectText: '进驻贸易站时，每4点无声共鸣+1%订单效率',
      },
      {
        name: '怅惘和声',
        unlockType: '精英 2 提升，替换「徘徊旋律」',
        target: '订单效率；引用术语：无声共鸣',
        effectText: '进驻贸易站时，每2点无声共鸣+1%订单效率',
      },
    ],
    notes: 'S06 感知链体系的无声音乐链（乐感→无声共鸣→订单效率）；「怅惘和声」替换「徘徊旋律」。',
  },
  {
    canonical: '夕',
    aliases: [],
    rarity: '6',
    class: '术师',
    rooms: ['控制中枢'],
    factionGroups: ['岁'],
    skillGroups: [],
    skills: [
      {
        name: '不以物喜',
        unlockType: '初始解锁',
        target: '心情消耗；引用术语：人间烟火',
        effectText: '进驻控制中枢时，控制中枢内所有干员的心情每小时恢复+0.05；当自身心情处于12以下时，人间烟火+15',
      },
      {
        name: '不以己悲',
        unlockType: '初始解锁',
        target: '引用术语：感知信息',
        effectText: '进驻控制中枢时，自身心情每小时消耗+0.5；当自身心情大于12时，感知信息+10',
      },
    ],
    notes: 'S06 感知链供给者（心情>12 产感知信息）；岁体系成员。',
  },
  {
    canonical: '令',
    aliases: [],
    rarity: '6',
    class: '辅助',
    rooms: ['控制中枢'],
    factionGroups: ['岁'],
    skillGroups: [],
    skills: [
      {
        name: '杯莫停',
        unlockType: '初始解锁',
        target: '引用术语：岁',
        effectText: '进驻控制中枢时，消除当前控制中枢内所有岁干员自身心情消耗的影响',
      },
      {
        name: '山河远阔',
        unlockType: '精英 2 解锁',
        target: '引用术语：人间烟火/感知信息',
        effectText: '进驻控制中枢时，当自身心情大于12时，人间烟火+15；当自身心情处于12以下时，感知信息+10',
      },
    ],
    notes: 'S06 感知链供给者（心情≤12 产感知信息）；岁体系成员。',
  },
  {
    canonical: '絮雨',
    aliases: [],
    rarity: '5',
    class: '医疗',
    rooms: ['办公室'],
    factionGroups: [],
    skillGroups: [],
    skills: [
      {
        name: '巡游',
        unlockType: '初始解锁',
        target: '联络速度/特殊加成；引用术语：记忆碎片',
        effectText: '进驻人力办公室时，人脉资源的联络速度+20%，同时每个招募位（不包含初始招募位）+10点记忆碎片',
      },
      {
        name: '追忆',
        unlockType: '精英 2 解锁',
        target: '引用术语：记忆碎片/感知信息',
        effectText: '进驻人力办公室时，每1点记忆碎片转化为1点感知信息，心情耗尽时清空所有记忆碎片和自身累积的感知信息',
      },
    ],
    notes: 'S06 感知链供给者（记忆碎片→感知信息）。',
  },
  {
    canonical: '爱丽丝',
    aliases: [],
    rarity: '5',
    class: '术师',
    rooms: ['宿舍'],
    factionGroups: [],
    skillGroups: [],
    skills: [
      {
        name: '睡前故事',
        unlockType: '初始解锁',
        target: '群体恢复；引用术语：梦境',
        effectText: '进驻宿舍时，该宿舍内所有干员的心情每小时恢复+0.1（同种效果取最高），同时当前宿舍每级提供1层梦境',
      },
      {
        name: '梦境呓语',
        unlockType: '精英 2 解锁',
        target: '引用术语：梦境/感知信息',
        effectText: '进驻宿舍时，每1层梦境转化为1点感知信息',
      },
    ],
    notes: 'S06 感知链供给者（梦境→感知信息）。',
  },
  {
    canonical: '车尔尼',
    aliases: [],
    rarity: '5',
    class: '重装',
    rooms: ['宿舍'],
    factionGroups: [],
    skillGroups: [],
    skills: [
      {
        name: '慢板行歌',
        unlockType: '初始解锁',
        target: '单体恢复；引用术语：小节',
        effectText: '进驻宿舍时，使该宿舍内除自身以外心情未满的某个干员每小时恢复+0.65（同种效果取最高），同时当前宿舍每级提供1个小节',
      },
      {
        name: '琴键漫步',
        unlockType: '精英 2 解锁',
        target: '引用术语：小节/感知信息',
        effectText: '进驻宿舍时，每1个小节转化为1点感知信息',
      },
    ],
    notes: 'S06 感知链供给者（小节→感知信息）。',
  },
]
