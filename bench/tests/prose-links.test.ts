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
  '## 乙节',
  '',
  '乙节正文。',
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

function linkFile(objects: ProseLinkFile['links'][number]['objects'], headingPath = ['示例', '甲节'], extra: Partial<ProseLinkFile['links'][number]> = {}): ProseLinkFile {
  return { version: 1, links: [{ file: 'guides/示例.md', headingPath, objects, ...extra }] }
}

function resolve(file: ProseLinkFile) {
  return resolveProseLinks({ file, directory, facts: factsFixture() })
}

describe('prose-links：可读引用解析', () => {
  it('干员引用解析为 operator:<canonical>，保留可读锚点', () => {
    const index = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }]))

    expect(index.issues).toEqual([])
    const link = index.links[0]!
    expect(link.sectionId).toBe(directory.sections.find((section) => section.heading === '甲节')!.sectionId)
    expect(link.headingPath).toEqual(['示例', '甲节'])
    expect(link.objects).toEqual([{ ref: 'operator:干员甲', canonical: '干员甲' }])
    expect(index.bySection.get(link.sectionId)).toBe(link)
  })

  it('技能引用解析到当前 skill/grant 内部 ID，并保留替换目标', () => {
    const index = resolve(linkFile([{ kind: 'skill', operator: '干员甲', room: '办公室', name: '升级技能' }]))

    expect(index.issues).toEqual([])
    expect(index.links[0]!.objects).toEqual([
      { ref: '办公室｜「升级技能」｜干员甲', canonical: '干员甲', grantId: 'g-升', skillId: 's-升' },
    ])
  })

  it('同设施技能名歧义时报告错误，补充 unlock 后可唯一解析', () => {
    const ambiguous = resolve(linkFile([{ kind: 'skill', operator: '干员甲', room: '办公室', name: '歧义技能' }]))
    expect(ambiguous.links[0]!.objects).toEqual([])
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

    expect(index.links[0]!.objects).toEqual([{ ref: 'operator:干员甲', canonical: '干员甲' }])
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
})

describe('prose-links：小节定位与机械检查', () => {
  it('未找到小节时报告并跳过', () => {
    const index = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }], ['示例', '不存在的节']))
    expect(index.links).toEqual([])
    expect(index.issues.join('\n')).toContain('未找到小节')
  })

  it('同路径重复标题必须用 occurrence 消歧，错误 occurrence 也报告', () => {
    const ambiguous = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }], ['示例', '重复']))
    expect(ambiguous.links).toEqual([])
    expect(ambiguous.issues.join('\n')).toContain('occurrence')

    const second = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }], ['示例', '重复'], { occurrence: 2 }))
    expect(second.issues).toEqual([])
    expect(second.links[0]!.occurrence).toBe(2)
    expect(second.links[0]!.objects).toEqual([{ ref: 'operator:干员甲', canonical: '干员甲' }])

    const wrong = resolve(linkFile([{ kind: 'operator', canonical: '干员甲' }], ['示例', '重复'], { occurrence: 3 }))
    expect(wrong.issues.join('\n')).toContain('occurrence')
  })

  it('同一小节重复登记报告错误，只保留首条', () => {
    const file: ProseLinkFile = {
      version: 1,
      links: [
        { file: 'guides/示例.md', headingPath: ['示例', '甲节'], objects: [{ kind: 'operator', canonical: '干员甲' }] },
        { file: 'guides/示例.md', headingPath: ['示例', '甲节'], objects: [{ kind: 'operator', canonical: '干员乙' }] },
      ],
    }
    const index = resolveProseLinks({ file, directory, facts: factsFixture() })
    expect(index.links).toHaveLength(1)
    expect(index.issues.join('\n')).toContain('重复登记')
  })

  it('输出按小节原文顺序稳定排列', () => {
    const file: ProseLinkFile = {
      version: 1,
      links: [
        { file: 'guides/示例.md', headingPath: ['示例', '乙节'], objects: [{ kind: 'operator', canonical: '干员甲' }] },
        { file: 'guides/示例.md', headingPath: ['示例', '甲节'], objects: [{ kind: 'operator', canonical: '干员乙' }] },
      ],
    }
    const index = resolveProseLinks({ file, directory, facts: factsFixture() })
    expect(index.links.map((link) => link.headingPath.join(' > '))).toEqual(['示例 > 甲节', '示例 > 乙节'])
  })
})

describe('prose-links：旁挂文件读取', () => {
  it('缺失文件表示无标注，空关联合法', () => {
    expect(loadProseLinkFile(corpusDir)).toEqual({ version: 1, links: [] })
  })

  it('非法 JSON 或结构时报中文错误并指明文件', () => {
    writeFileSync(join(corpusDir, 'prose-links.json'), '{ 不是 JSON', 'utf-8')
    expect(() => loadProseLinkFile(corpusDir)).toThrowError('prose-links.json')

    writeFileSync(join(corpusDir, 'prose-links.json'), JSON.stringify({ version: 1, links: [{ file: '', headingPath: [], objects: [] }] }), 'utf-8')
    expect(() => loadProseLinkFile(corpusDir)).toThrowError('file')

    writeFileSync(join(corpusDir, 'prose-links.json'), JSON.stringify({ version: 1, links: [{ file: 'guides/示例.md', headingPath: ['示例', '甲节'], objects: [{ kind: 'operator' }] }] }), 'utf-8')
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
      for (const object of link.objects) expect(object.canonical.trim()).not.toBe('')
    }
    const replacement = index.links
      .flatMap((link) => link.objects)
      .find((object) => object.grantId === undefined ? false : true)
    expect(replacement?.grantId).toBeTruthy()
  })
})
