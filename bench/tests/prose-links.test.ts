import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OperatorSkillGrant, OperatorDefinition, SkillFact } from '../src/facts/normalized.js'
import type { ReferenceFacts } from '../src/facts/references.js'
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
    expect(index.links[0]!.sectionId).toBe(`doc:guides/示例.md`)
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

    const docRead = readObjectsFor('doc:guides/示例.md', directory, index)
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
    expect(() => buildProseLinkIndex(process.cwd(), corpusDir)).toThrowError('关联元数据')
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

describe('prose-links：真实语料核对', () => {
  it('knowledge/prose-links.json 机械检查零问题且目标小节可解析', () => {
    const index = buildProseLinkIndex(process.cwd())

    expect(index.issues).toEqual([])
    const headings = index.links.map((link) => `${link.file}#${link.headingPath.join(' > ')}`)
    expect(headings).toContain('guides/高效率散件.md#高效率散件 > 办公室联络散件')
    expect(headings).toContain('guides/高效率散件.md#高效率散件 > 源石碎片制造（搓玉）')
    for (const link of index.links) {
      expect(link.objects.length, `${link.sectionId} 的关联对象为空`).toBeGreaterThan(0)
      for (const object of link.objects) {
        expect(object.kind).toBe('card')
        if (object.kind === 'card') expect(object.canonical.trim()).not.toBe('')
      }
    }
    const replacement = index.links
      .flatMap((link) => link.objects)
      .find((object) => object.kind === 'card' && object.grantId !== undefined)
    expect(replacement).toBeTruthy()
  })
})
