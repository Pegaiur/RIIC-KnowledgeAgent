/**
 * 记录卡标杆条目（fixture）：首批 5 个干员，作为转录/核对的基准值。
 *
 * 条目本体为 RecordCard，不携带 source 字段（plan 非目标「不做来源标注」）；
 * 程序化 0 差异核对时，由调用方按 canonical 从真源名册（knowledge/references/名册.md）
 * 解析出该行（见 mechanical.findNameRow），再行比对，避免条目自带出处造成自证。
 * 语义字段（aliases/skillGroups/skills/notes）为人工从 references 转录的基准值，供后续 LLM 转录 + 人工抽检对照。
 *
 * TODO(tech-debt) R5-1：技能字段（skills[].name/unlockType）暂为 fixture 基准值，未程序化解析；
 * 补 parseSkillRow（技能分片 → name/unlockType）并纳入机械核对后，此债务清偿、fixture 仅留语义基准。
 */
import type { RecordCard } from './card.js'

/** 首批 5 个干员标杆（覆盖单/多设施、有/无组、歧义组等形态） */
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
]
