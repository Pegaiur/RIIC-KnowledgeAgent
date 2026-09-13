/**
 * 关键词目录的人工说明数据。
 *
 * 这是关键词目录唯一的人工维护位置：规范检索词、能查什么、工具入口、必要范围等无法从
 * 事实真源机械推导的部分都在这里；设施、来源标签、类别名称、已登记组合的枚举由生成器
 * （bench/src/catalog.ts）从真源取得，两处职责不重叠，不设第二份手写词表。
 *
 * 来源：docs/plan-index-and-tags.md 第 2 步及其关键词盘点（0.1~0.6）。
 */

/** 单个条目的说明文本：能查什么 + 工具入口 + 必要范围；检索词缺省时取真源名称。 */
export interface CatalogText {
  /** 规范检索词；缺省时由生成器取真源名称（如设施名、类别名）。 */
  term?: string
  /** 能查什么。 */
  provides: string
  /** 工具入口，含 F（facts_search）/R（rag_search）标记与当前可用路径。 */
  entry: string
  /** 必要范围与限定。 */
  scope: string
}

/** 来源标签说明；同一来源标签在不同设施下规范词不同时用 roomOverrides 覆盖。 */
export interface TagCatalogText extends CatalogText {
  roomOverrides?: Readonly<Record<string, Partial<CatalogText>>>
}

/** 产物/功能、机制条件等人工词条：规范检索词必填。 */
export interface CatalogTermEntry extends CatalogText {
  term: string
}

/** 生成器可注入的人工说明集合。 */
export interface CatalogDescriptions {
  /** 设施名 → 说明（规范检索词即设施名）。 */
  facilities: Readonly<Record<string, CatalogText>>
  /** 来源标签 → 说明（键必须覆盖真源全部去重标签）。 */
  tags: Readonly<Record<string, TagCatalogText>>
  /** 产物与功能词条（来自正文主题）。 */
  products: readonly CatalogTermEntry[]
  /** 机制与条件词条。 */
  mechanisms: readonly CatalogTermEntry[]
  /** 类别.md 来源区段名 → 该区段全部类别名共用的说明。 */
  categorySections: Readonly<Record<string, CatalogText>>
  /** 个别类别名的入口覆盖（如该名本身是 facts 精确词条，需改写入口）；缺省时用所属区段说明。 */
  categoryOverrides?: Readonly<Record<string, Partial<CatalogText>>>
  /** 已登记组合共用的说明模板；生成器逐条附加正文来源。 */
  combos: CatalogText
}

/** 九个设施的规范检索词与查询范围说明。顺序无关，实际顺序由真源 REFERENCE_ROOMS 决定。 */
const FACILITIES: Readonly<Record<string, CatalogText>> = {
  办公室: {
    provides: '办公室联络机制与用法、该设施技能干员卡',
    entry: 'F：设施（取具有该设施技能的干员卡）；R：办公室相关正文',
    scope: '联络速度与招募位相关；特殊加成须结合具体技能',
  },
  发电站: {
    provides: '发电站机制与用法、该设施技能干员卡',
    entry: 'F：设施；R：发电站相关正文',
    scope: '当前无来源标签；无人机充能速度、电力属正文主题',
  },
  会客室: {
    provides: '会客室机制与用法、该设施技能干员卡',
    entry: 'F：设施；R：会客室相关正文',
    scope: '线索搜集速度与线索倾向分开，速度不等于倾向',
  },
  加工站: {
    provides: '加工站副产物机制与用法、该设施技能干员卡',
    entry: 'F：设施；R：加工站相关正文',
    scope: '当前缺独立机制正文，默认 RAG 排除技能分片，完整机制覆盖待补',
  },
  控制中枢: {
    provides: '控制中枢机制与用法、该设施技能干员卡',
    entry: 'F：设施；R：控制中枢相关正文',
    scope: '常见全局效果（生产力、订单、宿舍恢复）；条件对象与排除范围须读原文',
  },
  贸易站: {
    provides: '贸易站机制与用法、该设施技能干员卡',
    entry: 'F：设施；R：贸易站相关正文',
    scope: '订单获取效率、订单上限、订单分布为不同对象',
  },
  宿舍: {
    provides: '宿舍恢复机制与用法、该设施技能干员卡',
    entry: 'F：设施；R：宿舍相关正文',
    scope: '恢复对象（自身/单体/群体）与附加条件分开',
  },
  训练室: {
    provides: '训练室协助机制与用法、该设施技能干员卡',
    entry: 'F：设施；R：训练室相关正文',
    scope: '当前缺独立机制正文，默认 RAG 排除技能分片，完整机制覆盖待补',
  },
  制造站: {
    provides: '制造站机制与用法、该设施技能干员卡',
    entry: 'F：设施；R：制造站相关正文',
    scope: '配方类别（贵金属/作战记录/源石）与容量分开',
  },
}

const TAG_COMMON_ENTRY = 'F：tags（按标签反查持有者）；R：相应设施正文与技能相关事实'
const TAG_COMMON_SCOPE_NOTE = '标签只描述被加成对象或功能，不等于完整效果等价'

/** 会客室线索编号与对应线索阵营。 */
function clueTag(index: number, faction: string): TagCatalogText {
  return {
    term: `线索${index}（线索倾向）`,
    provides: `更容易获得线索${index}（${faction}）`,
    entry: TAG_COMMON_ENTRY,
    scope: `线索倾向限定，不等于线索搜集速度；${TAG_COMMON_SCOPE_NOTE}`,
  }
}

/** 加工站材料类标签共用说明。 */
function processingTag(term: string, provides: string, scope: string): TagCatalogText {
  return { term, provides, entry: TAG_COMMON_ENTRY, scope }
}

/** 训练室职业词共用说明。 */
function trainingProfession(profession: string): TagCatalogText {
  return {
    term: `${profession}（训练速度）`,
    provides: `协助${profession}干员专精训练的速度加成`,
    entry: 'F：tags（训练速度标签）与设施（训练室）；R 完整机制待补',
    scope: '默认 RAG 排除技能分片，待补训练室正文',
  }
}

/**
 * 44 个来源标签的规范检索词与范围说明。
 * 声明顺序同时决定目录内同一设施下标签的呈现顺序。
 * 键必须与真源去重标签完全一致，由生成器做覆盖率校验。
 */
const TAGS: Readonly<Record<string, TagCatalogText>> = {
  联络速度: {
    term: '联络速度',
    provides: '人脉资源联络速度加成与招募位相关效果',
    entry: TAG_COMMON_ENTRY,
    scope: `招募位、刷新次数属正文用词，不都等同于联络速度；${TAG_COMMON_SCOPE_NOTE}`,
  },
  特殊加成: {
    term: '特殊加成（须附具体技能/条件）',
    provides: '依附于具体技能的特殊效果，如招募位转线索搜集、转人间烟火等',
    entry: 'F：tags（须附具体技能/条件）；R：类别.md 规则说明、控制中枢相关正文',
    scope: '不能单独作为通用入口；源内有同名定义两条，须带具体技能上下文',
  },
  无特别加成: {
    term: '无特别加成',
    provides: '仅提供常规线索搜集速度、无额外倾向的技能',
    entry: TAG_COMMON_ENTRY,
    scope: `须结合技能释义，不直接当能力结论；${TAG_COMMON_SCOPE_NOTE}`,
  },
  未拥有加成: {
    term: '未拥有加成',
    provides: '更容易获得线索板上尚未拥有的线索',
    entry: TAG_COMMON_ENTRY,
    scope: `须结合技能释义，与线索编号倾向区分；${TAG_COMMON_SCOPE_NOTE}`,
  },
  线索1: clueTag(1, '莱茵生命'),
  线索2: clueTag(2, '企鹅物流'),
  线索3: clueTag(3, '黑钢国际'),
  线索4: clueTag(4, '乌萨斯学生自治团'),
  线索5: clueTag(5, '格拉斯哥帮'),
  线索6: clueTag(6, '喀兰贸易'),
  线索7: clueTag(7, '罗德岛制药'),
  任意材料: processingTag('任意材料（加工站副产物）', '进驻加工站加工任意类材料的副产物产出概率', '默认 RAG 排除技能分片，待补加工站正文'),
  精英材料: processingTag('精英材料（加工站副产物）', '加工精英材料的副产物产出概率', '默认 RAG 排除技能分片，待补加工站正文'),
  基建材料: processingTag('基建材料（加工站副产物）', '加工基建材料的副产物产出概率', '默认 RAG 排除技能分片，待补加工站正文'),
  技巧概要: processingTag('技巧概要（加工站副产物）', '加工技巧概要的副产物产出概率', '默认 RAG 排除技能分片，待补加工站正文'),
  芯片: processingTag('芯片（加工站，与双芯片区分）', '加工芯片的副产物产出概率', '芯片与制造侧双芯片是不同对象；待补加工站正文'),
  生产力: {
    term: '全局制造加成',
    provides: '控制中枢进驻时为制造站提供全局生产力加成',
    entry: 'F：tags（来源标签：生产力）与设施（控制中枢）；R：控制中枢机制',
    scope: `须读技能作用范围与生效条件（同种效果取最高等）；${TAG_COMMON_SCOPE_NOTE}`,
  },
  订单效率: {
    term: '订单获取效率',
    provides: '当前贸易站订单获取速度加成',
    entry: 'F：tags（来源标签：订单效率）与设施（贸易站）；R：贸易站机制',
    scope: '与订单上限、订单分布是不同对象；站内归零等条件须读原文',
    roomOverrides: {
      控制中枢: {
        term: '全局订单加成',
        provides: '控制中枢进驻时为贸易站提供全局订单获取效率加成',
        entry: 'F：tags（来源标签：订单效率）与设施（控制中枢）；R：控制中枢机制',
        scope: '与贸易站内订单获取效率不同，须读技能作用范围',
      },
    },
  },
  办公室: {
    term: '办公室联络加成',
    provides: '控制中枢进驻时影响人力办公室联络速度',
    entry: 'F：tags（来源标签：办公室）与设施（控制中枢）；R：控制中枢机制',
    scope: `该标签来自控制中枢，作用对象是办公室；${TAG_COMMON_SCOPE_NOTE}`,
  },
  线索搜集: {
    term: '线索搜集速度（控制中枢）',
    provides: '控制中枢进驻时提升会客室线索搜集速度',
    entry: 'F：tags（来源标签：线索搜集）与设施（控制中枢）/会客室；R：控制中枢机制',
    scope: `与线索倾向不同（同种效果取最高）；${TAG_COMMON_SCOPE_NOTE}`,
  },
  线索倾向: {
    term: '线索倾向（控制中枢）',
    provides: '提升会客室线索倾向（派系线索概率）',
    entry: 'F：tags（来源标签：线索倾向）与设施（控制中枢）/会客室；R：控制中枢机制',
    scope: `倾向不等于搜集速度；${TAG_COMMON_SCOPE_NOTE}`,
  },
  心情消耗: {
    term: '心情消耗（控制中枢）',
    provides: '控制中枢进驻时改变自身或中枢内干员心情恢复/消耗',
    entry: 'F：tags（来源标签：心情消耗）与设施（控制中枢）；R：控制中枢机制、心情与工休',
    scope: `区分自身、中枢内、宿舍内等作用范围；${TAG_COMMON_SCOPE_NOTE}`,
  },
  订单上限: {
    term: '订单上限',
    provides: '当前贸易站订单容量上限',
    entry: 'F：tags（来源标签：订单上限）与设施（贸易站）；R：贸易站机制',
    scope: `容量收益不等于获取效率；${TAG_COMMON_SCOPE_NOTE}`,
  },
  特殊订单: {
    term: '特殊订单',
    provides: '固定获取可露希尔/特别独占等特殊订单及违约订单判定',
    entry: 'F：tags（来源标签：特殊订单）与设施（贸易站）；R：贸易站机制',
    scope: `特殊订单与常规订单获取效率分开；${TAG_COMMON_SCOPE_NOTE}`,
  },
  高品质: {
    term: '高品质贵金属订单',
    provides: '提升当前贸易站高品质贵金属订单出现概率',
    entry: 'F：tags（来源标签：高品质）与设施（贸易站）；R：贸易站机制',
    scope: `受工作时长影响，不等于订单获取效率；${TAG_COMMON_SCOPE_NOTE}`,
  },
  单体恢复: {
    term: '单体恢复（宿舍心情）',
    provides: '恢复宿舍内除自身外某一名干员心情',
    entry: 'F：tags（来源标签：单体恢复）与设施（宿舍）；R：宿舍、心情与工休',
    scope: `作用对象为单个同宿舍干员；${TAG_COMMON_SCOPE_NOTE}`,
  },
  群体恢复: {
    term: '群体恢复（宿舍心情）',
    provides: '恢复该宿舍内所有干员心情',
    entry: 'F：tags（来源标签：群体恢复）与设施（宿舍）；R：宿舍、心情与工休',
    scope: `叠加后最终值同种效果取最高；${TAG_COMMON_SCOPE_NOTE}`,
  },
  自身恢复: {
    term: '自身恢复（宿舍心情）',
    provides: '恢复自身心情',
    entry: 'F：tags（来源标签：自身恢复）与设施（宿舍）；R：宿舍、心情与工休',
    scope: `部分技能同时含自身与群体恢复；${TAG_COMMON_SCOPE_NOTE}`,
  },
  特殊恢复: {
    term: '特殊恢复（宿舍心情）',
    provides: '对特定对象或条件下追加的宿舍心情恢复',
    entry: 'F：tags（来源标签：特殊恢复）与设施（宿舍）；R：宿舍、心情与工休',
    scope: `须读附加条件（目标阵营、宿舍等级、心情阈值等）；${TAG_COMMON_SCOPE_NOTE}`,
  },
  先锋: trainingProfession('先锋'),
  近卫: trainingProfession('近卫'),
  重装: trainingProfession('重装'),
  狙击: trainingProfession('狙击'),
  术师: trainingProfession('术师'),
  医疗: trainingProfession('医疗'),
  辅助: trainingProfession('辅助'),
  特种: trainingProfession('特种'),
  全能: {
    term: '通用训练速度',
    provides: '对全部职业干员的专精训练速度加成',
    entry: 'F：tags（来源标签：全能）与设施（训练室）；R 完整机制待补',
    scope: '默认 RAG 排除技能分片，待补训练室正文',
  },
  减半: {
    term: '训练时间减半',
    provides: '单次协助满足时长后使该干员下次训练时间减半',
    entry: 'F：tags（来源标签：减半）与设施（训练室）；R 完整机制待补',
    scope: '协助关系离开训练室时效果消失；待补训练室正文',
  },
  通用生产: {
    term: '通用制造',
    provides: '所有配方的通用生产力加成（作用于赤金/作战记录/源石碎片）',
    entry: 'F：tags（来源标签：通用生产）与设施（制造站）；R：制造站机制、高效率散件',
    scope: `不等于某一类配方加成；${TAG_COMMON_SCOPE_NOTE}`,
  },
  贵金属: {
    term: '赤金',
    provides: '贵金属类配方（赤金）的生产力加成',
    entry: 'F：tags（来源标签：贵金属）与设施（制造站）/作用产物赤金；R：制造站机制',
    scope: `贵金属是来源标签用词，映射到赤金配方；${TAG_COMMON_SCOPE_NOTE}`,
  },
  作战记录: {
    term: '作战记录',
    provides: '作战记录类配方的生产力加成',
    entry: 'F：tags（来源标签：作战记录）与设施（制造站）/作用产物作战记录；R：制造站机制',
    scope: `作战记录类配方与经验产出分开；${TAG_COMMON_SCOPE_NOTE}`,
  },
  源石: {
    term: '源石碎片',
    provides: '源石类配方（源石碎片）的生产力加成',
    entry: 'F：tags（来源标签：源石）与设施（制造站）/作用产物源石碎片；R：制造站机制',
    scope: `不将标签「源石」解释为所有源石用途；${TAG_COMMON_SCOPE_NOTE}`,
  },
  仓库容量: {
    term: '仓库容量',
    provides: '制造站仓库容量上限加成',
    entry: 'F：tags（来源标签：仓库容量）与设施（制造站）；R：制造站机制',
    scope: `容量收益不等于生产力；${TAG_COMMON_SCOPE_NOTE}`,
  },
}

/** 产物与功能词条：来自正文的主题词，按设施搭配使用，精确技能及持有者仍走 F。 */
const PRODUCTS: readonly CatalogTermEntry[] = [
  { term: '赤金、贵金属类配方、通用制造、生产力', provides: '制造侧能力与配方范围', entry: 'R：制造站机制、高效率散件', scope: '贵金属是来源标签用词，映射到赤金配方' },
  { term: '作战记录、基础作战记录、初级作战记录、中级作战记录', provides: '经验产物与制造条件', entry: 'R：基建物流链、制造站机制', scope: '作战记录类配方与经验产出分开查' },
  { term: '源石碎片、源石类配方', provides: '专项与通用制造能力、生产链', entry: 'R：高效率散件、基建物流链', scope: '不将标签「源石」解释为所有源石用途' },
  { term: '双芯片', provides: '制造配方；与加工站芯片转换区分', entry: 'R：基建物流链', scope: '双芯片来自正文，不是作用产物字段已有值' },
  { term: '龙门币、合成玉、龙门商法、开采协力', provides: '贸易产物、订单策略及上下游', entry: 'R：基建物流链、贸易站机制', scope: '龙门币、合成玉来自正文，不冒充作用产物字段' },
  { term: '订单获取效率、订单上限、高品质贵金属订单、特殊订单', provides: '速度、容量、订单分布与类型', entry: 'R：贸易站机制', scope: '四种对象分开查' },
  { term: '仓库容量、原料预扣、自动补货', provides: '制造容量与操作流程', entry: 'R：制造站机制', scope: '容量与生产力是不同收益' },
  { term: '联络速度、刷新次数、招募位', provides: '办公室计时与功能', entry: 'R：办公室机制、办公室联络散件', scope: '刷新次数为正文用词' },
  { term: '线索搜集速度、线索倾向、线索交流、线索传递', provides: '会客室速度、倾向及交换', entry: 'R：会客室机制、技能相关事实', scope: '速度不等于倾向' },
  { term: '无人机充能速度、无人机加速、电力', provides: '充能与供电、加速用途', entry: 'R：发电站机制、控制中枢机制', scope: '发电站当前无来源标签' },
  { term: '心情消耗、心情恢复、单体恢复、群体恢复、自身恢复', provides: '工作代价与宿舍恢复', entry: 'R：宿舍、心情与工休、相关技能', scope: '恢复对象与作用范围须读原文' },
  { term: '任意材料、精英材料、基建材料、技巧概要、芯片、副产物', provides: '加工对象、概率与心情', entry: 'F：可先查「加工站」及明确技能名；R 机制覆盖不足', scope: '默认 RAG 排除技能分片，待补加工站正文' },
  { term: '训练速度、技能专精、训练时间减半', provides: '职业范围、协助加速与减半', entry: 'F：可先查「训练室」及明确技能名；R 完整机制待补', scope: '默认 RAG 排除技能分片，待补训练室正文' },
]

/** 机制与条件词条：入口均为 R（正文机制篇）。 */
const MECHANISMS: readonly CatalogTermEntry[] = [
  { term: '技能解锁、提升、替换、最低练度', provides: '技能并存、替换与解锁门槛', entry: 'R：机制-技能解锁与练度；具体卡另用 F', scope: '不假定已有完整练度模型' },
  { term: '后勤技能结算、归零、清除自身影响', provides: '局部作用域和清除边界', entry: 'R：机制-后勤技能结算', scope: '作用域与清除边界须读原文，不能跨技能外推' },
  { term: '同种效果取最高、叠加、特殊叠加规则', provides: '指定效果关系', entry: 'R：机制-后勤技能结算、类别.md', scope: '没有统一全局顺序' },
  { term: '中间资源、生成与转化、设施数量', provides: '资源提供者、消费者及计数范围', entry: 'R：机制-后勤技能结算', scope: '计数范围按设施或干员数量，须读结算规则' },
  { term: '同站成员、其他干员、进驻、副手、活动室', provides: '条件对象及排除范围', entry: 'R：基建总览、控制中枢、跨设施组合', scope: '活动室与副手常在效果中被排除' },
  { term: '心情净变化、工休比、最长工作时间、宿舍恢复', provides: '工作与休息模型', entry: 'R：机制-心情与工休、机制-宿舍', scope: '工休模型来自正文，不反推用户未提供的配置' },
  { term: '工作时长、首小时、最终值', provides: '爬升效果与终值边界', entry: 'R：高效率散件、技能事实', scope: '不假定已有完整暖机模型' },
  { term: '订单生成概率、订单策略、确定时点、交付数量、订单报酬', provides: '订单获取与交付口径', entry: 'R：机制-贸易站', scope: '获取与交付口径分开，具体数值以原文为准' },
  { term: '基建物流链、收支平衡、贵金属价值、简报', provides: '制造投入与贸易产出', entry: 'R：基建物流链、机制-控制中枢', scope: '制造投入与贸易产出分开核算' },
  { term: '队列轮换、快速切换、进驻顺序', provides: '既有队列操作事实', entry: 'R：机制-基建总览', scope: '不表示已有完整轮班策略' },
  { term: '新手培养、最低目标、散件、组合核心、挂件', provides: '选择理由和适用边界', entry: 'R：新手培养、高效率散件及组合 guides', scope: '选择理由不构成固定培养目标' },
]

/** 类别.md 六个来源区段共用说明；键为去掉条数标注后的区段名。 */
const CATEGORY_SECTIONS: Readonly<Record<string, CatalogText>> = {
  干员组: {
    provides: '阵营/干员组成员与所属',
    entry: 'R：类别定义（knowledge/references/类别.md）；F：干员组（命中仅表示相关卡）',
    scope: 'F 命中只表示相关卡，不表示组关系已取得证据',
  },
  全局资源: {
    provides: '全局资源的来源与计数规则',
    entry: 'R：类别定义；F 命中仅表示相关卡',
    scope: '资源计数按设施或干员数量，须读定义',
  },
  技能组: {
    provides: '类技能/技能等价组成员',
    entry: 'R：类别定义；F：技能组（命中仅表示相关卡）',
    scope: '不得据组名推断完整效果等价',
  },
  技能持有: {
    provides: '指定技能的持有者',
    entry: 'R：类别定义；F：技能（命中仅表示相关卡）',
    scope: '持有者名单以类别定义为准，F 命中只表示相关卡',
  },
  设施组: {
    provides: '设施范围的枚举（如其他设施、工作场所）',
    entry: 'R：类别定义；F 当前不提供设施组查询',
    scope: '设施组用于技能条件中的范围限定',
  },
  规则说明: {
    provides: '术语、资源变量与叠加/比较规则定义',
    entry: 'R：类别定义；F 命中仅表示相关卡',
    scope: '同名定义须带具体技能上下文（如特殊加成、特殊叠加规则各两条）',
  },
}

/** 无对应 facts 登记词条的类别名入口说明：只保留 R，明确 F 不适用，避免引导 Agent 发起空查询。 */
const CATEGORY_R_ONLY_ENTRY = 'R：类别定义；F 无对应登记词条'

/**
 * 无对应 facts 词条的类别名（已按现有登记逐项核对，facts_search 返回空）。
 * 注释按来源区段分组，说明为何没有可用的 F 入口。
 */
const CATEGORY_R_ONLY_NAMES = [
  // 全局资源：外势/实地/工程机器人/魔物料理只有定义，无同名 facts 词条。
  '外势',
  '实地',
  '工程机器人',
  '魔物料理',
  // 规则说明：变量与规则定义，无同名 facts 词条；特殊加成、特殊叠加规则各含两条同名定义。
  '人间烟火',
  '可露希尔特别订单',
  '小节',
  '异格',
  '心情落差',
  '思维链环',
  '感知信息',
  '木天蓼',
  '梦境',
  '武道',
  '热情值',
  '特别独占订单',
  '特殊加成',
  '特殊叠加规则',
  '特殊比较规则',
  '记忆碎片',
  '赤金生产线',
] as const

/** 个别类别名的入口覆盖：该名本身是 facts 精确词条时改标 F（技能/技能组/干员组/登记入口），无对应词条时明确 F 不适用。 */
const CATEGORY_OVERRIDES: Readonly<Record<string, Partial<CatalogText>>> = {
  ...Object.fromEntries(CATEGORY_R_ONLY_NAMES.map((name) => [name, { entry: CATEGORY_R_ONLY_ENTRY }] as const)),
  乌萨斯特饮: { entry: 'F：技能（命中仅表示相关卡）；R：类别定义' },
  情报储备: { entry: 'F：技能（命中仅表示相关卡）；R：类别定义' },
  巫术结晶: { entry: CATEGORY_R_ONLY_ENTRY },
  业报: { entry: 'F：技能（命中仅表示相关卡）；R：类别定义' },
  仿生海龙: { entry: 'F：技能（命中仅表示相关卡）；R：类别定义' },
  因果: { entry: 'F：技能（命中仅表示相关卡）；R：类别定义' },
  无声共鸣: { entry: 'F：技能（命中仅表示相关卡）；R：类别定义' },
  '自动化·α': { entry: 'F：技能（命中仅表示相关卡）；R：类别定义' },
  '自动化·β': { entry: 'F：技能（命中仅表示相关卡）；R：类别定义' },
  叙拉古: { entry: 'F：干员组、登记组合（命中仅表示相关卡）；R：类别定义' },
  嘉维尔: { entry: 'F：干员/干员组（含已登记子串入口，命中仅表示相关卡）；R：类别定义' },
  能天使: { entry: 'F：干员/干员组（含已登记子串入口，命中仅表示相关卡）；R：类别定义' },
  彩虹小队: { entry: 'F：技能/干员组（命中仅表示相关卡）；R：类别定义' },
}

/** 人工说明数据汇总，供生成器注入。 */
export const CATALOG_DESCRIPTIONS: CatalogDescriptions = {
  facilities: FACILITIES,
  tags: TAGS,
  products: PRODUCTS,
  mechanisms: MECHANISMS,
  categorySections: CATEGORY_SECTIONS,
  categoryOverrides: CATEGORY_OVERRIDES,
  combos: {
    provides: '组合成员卡与分工、条件与建议',
    entry: 'F：登记组合；R：组合解释（guides）',
    scope: 'F 成员命中不代表组合关系已取得证据；开放成员范围不承诺穷尽',
  },
}
