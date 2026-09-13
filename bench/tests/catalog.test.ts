import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_RELATIVE_PATH,
  buildKeywordCatalog,
  catalogDifference,
  generateKeywordCatalogMarkdown,
  loadKeywordCatalogInputs,
  parseCategorySections,
  renderKeywordCatalog,
  type CatalogInputs,
} from '../src/catalog.js'
import { getCardStore } from '../src/facts/store.js'
import { loadKnowledgeAgentInstructions } from '../src/agent.js'

/** 注入夹具：只保留少量设施/标签/类别/组合 + 人工说明，用于验证顺序与覆盖校验。 */
const fixture: CatalogInputs = {
  rooms: [
    { room: '会客室', tags: ['线索1', '未拥有加成'] },
    { room: '发电站', tags: [] },
    { room: '制造站', tags: ['通用生产'] },
  ],
  categorySections: [
    { name: '干员组', names: ['A1小队'] },
    { name: '规则说明', names: ['特殊加成', '特殊加成'] },
  ],
  combos: [{ name: '龙舌兰组', source: 'knowledge/guides/贸易站组合.md' }],
  descriptions: {
    facilities: {
      会客室: { provides: '会客室机制与用法、该设施技能干员卡', entry: 'F：设施；R：会客室相关正文', scope: '线索搜集速度与线索倾向分开' },
      发电站: { provides: '发电站机制与用法、该设施技能干员卡', entry: 'F：设施；R：发电站相关正文', scope: '当前无来源标签' },
      制造站: { provides: '制造站机制与用法、该设施技能干员卡', entry: 'F：设施；R：制造站相关正文', scope: '配方类别与容量分开' },
    },
    tags: {
      线索1: { term: '线索1（线索倾向）', provides: '更容易获得线索1', entry: 'F：tags（按标签反查持有者）；R：会客室相关正文', scope: '不等于线索搜集速度' },
      未拥有加成: { term: '未拥有加成', provides: '更容易获得尚未拥有的线索', entry: 'F：tags（按标签反查持有者）；R：会客室相关正文', scope: '须结合技能释义' },
      通用生产: { term: '通用制造', provides: '通用制造能力', entry: 'F：tags（按来源标签反查持有者）；R：制造站机制', scope: '不等于某一类配方加成' },
    },
    products: [
      { term: '赤金', provides: '贵金属类配方', entry: 'R：制造站机制、基建物流链', scope: '贵金属是来源标签用词' },
    ],
    mechanisms: [
      { term: '技能解锁、提升、替换、最低练度', provides: '技能替换与解锁门槛', entry: 'R：机制-技能解锁与练度', scope: '具体卡另用 F' },
    ],
    categorySections: {
      干员组: { provides: '阵营成员', entry: 'R：类别定义；F：干员组（命中仅表示相关卡）', scope: '不得据此推断效果等价' },
      规则说明: { provides: '术语与规则定义', entry: 'R：类别定义；F 命中仅表示相关卡', scope: '同名定义须带具体技能上下文' },
    },
    categoryOverrides: {
      特殊加成: { entry: 'F：技能（命中仅表示相关卡）；R：类别定义' },
    },
    combos: { provides: '组合成员卡与分工、条件与建议', entry: 'F：登记组合；R：组合解释（guides）', scope: 'F 成员命中不代表组合关系已取得证据' },
  },
}

describe('catalog：机械汇总与人工说明合并', () => {
  it('按固定顺序输出设施（含来源标签）→ 产物与功能 → 机制与条件 → 资源/类别/技能组 → 组合', () => {
    const entries = buildKeywordCatalog(fixture)
    const sections = [...new Set(entries.map((entry) => entry.section))]

    expect(sections).toEqual(['facilities', 'products', 'mechanisms', 'categories', 'combos'])
    // 设施固定顺序：先设施行，再按设施分组的来源标签（发电站无标签不出现）。
    expect(entries.slice(0, 3).map((entry) => entry.term)).toEqual(['会客室', '发电站', '制造站'])
    expect(entries.filter((entry) => entry.group === '来源标签 · 会客室').map((entry) => entry.term))
      .toEqual(['线索1（线索倾向）（来源标签：线索1）', '未拥有加成'])
    expect(entries.filter((entry) => entry.group === '来源标签 · 制造站').map((entry) => entry.term))
      .toEqual(['通用制造（来源标签：通用生产）'])
    expect(entries.filter((entry) => entry.section === 'categories').map((entry) => entry.term))
      .toEqual(['A1小队', '特殊加成', '特殊加成'])
    expect(entries.filter((entry) => entry.section === 'combos').map((entry) => entry.term)).toEqual(['龙舌兰组'])
  })

  it('每条保留检索词、能查什么、工具入口、必要范围四要素，且入口标记沿用 F/R', () => {
    const entries = buildKeywordCatalog(fixture)
    for (const entry of entries) {
      expect(entry.term.trim()).not.toBe('')
      expect(entry.provides.trim()).not.toBe('')
      expect(entry.entry.trim()).not.toBe('')
      expect(entry.scope.trim()).not.toBe('')
    }
    const rendered = renderKeywordCatalog(entries)
    expect(rendered).toContain('| 检索词 | 能查什么 | 工具入口 | 必要范围 |')
    expect(rendered).toContain('F：设施')
    expect(rendered).toContain('R：类别定义')
    // 标签入口已接通：来源标签行标注 F：tags 反查，不再声称未接通。
    expect(rendered).toContain('F：tags')
    expect(rendered).not.toContain('标签独立入口尚未接通')
  })

  it('缺少来源标签人工说明或引用了不存在的标签时报中文错误', () => {
    const missing = { ...fixture.descriptions.tags } as Record<string, CatalogInputs['descriptions']['tags'][string]>
    delete missing['通用生产']
    expect(() => buildKeywordCatalog({
      ...fixture,
      descriptions: { ...fixture.descriptions, tags: missing },
    })).toThrowError('关键词目录缺少来源标签说明：通用生产')
    expect(() => buildKeywordCatalog({
      ...fixture,
      descriptions: {
        ...fixture.descriptions,
        tags: { ...fixture.descriptions.tags, 不存在标签: { provides: 'x', entry: 'R', scope: 'y' } },
      },
    })).toThrowError('关键词目录引用了不存在的来源标签：不存在标签')
  })

  it('类别名可覆盖区段说明（如本身是 facts 精确词条时改标 F）', () => {
    const entries = buildKeywordCatalog(fixture)
    const overridden = entries.filter((entry) => entry.term === '特殊加成')

    expect(overridden).toHaveLength(2)
    expect(overridden.every((entry) => entry.entry === 'F：技能（命中仅表示相关卡）；R：类别定义')).toBe(true)
    expect(entries.find((entry) => entry.term === 'A1小队')?.entry)
      .toBe('R：类别定义；F：干员组（命中仅表示相关卡）')
  })

  it('缺少设施说明或类别区段说明时报中文错误', () => {
    const missingFacility = { ...fixture.descriptions.facilities } as Record<string, CatalogInputs['descriptions']['facilities'][string]>
    delete missingFacility['发电站']
    expect(() => buildKeywordCatalog({
      ...fixture,
      descriptions: { ...fixture.descriptions, facilities: missingFacility },
    })).toThrowError('关键词目录缺少设施说明：发电站')

    const missingSection = { ...fixture.descriptions.categorySections } as Record<string, CatalogInputs['descriptions']['categorySections'][string]>
    delete missingSection['规则说明']
    expect(() => buildKeywordCatalog({
      ...fixture,
      descriptions: { ...fixture.descriptions, categorySections: missingSection },
    })).toThrowError('关键词目录缺少类别区段说明：规则说明')

    const extraFacility = { ...fixture.descriptions.facilities, 不存在设施: { provides: 'x', entry: 'R', scope: 'y' } }
    expect(() => buildKeywordCatalog({
      ...fixture,
      descriptions: { ...fixture.descriptions, facilities: extraFacility },
    })).toThrowError('关键词目录引用了不存在的设施：不存在设施')

    const extraSection = { ...fixture.descriptions.categorySections, 不存在区段: { provides: 'x', entry: 'R', scope: 'y' } }
    expect(() => buildKeywordCatalog({
      ...fixture,
      descriptions: { ...fixture.descriptions, categorySections: extraSection },
    })).toThrowError('关键词目录引用了不存在的类别区段：不存在区段')

    expect(() => buildKeywordCatalog({
      ...fixture,
      descriptions: { ...fixture.descriptions, categoryOverrides: { 不存在类别: { entry: 'F' } } },
    })).toThrowError('关键词目录引用了不存在的类别名：不存在类别')
  })

  it('类别真源缺少可解析区段或区段为空时报中文错误', () => {
    expect(() => parseCategorySections('无标题正文')).toThrowError('无法解析类别区段')
    expect(() => parseCategorySections('## 干员组（0 条）\n\n本节无条目\n')).toThrowError('类别区段为空：干员组')
  })
})

describe('catalog：真源机械核对', () => {
  it('按真源重算的目录与入库的 knowledge/关键词目录.md 完全一致', () => {
    const root = process.cwd()
    const generated = generateKeywordCatalogMarkdown(root)
    const onDisk = readFileSync(join(root, ...CATALOG_RELATIVE_PATH.split('/')), 'utf-8')

    expect(catalogDifference(generated, onDisk.replace(/\r\n/g, '\n'))).toEqual([])
  })

  it('类别区段的 F 入口与实际 facts 登记一致：无命中只标 R，不引导空查询', () => {
    const store = getCardStore()
    const entries = buildKeywordCatalog(loadKeywordCatalogInputs(process.cwd()))
    const categoryEntries = entries.filter((entry) => entry.section === 'categories')
    expect(categoryEntries.length).toBeGreaterThan(0)
    for (const entry of categoryEntries) {
      const resolves = store.factsSearch(entry.term).paths.length > 0
      expect(entry.entry.includes('F：'), `${entry.term} 的入口标注与登记不一致：${entry.entry}`).toBe(resolves)
    }
  })

  it('差异摘要能定位不一致行', () => {
    const expected = 'a\nb\nc\n'
    const actual = 'a\nX\nc\n'

    const diff = catalogDifference(expected, actual)
    expect(diff.length).toBeGreaterThan(0)
    expect(diff.join('\n')).toContain('第 2 行')
  })
})

describe('catalog：随 Agent 指令送达', () => {
  it('loadKnowledgeAgentInstructions 同时返回 AGENTS.md 正文与关键词目录', () => {
    const instructions = loadKnowledgeAgentInstructions()

    expect(instructions).toContain('明日方舟基建查询 Agent 决策契约')
    expect(instructions).toContain('查询关键词目录')
    expect(instructions).toContain('| 检索词 | 能查什么 | 工具入口 | 必要范围 |')
    // 生成物 provenance 注释属维护信息，不进入注入正文。
    expect(instructions).not.toContain('请勿手改')
  })

  it('缺少关键词目录时报中文错误并指明关键词目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-catalog-missing-'))
    try {
      mkdirSync(join(root, 'knowledge'))
      writeFileSync(join(root, 'knowledge', 'AGENTS.md'), '# 决策契约\n', 'utf-8')
      expect(() => loadKnowledgeAgentInstructions(root)).toThrowError('关键词目录')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('关键词目录为空时报中文错误', () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-catalog-empty-'))
    try {
      mkdirSync(join(root, 'knowledge'))
      writeFileSync(join(root, 'knowledge', 'AGENTS.md'), '# 决策契约\n', 'utf-8')
      writeFileSync(join(root, 'knowledge', '关键词目录.md'), '  \n', 'utf-8')
      expect(() => loadKnowledgeAgentInstructions(root)).toThrowError('关键词目录为空')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
