import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OperatorSkillGrant, OperatorDefinition, SkillFact } from '../src/facts/normalized.js'
import type { ReferenceFacts } from '../src/facts/references.js'
import { getCardStore, skillProjection } from '../src/facts/store.js'
import { buildSectionDirectory, type SectionDirectory } from '../src/sections.js'
import {
  buildProseLinkIndex,
  loadProseLinkFile,
  parseProseLinkFile,
  readObjectsFor,
  resolveProseLinks,
  type ProseLinkFile,
} from '../src/prose-links.js'

function operator(id: string, canonical: string, declaredRooms: string[]): OperatorDefinition {
  return { id, canonical, rarity: '6', profession: '近卫', declaredRooms: declaredRooms as OperatorDefinition['declaredRooms'], factionGroups: [] }
}

function skillFact(id: string, room: string, name: string): SkillFact {
  return { id, room: room as SkillFact['room'], name, rawEffectText: '效果', rawAnnotationText: '', tags: [], products: [], professions: [], referencedTerms: [] }
}

function grant(id: string, operatorId: string, skillId: string, unlockText: string, replacesGrantId?: string): OperatorSkillGrant {
  return { id, operatorId, skillId, unlockText, unlockKind: 'initial', sourceOrder: 1, ...(replacesGrantId ? { replacesGrantId } : {}) }
}

/** 隔离夹具：只覆盖解析分支所需的最少事实，不读取真实 references。 */
function factsFixture(): ReferenceFacts {
  return {
    operators: [operator('op-a', '干员甲', ['办公室', '制造站']), operator('op-b', '干员乙', ['办公室'])],
    fragments: [],
    skillFacts: [
      skillFact('s-初', '办公室', '初技能'),
      skillFact('s-升', '办公室', '升级技能'),
      skillFact('s-歧甲', '办公室', '歧义技能'),
      skillFact('s-歧乙', '办公室', '歧义技能'),
      skillFact('s-乙', '办公室', '乙技能'),
    ],
    grants: [
      grant('g-初', 'op-a', 's-初', '初始解锁'),
      grant('g-升', 'op-a', 's-升', '精英 2 提升，替换「初技能」', 'g-初'),
      grant('g-歧甲', 'op-a', 's-歧甲', '初始解锁'),
      grant('g-歧乙', 'op-a', 's-歧乙', '精英 2 解锁'),
      grant('g-乙', 'op-b', 's-乙', '初始解锁'),
    ],
  }
}

const DOC = [
  '# 示例',
  '',
  '示例前言。',
  '',
  '## 甲节',
  '',
  '甲节正文。',
  '',
  '### 甲节子节',
  '',
  '甲节子节正文。',
  '',
  '## 乙节',
  '',
  '乙节正文。',
  '',
  '## 术语表',
  '',
  '- **心情落差**：定义甲。',
  '- **心情落差**：定义乙。',
  '- **共享词**：定义丙。',
  '',
  '## 重复',
  '',
  '重复一。',
  '',
  '## 重复',
  '',
  '重复二。',
  '',
].join('\n')

let root: string
let corpusDir: string
let directory: SectionDirectory

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rag-prose-links-'))
  corpusDir = join(root, 'knowledge')
  mkdirSync(join(corpusDir, 'guides'), { recursive: true })
  writeFileSync(join(corpusDir, 'guides', '示例.md'), DOC, 'utf-8')
  writeFileSync(join(corpusDir, 'corpus-manifest.json'), JSON.stringify({ files: ['guides/示例.md'] }), 'utf-8')
  directory = buildSectionDirectory(corpusDir)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function linkFile(
  objects: ProseLinkFile['links'][number]['objects'],
  headingPath = ['示例', '甲节'],
  extra: Partial<ProseLinkFile['links'][number]> = {},
): ProseLinkFile {
  return { version: 2, links: [{ file: 'guides/示例.md', headingPath, scope: 'section', objects, ...extra }] }
}

function resolve(file: ProseLinkFile) {
  return resolveProseLinks({ file, directory, facts: factsFixture() })
}

function sectionId(heading: string): string {
  return directory.sections.find((section) => section.heading === heading)!.sectionId
}

describe('prose-links：可读引用解析', () => {
  it('干员引用解析为 operator:<canonical>，保留可读锚点', () => {
    const index = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }]))

    expect(index.issues).toEqual([])
    const link = index.links[0]!
    expect(link.sectionId).toBe(sectionId('甲节'))
    expect(link.headingPath).toEqual(['示例', '甲节'])
    expect(link.scope).toBe('section')
    expect(link.objects).toEqual([{ kind: 'card', ref: 'operator:干员甲', canonical: '干员甲' }])
    expect(index.bySection.get(link.sectionId)).toBe(link)
  })

  it('技能引用解析到当前 skill/grant 内部 ID，并保留替换目标', () => {
    const index = resolve(linkFile([{ kind: 'skill', operator: '干员甲', room: '办公室', name: '升级技能' }]))

    expect(index.issues).toEqual([])
    expect(index.links[0]!.objects).toEqual([
      { kind: 'card', ref: '办公室｜「升级技能」｜干员甲', canonical: '干员甲', grantId: 'g-升', skillId: 's-升' },
    ])
  })

  it('同设施技能名歧义时报告错误，补充 unlock 后可唯一解析', () => {
    const ambiguous = resolve(linkFile([{ kind: 'skill', operator: '干员甲', room: '办公室', name: '歧义技能' }]))
    expect(ambiguous.links[0]!.objects).toEqual([])
    expect(ambiguous.links[0]!.unresolved).toEqual([
      { ref: '办公室｜「歧义技能」｜干员甲', reason: '关联技能解析歧义（命中 2 条），需补充 unlock' },
    ])
    expect(ambiguous.issues.join('\n')).toContain('歧义技能')

    const disambiguated = resolve(linkFile([{ kind: 'skill', operator: '干员甲', room: '办公室', name: '歧义技能', unlock: '精英 2 解锁' }]))
    expect(disambiguated.issues).toEqual([])
    expect(disambiguated.links[0]!.objects[0]).toMatchObject({ canonical: '干员甲', grantId: 'g-歧乙', skillId: 's-歧乙' })
  })

  it('引用不存在时报告并跳过该对象，其它合法引用继续', () => {
    const index = resolve(linkFile([
      { kind: 'operator', canonical: '不存在的干员' },
      { kind: 'operator', canonical: '干员甲' },
      { kind: 'skill', operator: '干员甲', room: '办公室', name: '不存在的技能' },
      { kind: 'skill', operator: '不存在的干员', room: '办公室', name: '技能' },
    ]))

    expect(index.links[0]!.objects).toEqual([{ kind: 'card', ref: 'operator:干员甲', canonical: '干员甲' }])
    expect(index.links[0]!.unresolved).toEqual([
      { ref: 'operator:不存在的干员', reason: '关联干员不在名册' },
      { ref: '办公室｜「不存在的技能」｜干员甲', reason: '未找到关联技能' },
      { ref: '办公室｜「技能」｜不存在的干员', reason: '关联技能持有者不在名册' },
    ])
    expect(index.issues).toHaveLength(3)
    expect(index.issues.join('\n')).toContain('不存在的干员')
    expect(index.issues.join('\n')).toContain('不存在的技能')
  })

  it('同一小节的重复引用去重，空关联合法', () => {
    const deduped = resolve(linkFile([
      { kind: 'operator', canonical: '干员甲' },
      { kind: 'operator', canonical: '干员甲' },
    ]))
    expect(deduped.links[0]!.objects).toHaveLength(1)
    expect(deduped.issues.join('\n')).toContain('重复引用')

    const empty = resolve(linkFile([]))
    expect(empty.issues).toEqual([])
    expect(empty.links[0]!).toMatchObject({ objects: [] })
  })

  it('同一技能不同写法解析到同一 grant 时按对象身份去重并保留可读引用', () => {
    const index = resolve(linkFile([
      { kind: 'skill', operator: '干员甲', room: '办公室', name: '升级技能' },
      { kind: 'skill', operator: '干员甲', room: '办公室', name: '升级技能', unlock: '精英 2 提升，替换「初技能」' },
    ]))

    expect(index.links[0]!.objects).toEqual([
      { kind: 'card', ref: '办公室｜「升级技能」｜干员甲', canonical: '干员甲', grantId: 'g-升', skillId: 's-升' },
    ])
    expect(index.issues.join('\n')).toContain('重复引用')
  })
})

describe('prose-links：概念引用', () => {
  it('未填 term 时定位到无子标题的单概念小节全文', () => {
    const index = resolve(linkFile([{ kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '乙节'] }]))

    expect(index.issues).toEqual([])
    const concept = index.links[0]!.objects[0]!
    expect(concept).toMatchObject({
      kind: 'concept',
      name: '乙节',
      file: 'guides/示例.md',
      headingPath: ['示例', '乙节'],
      definition: '乙节正文。',
    })
    expect(concept.kind === 'concept' ? concept.startLine : 0).toBeGreaterThan(0)
  })

  it('填 term 时按行首条目定位，连续内容取至下一条同级条目', () => {
    const index = resolve(linkFile([{ kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '术语表'], term: '共享词' }]))

    expect(index.issues).toEqual([])
    expect(index.links[0]!.objects[0]).toMatchObject({
      kind: 'concept',
      name: '共享词',
      term: '共享词',
      termOccurrence: 1,
      definition: '- **共享词**：定义丙。',
    })
  })

  it('含多个术语条目的叶小节须填写 term，不能整节包装为概念', () => {
    const index = resolve(linkFile([{ kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '术语表'] }]))
    expect(index.links[0]!.objects).toEqual([])
    expect(index.links[0]!.unresolved[0]!.reason).toContain('须用 term')
  })

  it('同名条目必须用 termOccurrence 消歧，越界与未命中都报告', () => {
    const ambiguous = resolve(linkFile([{ kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '术语表'], term: '心情落差' }]))
    expect(ambiguous.links[0]!.objects).toEqual([])
    expect(ambiguous.links[0]!.unresolved[0]!.reason).toContain('termOccurrence')

    const second = resolve(linkFile([
      { kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '术语表'], term: '心情落差', termOccurrence: 2 },
    ]))
    expect(second.issues).toEqual([])
    expect(second.links[0]!.objects[0]).toMatchObject({ definition: '- **心情落差**：定义乙。', termOccurrence: 2 })

    const outOfRange = resolve(linkFile([
      { kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '术语表'], term: '心情落差', termOccurrence: 3 },
    ]))
    expect(outOfRange.links[0]!.objects).toEqual([])
    expect(outOfRange.links[0]!.unresolved[0]!.reason).toContain('超出同名条目数')

    const missing = resolve(linkFile([{ kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '术语表'], term: '不存在的条目' }]))
    expect(missing.links[0]!.unresolved[0]!.reason).toContain('概念条目未找到')
  })

  it('宽章节与空正文不冒充单概念；白名单外文件被拒绝', () => {
    const wide = resolve(linkFile([{ kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '甲节'] }]))
    expect(wide.links[0]!.unresolved[0]!.reason).toContain('含有下级标题')

    const outside = resolve(linkFile([{ kind: 'concept', file: 'raw/技能-制造站.md', headingPath: ['技能-制造站'] }]))
    expect(outside.links[0]!.unresolved[0]!.reason).toContain('白名单')
  })
})

describe('prose-links：小节定位与机械检查', () => {
  it('概念文档根不能用非 1 出现序号，也不能把整篇宽文档作为无名概念', () => {
    const ref = { kind: 'concept' as const, file: 'guides/示例.md', headingPath: [] }
    expect(() => parseProseLinkFile(linkFile([{ ...ref, occurrence: 2 }]))).toThrowError('出现序号只能为 1')
    const index = resolve(linkFile([ref]))
    expect(index.links[0]!.objects).toEqual([])
    expect(index.issues.join('\n')).toContain('概念')
  })

  it('概念文档根的直接正文截止首个标题，不能跨入标题命中条目', () => {
    const ref = { kind: 'concept' as const, file: 'guides/示例.md', headingPath: [], term: '共享词' }
    const index = resolve(linkFile([ref]))
    expect(index.links[0]!.objects).toEqual([])
    expect(index.issues.join('\n')).toContain('概念条目未找到')
  })

  it.each(['- 相邻说明', '+ 相邻说明', '* 相邻说明', '1. 相邻说明'])('概念定义在同级普通列表 %s 前截断', (nextItem) => {
    writeFileSync(join(corpusDir, 'guides', '示例.md'), [
      '- **前言词**：前言定义。', '', '# 示例', '', '## 术语表', '',
      '- **目标词**：目标定义。', '  补充定义。', '  - 嵌套说明。', nextItem, '无关内容。', '',
    ].join('\n'), 'utf-8')
    directory = buildSectionDirectory(corpusDir)
    const index = resolve(linkFile([
      { kind: 'concept', file: 'guides/示例.md', headingPath: [], term: '前言词' },
      { kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '术语表'], term: '目标词' },
    ], ['示例', '术语表']))
    expect(index.issues).toEqual([])
    expect(index.links[0]!.objects[0]).toMatchObject({ definition: '- **前言词**：前言定义。', startLine: 1, endLine: 1 })
    expect(index.links[0]!.objects[1]).toMatchObject({
      definition: '- **目标词**：目标定义。\n  补充定义。\n  - 嵌套说明。', startLine: 7, endLine: 9,
    })
  })

  it('未找到小节时报告并跳过', () => {
    const index = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }], ['示例', '不存在的节']))
    expect(index.links).toEqual([])
    expect(index.issues.join('\n')).toContain('未找到小节')
  })

  it('文档根用空标题路径定位文档范围，出现序号只能为 1', () => {
    const index = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }], []))
    expect(index.issues).toEqual([])
    expect(index.links[0]!.sectionId).toBe(`doc:示例.md`)
    expect(index.links[0]!.documentRoot).toBe(true)
    expect(index.links[0]!.headingPath).toEqual([])

    expect(() => parseProseLinkFile({
      version: 2,
      links: [{ file: 'guides/示例.md', headingPath: [], occurrence: 2, scope: 'section', objects: [] }],
    })).toThrowError('出现序号只能为 1')
  })

  it('同路径重复标题必须用 occurrence 消歧，错误 occurrence 也报告', () => {
    const ambiguous = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }], ['示例', '重复']))
    expect(ambiguous.links).toEqual([])
    expect(ambiguous.issues.join('\n')).toContain('occurrence')

    const second = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }], ['示例', '重复'], { occurrence: 2 }))
    expect(second.issues).toEqual([])
    expect(second.links[0]!.occurrence).toBe(2)
    expect(second.links[0]!.objects).toEqual([{ kind: 'card', ref: 'operator:干员甲', canonical: '干员甲' }])

    const wrong = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }], ['示例', '重复'], { occurrence: 3 }))
    expect(wrong.issues.join('\n')).toContain('occurrence')
  })

  it('同一小节重复登记报告错误，只保留首条', () => {
    const file: ProseLinkFile = {
      version: 2,
      links: [
        { file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'section', objects: [{ kind: 'operator', canonical: '干员甲' }] },
        { file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'section', objects: [{ kind: 'operator', canonical: '干员乙' }] },
      ],
    }
    const index = resolveProseLinks({ file, directory, facts: factsFixture() })
    expect(index.links).toHaveLength(1)
    expect(index.issues.join('\n')).toContain('重复登记')
  })

  it('输出按小节原文顺序稳定排列', () => {
    const file: ProseLinkFile = {
      version: 2,
      links: [
        { file: 'guides/示例.md', headingPath: ['示例', '乙节'], scope: 'section', objects: [{ kind: 'operator', canonical: '干员甲' }] },
        { file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'section', objects: [{ kind: 'operator', canonical: '干员乙' }] },
      ],
    }
    const index = resolveProseLinks({ file, directory, facts: factsFixture() })
    expect(index.links.map((link) => link.headingPath.join(' > '))).toEqual(['示例 > 甲节', '示例 > 乙节'])
  })
})

describe('prose-links：格式校验', () => {
  it.each(['顶层', '条目', '对象'])('%s 的空字符串字段名也必须拒绝', (level) => {
    const file = linkFile([{ kind: 'operator', canonical: '干员甲' }])
    const target = level === '顶层' ? file : level === '条目' ? file.links[0]! : file.links[0]!.objects[0]!
    Object.assign(target, { '': true })
    expect(() => parseProseLinkFile(file)).toThrowError('未登记字段')
  })

  it('拒绝 v1 文件并提示迁移', () => {
    expect(() => parseProseLinkFile({ version: 1, links: [] })).toThrowError('迁移')
  })

  it('scope 必填且取值受限', () => {
    expect(() => parseProseLinkFile({
      version: 2,
      links: [{ file: 'guides/示例.md', headingPath: ['示例', '甲节'], objects: [] }],
    })).toThrowError('scope')
    expect(() => parseProseLinkFile({
      version: 2,
      links: [{ file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'node', objects: [] }],
    })).toThrowError('section 或 subtree')
  })

  it('顶层、条目与对象引用的未知字段都报错', () => {
    expect(() => parseProseLinkFile({ version: 2, links: [], extra: true })).toThrowError('未登记字段')
    expect(() => parseProseLinkFile({
      version: 2,
      links: [{ file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'section', objects: [], extra: true }],
    })).toThrowError('未登记字段')
    expect(() => parseProseLinkFile({
      version: 2,
      links: [{ file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'section', objects: [{ kind: 'operator', canonical: '干员甲', extra: true }] }],
    })).toThrowError('未登记字段')
  })

  it('文件路径拒绝绝对路径、反斜杠、空段与 ..；标题路径不含 #', () => {
    const withFile = (file: string) => parseProseLinkFile({
      version: 2,
      links: [{ file, headingPath: ['示例', '甲节'], scope: 'section', objects: [] }],
    })
    expect(() => withFile('C:/knowledge/guides/示例.md')).toThrowError('相对路径')
    expect(() => withFile('/guides/示例.md')).toThrowError('相对路径')
    expect(() => withFile('guides\\示例.md')).toThrowError('正斜杠')
    expect(() => withFile('guides//示例.md')).toThrowError('空段')
    expect(() => withFile('guides/../示例.md')).toThrowError('空段')
    expect(() => parseProseLinkFile({
      version: 2,
      links: [{ file: 'guides/示例.md', headingPath: ['#示例'], scope: 'section', objects: [] }],
    })).toThrowError('不能包含 #')
  })

  it('缺 term 时不允许填 termOccurrence', () => {
    expect(() => parseProseLinkFile({
      version: 2,
      links: [{
        file: 'guides/示例.md',
        headingPath: ['示例', '术语表'],
        scope: 'section',
        objects: [{ kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '术语表'], termOccurrence: 2 }],
      }],
    })).toThrowError('termOccurrence')
  })
})

describe('prose-links：读取范围合并', () => {
  it('损坏索引须显式失败，不能返回空关联或错位来源下标', () => {
    const index = resolve(linkFile([
      { kind: 'operator', canonical: '不存在的干员' },
      { kind: 'operator', canonical: '干员甲' },
    ]))
    expect(() => readObjectsFor(sectionId('甲节'), directory, index)).toThrowError('关联元数据')
    expect(() => readObjectsFor(sectionId('甲节'), directory, { ...index, issues: [] })).toThrowError('名册')
  })

  it('读取范围收集自身子树登记，不继承祖先的 section 作用域', () => {
    const index = resolve({
      version: 2,
      links: [
        { file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'section', objects: [{ kind: 'operator', canonical: '干员甲' }] },
        { file: 'guides/示例.md', headingPath: ['示例', '甲节', '甲节子节'], scope: 'section', objects: [{ kind: 'operator', canonical: '干员乙' }] },
      ],
    })
    expect(index.issues).toEqual([])

    const parentRead = readObjectsFor(sectionId('甲节'), directory, index)
    expect(parentRead.map((object) => object.kind === 'card' ? object.canonical : object.concept.name)).toEqual(['干员甲', '干员乙'])

    const childRead = readObjectsFor(sectionId('甲节子节'), directory, index)
    expect(childRead.map((object) => object.kind === 'card' ? object.canonical : object.concept.name)).toEqual(['干员乙'])
  })

  it('祖先的 subtree 登记会继承到后代，文档根按逻辑祖先参与继承', () => {
    const index = resolve({
      version: 2,
      links: [
        { file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'subtree', objects: [{ kind: 'operator', canonical: '干员甲' }] },
        { file: 'guides/示例.md', headingPath: [], scope: 'subtree', objects: [{ kind: 'operator', canonical: '干员乙' }] },
      ],
    })
    expect(index.issues).toEqual([])
    expect(readObjectsFor(sectionId('甲节子节'), directory, index).map((object) => object.kind === 'card' ? object.canonical : ''))
      .toEqual(['干员乙', '干员甲'])

    const docRead = readObjectsFor('doc:示例.md', directory, index)
    expect(docRead.map((object) => object.kind === 'card' ? object.canonical : '')).toEqual(['干员乙', '干员甲'])

    const siblingRead = readObjectsFor(sectionId('乙节'), directory, index)
    expect(siblingRead.map((object) => object.kind === 'card' ? object.canonical : '')).toEqual(['干员乙'])
  })

  it('同卡合并保留全部来源，完整卡覆盖技能投影', () => {
    const index = resolve({
      version: 2,
      links: [
        {
          file: 'guides/示例.md',
          headingPath: ['示例', '甲节'],
          scope: 'subtree',
          objects: [{ kind: 'skill', operator: '干员甲', room: '办公室', name: '升级技能' }],
        },
        {
          file: 'guides/示例.md',
          headingPath: ['示例', '甲节', '甲节子节'],
          scope: 'section',
          objects: [{ kind: 'operator', canonical: '干员甲' }],
        },
      ],
    })
    expect(index.issues).toEqual([])

    const objects = readObjectsFor(sectionId('甲节子节'), directory, index)
    expect(objects).toHaveLength(1)
    const card = objects[0]!
    expect(card).toMatchObject({ kind: 'card', canonical: '干员甲', projection: 'full', explicitGrantIds: ['g-升'] })
    expect(card.origins).toEqual([
      { sectionId: sectionId('甲节'), objectIndex: 0 },
      { sectionId: sectionId('甲节子节'), objectIndex: 0 },
    ])
  })

  it('概念按精确来源位置去重并保留来源', () => {
    const conceptRef = { kind: 'concept' as const, file: 'guides/示例.md', headingPath: ['示例', '术语表'], term: '共享词' }
    const index = resolve({
      version: 2,
      links: [
        { file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'subtree', objects: [conceptRef] },
        { file: 'guides/示例.md', headingPath: ['示例', '甲节', '甲节子节'], scope: 'section', objects: [conceptRef] },
      ],
    })
    expect(index.issues).toEqual([])

    const objects = readObjectsFor(sectionId('甲节子节'), directory, index)
    expect(objects).toHaveLength(1)
    expect(objects[0]).toMatchObject({ kind: 'concept' })
    expect(objects[0]!.origins).toEqual([
      { sectionId: sectionId('甲节'), objectIndex: 0 },
      { sectionId: sectionId('甲节子节'), objectIndex: 0 },
    ])
  })
})

describe('prose-links：旁挂文件读取', () => {
  it.each([
    ['失效定位', linkFile([], ['示例', '不存在的节'])],
    ['失效对象', linkFile([{ kind: 'operator', canonical: '不存在的干员' }])],
    ['重复引用', linkFile([
      { kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '乙节'] },
      { kind: 'concept', file: 'guides/示例.md', headingPath: ['示例', '乙节'] },
    ])],
  ])('%s 必须在真实装配入口失败', (_label, file) => {
    writeFileSync(join(corpusDir, 'prose-links.json'), JSON.stringify(file), 'utf-8')
    expect(() => buildProseLinkIndex({ root: process.cwd(), corpusDir })).toThrowError('关联元数据')
  })

  it('缺失文件表示无标注，空关联合法', () => {
    expect(loadProseLinkFile(corpusDir)).toEqual({ version: 2, links: [] })
  })

  it('非法 JSON 或结构时报中文错误并指明文件', () => {
    writeFileSync(join(corpusDir, 'prose-links.json'), '{ 不是 JSON', 'utf-8')
    expect(() => loadProseLinkFile(corpusDir)).toThrowError('prose-links.json')

    writeFileSync(join(corpusDir, 'prose-links.json'), JSON.stringify({ version: 2, links: [{ file: '', headingPath: [], scope: 'section', objects: [] }] }), 'utf-8')
    expect(() => loadProseLinkFile(corpusDir)).toThrowError('file')

    writeFileSync(join(corpusDir, 'prose-links.json'), JSON.stringify({ version: 2, links: [{ file: 'guides/示例.md', headingPath: ['示例', '甲节'], scope: 'section', objects: [{ kind: 'operator' }] }] }), 'utf-8')
    expect(() => loadProseLinkFile(corpusDir)).toThrowError('canonical')
  })
})

describe('prose-links：运行快照注入', () => {
  it('装配复用注入的 sections/facts 快照，不回落到重新读盘', () => {
    writeFileSync(join(corpusDir, 'prose-links.json'), JSON.stringify(linkFile([{ kind: 'operator', canonical: '干员甲' }])), 'utf-8')

    // 注入的 facts 缺名册干员：按注入快照报错，而不是读盘取到完整名册。
    expect(() => buildProseLinkIndex({
      root: process.cwd(),
      corpusDir,
      directory,
      facts: { ...factsFixture(), operators: [] },
    })).toThrowError('关联干员不在名册')

    // 注入的小节目录不含目标小节：同样按注入快照报错。
    const otherRoot = join(root, 'other')
    mkdirSync(join(otherRoot, 'base'), { recursive: true })
    writeFileSync(join(otherRoot, 'base', '其它.md'), '# 其它\n\n## 其它节\n\n正文。\n', 'utf-8')
    writeFileSync(join(otherRoot, 'corpus-manifest.json'), JSON.stringify({ files: ['base/其它.md'] }), 'utf-8')
    expect(() => buildProseLinkIndex({
      root: process.cwd(),
      corpusDir,
      directory: buildSectionDirectory(otherRoot),
      facts: factsFixture(),
    })).toThrowError('未找到小节')

    const index = buildProseLinkIndex({ root: process.cwd(), corpusDir, directory, facts: factsFixture() })
    expect(index.links[0]!.sectionId).toBe(sectionId('甲节'))
  })

  it('facts 提供者惰性取用运行级快照，直接返回时不再自行读盘', () => {
    writeFileSync(join(corpusDir, 'prose-links.json'), JSON.stringify(linkFile([{ kind: 'operator', canonical: '干员甲' }])), 'utf-8')

    let provided = 0
    const index = buildProseLinkIndex({
      root: process.cwd(),
      corpusDir,
      directory,
      facts: () => {
        provided += 1
        return factsFixture()
      },
    })

    expect(provided).toBe(1)
    expect(index.links[0]!.sectionId).toBe(sectionId('甲节'))
  })
})

describe('prose-links：真实语料核对', () => {
  // 依据组合正文与 raw 真源核对职责、启动候选与代价；并存技能不会沿替换链自动进入精确投影。
  it.each([
    ['水月标准化组：技能成员条件与中枢分工', ['水月｜意识协议', '香草｜标准化·β', '杰西卡｜标准化·β', '史都华德｜标准化·β', '海沫｜标准化·β', '海沫｜意识兼容', '罗比菈塔｜标准化·β', '调香师｜标准化·β', '杏仁｜小奇思', '杏仁｜挑大梁', '焰尾｜红松的骑士', '薇薇安娜｜烛骑士微光']],
    ['红云组：仓库容量转化与成员分支', ['红云｜拾荒者', 'Miss.Christine｜午休好去处', '稀音｜剪辑·α', '帕拉斯｜智慧之境', '刻俄柏｜“都想要”', '娜仁图亚｜齐心沙盗']],
    ['怒潮凛冬：经验散件与指定队友条件', ['怒潮凛冬｜情同手足', '烈夏｜患难拍档', '古米｜交际']],
    ['感知信息组：资源用途与跨设施分工', ['迷迭香｜超感', '黑键｜乐感', '絮雨｜巡游', '爱丽丝｜睡前故事', '车尔尼｜慢板行歌', '塑心｜无声共鸣', '塑心｜无词颂歌', '琴柳｜感染力', '琴柳｜维多利亚文学']],
    ['龙舌兰组：效率归零、裁缝概率与订单报酬', ['柏喙｜裁缝·β', '明椒｜裁缝·β', '折光｜鉴定师的手段', '卡夫卡｜手工艺品·β']],
    ['鸿雪杜林组：贸易核心与杜林挂件', ['鸿雪｜销路宣发']],
    ['赤金工艺组：同站技能成员与贵金属配方', ['苍苔｜金属工艺·α', '引星棘刺｜金属工艺·α', '砾｜金属工艺·β', '斑点｜金属工艺·α', '夜烟｜金属工艺·α', '温米｜金属工艺·α']],
    ['莱茵科技：制造技能协作与阵营计数边界', ['娜斯提｜莱茵科技·β']],
    ['喀兰贸易组：跨设施协作与订单上限适配', ['孑｜摊贩经济']],
    ['泡泡组：同站核心与仓库容量转化', ['泡泡｜囤积者', '贝娜｜“可靠”助手']],
    ['自动化组：第三人、发电站协作与归零范围', ['森蚺｜我寻思能行']],
    ['深海猎人组：中枢协作、制造席位与心情代价', ['歌蕾蒂娅｜潮汐守望']],
    ['贸易散件的工作人数、会客室与宿舍条件', ['吉星｜勤俭经营·β', '伺夜｜新城贸易', '空弦｜虔诚筹款·β']],
    ['赤金散件的暖机、技能成员与贸易站数量条件', ['阿罗玛｜净味香氛', '阿罗玛｜例行清扫', '苍苔｜金属工艺·α', '苍苔｜打工心得', '清流｜再生能源']],
    ['通用制造散件的他人生产力与工程机器人条件', ['槐琥｜配合意识', '至简｜绘图设计', '至简｜机械辅助·β']],
    ['经验散件的生产力、心情代价与队友条件', ['食铁兽｜拳术指导录像', '弑君者｜逆境荣光', '裂响｜“连轴转”', '酒神｜戏中人', '怒潮凛冬｜情同手足']],
    ['格拉斯哥帮组：同站成员计数与中枢协作', ['维娜·维多利亚｜外贸决议·β']],
    ['怪猎中枢：木天蓼分工、练度与缺人后的剩余效果', ['火龙S黑角｜团队合作', '火龙S黑角｜秘传交涉术', '麒麟R夜刀｜耐力回复', '麒麟R夜刀｜以身作则', '泰拉大陆调查团｜可爱的艾露猫', '泰拉大陆调查团｜可靠的随从们']],
    ['彩虹小队：中枢心情恢复与成员计数', ['灰烬｜彩虹小队', '战车｜彩虹小队', '闪击｜彩虹小队', '霜华｜彩虹小队', '艾拉｜反抗者']],
    ['Mujica 中枢组：热情值、贸易与赤金加成', ['丰川祥子｜丰富工作经验', '若叶睦｜演技的怪物', '三角初华｜偶像光环', '八幡海铃｜可靠伙伴', '祐天寺若麦｜勤学苦练']],
    ['维什戴尔组：巴别塔系心情恢复与订单上限', ['维什戴尔｜同谋·β', '维什戴尔｜巴别塔之帜', '魔王｜“未完的故事”', '阿米娅｜合作协议', '赫德雷｜白手起家·β', '伊内丝｜聚影']],
    ['魔物料理体系：宿舍等级资源链与三个消费端', ['森西｜森西大食堂', '森西｜资深料理人', '玛露西尔｜差遣使魔·β', '莱欧斯｜好奇心', '齐尔查克｜半身人公会代表']],
    ['新约能天使组：拉特兰计数与第三席', ['新约能天使｜同城加急单', '蕾缪安｜相伴', '空弦｜虔诚筹款·β', '安比尔｜订单分发·β', '能天使｜物流专家']],
    ['泡影国狩猎小队：双核心效率与订单上限', ['焰狐龙梓兰｜队长的自觉', '雷狼龙S空爆｜气氛组']],
    ['能天使组：双核心同站与成员边界', ['能天使｜物流专家', '蕾缪安｜相伴', '新约能天使｜同城加急单', '吉星｜勤俭经营·β']],
    ['凯尔希·思衡托与精英干员挂件：办公室联络与设施计数', ['凯尔希·思衡托｜“泰拉的方舟”', '真言｜精英小队', '电弧｜无言的慈爱']],
    ['人间烟火组：跨设施资源链与贸易用途', ['乌有｜“愿者上钩”', '重岳｜孤光共照', '桑葚｜救援队·灾后普查', '截云｜问枯荣', '黍｜稻禾厚，顺秋收', '余｜与人乐', '赤刃明霄陈｜扶危行侠']],
    ['莱茵生命阵营：制造与发电双终端与阵营计数', ['娜斯提｜造价高昂', '缪尔赛思｜生态科主任', '塞雷娅｜守望者']],
    ['队列轮换：手动编辑、批量切换与干员休整', ['菲亚梅塔｜患难之交']],
    ['定时换班：两班轮流、错班轮换与班制选择', ['菲亚梅塔｜自律', '菲亚梅塔｜患难之交']],
    ['动态换班：心情阈值与按组换人', ['森蚺｜我寻思能行', '承曦格雷伊｜晨曦', '阿罗玛｜例行清扫', '伊内丝｜聚影', '菲亚梅塔｜自律', '菲亚梅塔｜患难之交']],
    ['二发电与三发电的取舍', ['但书｜合同法', '但书｜违约索赔·β']],
    ['搓玉期：342 或 333', ['但书｜合同法', '但书｜违约索赔·β', '龙舌兰｜投资·β', '清流｜再生能源', '温蒂｜仿生海龙']],
    ['加速贸易站的优先级', ['但书｜合同法', '但书｜违约索赔·β', '龙舌兰｜投资·β', '可露希尔｜特别订单', '柏喙｜裁缝·β', '明椒｜裁缝·β', '折光｜鉴定师的手段', '卡夫卡｜手工艺品·β', '巫恋｜裁缝·α']],
  ])('%s 的关联投影保留正文实际依赖的技能', (heading, requiredSkills) => {
    const directory = buildSectionDirectory(join(process.cwd(), 'knowledge'))
    const index = buildProseLinkIndex({ root: process.cwd() })
    const link = index.links.find((candidate) => candidate.headingPath.at(-1) === heading)
    expect(link, `未找到标注小节：${heading}`).toBeTruthy()
    const store = getCardStore()
    const projectedSkills = readObjectsFor(link!.sectionId, directory, index).flatMap((object) => {
      if (object.kind !== 'card') return []
      expect(object.projection).toBe('skills')
      const card = store.byCanonical.get(object.canonical)!
      return skillProjection(card, object.explicitGrantIds).skills.map((skill) => `${card.canonical}｜${skill.name}`)
    })
    expect(projectedSkills).toEqual(expect.arrayContaining(requiredSkills))
  })

  it('深海猎人组分别定位两档加成，只关联已确认的叠加规则', () => {
    const directory = buildSectionDirectory(join(process.cwd(), 'knowledge'))
    const index = buildProseLinkIndex({ root: process.cwd() })
    const link = index.links.find((candidate) => candidate.headingPath.at(-1) === '深海猎人组：中枢协作、制造席位与心情代价')!
    const concepts = readObjectsFor(link.sectionId, directory, index)
      .flatMap((object) => object.kind === 'concept' ? [object.concept] : [])
    const bonuses = concepts.filter((concept) => concept.term === '特殊加成')
    expect(bonuses.map((concept) => concept.termOccurrence)).toEqual([1, 2])
    expect(bonuses[0]!.definition).toContain('提供5%生产力，最多给单个制造站提供45%生产力')
    expect(bonuses[1]!.definition).toContain('提供10%生产力，最多给单个制造站提供90%生产力')
    const stacking = concepts.filter((concept) => concept.term === '特殊叠加规则')
    // 固定解包 cc.c.abyssal2_3 对应第一条规则，第二条属于其他机制。
    expect(stacking.map((concept) => concept.termOccurrence)).toEqual([1])
    expect(stacking[0]!.definition).toContain('无法与配合意识进行叠加')
    const seats = concepts.find((concept) => concept.name === '制造站等级对应的工位、仓库容量与耗电')!
    expect(seats.file).toBe('base/设施/机制-制造站.md')
    expect(seats.definition).toContain('进驻人员上限')
  })

  it('knowledge/prose-links.json 机械检查零问题且目标小节可解析', () => {
    const index = buildProseLinkIndex({ root: process.cwd() })

    expect(index.issues).toEqual([])
    const headings = index.links.map((link) => `${link.file}#${link.headingPath.join(' > ')}`)
    expect(headings).toContain('guides/用人/高效率散件.md#高效率散件 > 办公室联络散件')
    expect(headings).toContain('guides/用人/高效率散件.md#高效率散件 > 办公室联络散件 > 联络速度与额外心情消耗的取舍')
    expect(headings).toContain('guides/用人/高效率散件.md#高效率散件 > 源石碎片制造（搓玉）的名单、练度与布局前提')
    expect(headings).toContain('guides/布局/布局选择.md#布局选择 > 按需求推荐 > 搓玉期：342 或 333')
    expect(headings).toContain('guides/操作/无人机使用.md#无人机使用 > 加速贸易站的优先级')
    for (const link of index.links) {
      expect(link.objects.length, `${link.sectionId} 的关联对象为空`).toBeGreaterThan(0)
      for (const object of link.objects) {
        // 卡片与概念都可以登记；概念必须解析出名称与定义原文，卡片必须有非空 canonical。
        if (object.kind === 'card') {
          expect(object.canonical.trim()).not.toBe('')
        } else {
          expect(object.name.trim()).not.toBe('')
          expect(object.definition.trim()).not.toBe('')
        }
      }
    }
    const replacement = index.links
      .flatMap((link) => link.objects)
      .find((object) => object.kind === 'card' && object.grantId !== undefined)
    expect(replacement).toBeTruthy()
  })

  it('办公室各用途小节只展开本节候选', () => {
    const index = buildProseLinkIndex({ root: process.cwd() })
    const canonicalsOf = (path: string): string[] => {
      const link = index.links.find((candidate) => candidate.headingPath.join(' > ') === path)
      expect(link, `未找到标注小节：${path}`).toBeTruthy()
      expect(link!.scope).toBe('section')
      return link!.objects.flatMap((object) => (object.kind === 'card' ? [object.canonical] : []))
    }

    const office = canonicalsOf('高效率散件 > 办公室联络散件')
    expect(office).toEqual(expect.arrayContaining(['珊比', '艾雅法拉', '遥', '普罗旺斯']))
    expect(office).not.toContain('斥罪')
    for (const [heading, expected] of [
      ['联络速度与额外心情消耗的取舍', ['斥罪', '水灯心', '地灵']],
      ['精英干员设施计数与联络加成', ['凯尔希·思衡托']],
      ['絮雨的记忆碎片与感知信息转换', ['絮雨']],
      ['焰狐龙梓兰的中枢岗位与办公室加成', ['焰狐龙梓兰']],
    ] as const) {
      const actual = canonicalsOf(`高效率散件 > 办公室联络散件 > ${heading}`)
      expect([...new Set(actual)].sort()).toEqual([...expected].sort())
    }
  })
})
