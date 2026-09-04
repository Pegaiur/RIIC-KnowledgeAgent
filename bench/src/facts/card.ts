/**
 * 记录卡（facts-first）：LLM 转录 + 程序化核对生成的干员事实卡片。
 *
 * 字段口径（plan 步骤 1）：
 * - 机械字段（canonical / rarity / class / rooms / factionGroups）：与 references 一致（rarity 规范化为 1~6，去 ☆；其余逐字），程序化核对断言覆盖。
 * - 语义字段（aliases / skillGroups / skills / notes）：LLM 转录 + 人工抽检，不参与机器比对。
 * 字段-来源对照表见 docs/plan-hybrid-facts-notes.md「决策偏离」。
 */

/** 单个基建技能（按 references 技能分片转录，效果原文不数值化） */
export interface RecordSkill {
  /** 规范化事实中的 grant 稳定 ID；兼容旧 fixture 时可缺省 */
  grantId?: string
  /** 技能所属设施；兼容旧 fixture 时可缺省 */
  room?: string
  /** 技能名（去除「」后的名称） */
  name: string
  /** 解锁方式：初始解锁 / 精英 N 解锁 / 精英 N 提升 */
  unlockType: string
  /** 标签/作用产物定位（保留 references 原文，不结构化拆分；无则空串） */
  target: string
  /** 效果原文（references 原句，不做 minEff 数值化） */
  effectText: string
  /** 技能级人工备注；raw 模式缺省 */
  notes?: string
  /** 被替换的具体 grant；仅升级技能存在 */
  replacesGrantId?: string
  /** `类别.md` 中命中的技能类别 */
  skillCategories?: string[]
  /** `技能等价组.md` 中命中的等价组 */
  equivalenceGroupId?: string
  /** 等价组内可用于 lookup 展开的技能名 */
  equivalenceSkillNames?: string[]
}

/** 干员记录卡 */
export interface RecordCard {
  /** 标准名（references 名册 canonical） */
  canonical: string
  /** 别名/俗称归一（歧义.md + 俗称；机械核对不覆盖） */
  aliases: string[]
  /** 星级：1~6 数字字符串（无 ☆ 等符号；不参与机器比较——plan 非目标 minEff） */
  rarity: string
  /** 职业 */
  class: string
  /** 有基建技能的设施 */
  rooms: string[]
  /** 所属阵营组（名册第 5 列，官方术语表干员组） */
  factionGroups: string[]
  /** 技能等价组（类别.md「技能组」） */
  skillGroups: string[]
  /** 技能列表（按 references 技能分片转录） */
  skills: RecordSkill[]
  /** 代偿备注 / 歧义提示（人工/LLM 语义字段） */
  notes: string
}

/** 参与程序化核对（0 差异断言）的机械字段 */
export const MECHANICAL_FIELDS = ['canonical', 'rarity', 'class', 'rooms', 'factionGroups'] as const
