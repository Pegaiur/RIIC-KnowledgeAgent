import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  collectFactCandidates,
  collectTermIssues,
  loadFactCatalog,
  parseOutline,
  parseSkillNames,
  scanSource,
} from '../../../tasks/knowledge/external-corpus-scan.mjs'

const TASK_PATH = fileURLToPath(new URL('../../../tasks/knowledge/external-corpus-scan.mjs', import.meta.url))

function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), 'rag-external-scan-'))
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeFile(root, relativePath, content) {
  const target = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
  return target
}

describe('parseOutline：外部稿大纲提取', () => {
  it.each(['```', '~~~'])('忽略 %s 围栏内的标题，闭合后继续保留真实行号', (fence) => {
    const text = ['# 实际标题', '', `${fence}markdown`, '# 代码示例', fence, '', '## 后续章节'].join('\n')
    expect(parseOutline(text)).toEqual([
      { level: 1, title: '实际标题', line: 1 },
      { level: 2, title: '后续章节', line: 7 },
    ])
  })

  it('较短或异类围栏不提前闭合代码区，未闭合区域不产生标题', () => {
    expect(parseOutline('# 实际标题\n````markdown\n```\n~~~\n# 代码示例\n')).toEqual([
      { level: 1, title: '实际标题', line: 1 },
    ])
  })

  it('按行号提取 1-3 级标题，忽略文件开头的 front-matter 与正文', () => {
    const text = [
      '---',
      'type: mechanism',
      '# 不是标题的注释行',
      '---',
      '# 加工站机制',
      '',
      '正文',
      '',
      '## 设施基础',
      '### 子节',
      '',
      '#### 四级标题不进大纲',
      '',
    ].join('\n')

    expect(parseOutline(text)).toEqual([
      { level: 1, title: '加工站机制', line: 5 },
      { level: 2, title: '设施基础', line: 9 },
      { level: 3, title: '子节', line: 10 },
    ])
  })

  it('正文中的 --- 分隔线不吞掉后续标题', () => {
    const text = [
      '# 加工站机制',
      '',
      '正文',
      '',
      '---',
      '',
      '## 设施基础',
      '### 子节',
      '',
    ].join('\n')

    expect(parseOutline(text)).toEqual([
      { level: 1, title: '加工站机制', line: 1 },
      { level: 2, title: '设施基础', line: 7 },
      { level: 3, title: '子节', line: 8 },
    ])
  })
})

describe('collectTermIssues：导入前术语预检', () => {
  it('报出禁词表的命中并给出规范写法', () => {
    const issues = collectTermIssues('本行写了生产效率与体力\n')
    expect(issues).toEqual([
      { line: 1, term: '生产效率', replacement: '生产力', kind: 'forbidden' },
      { line: 1, term: '体力', replacement: '心情', kind: 'forbidden' },
    ])
  })

  it('门禁已覆盖的写法按禁词报出，门禁漏掉的带空格写法作为导入期提示报出', () => {
    const issues = collectTermIssues('艾丽妮（精英 2 解锁）；逻各斯精 2 解锁\n')
    expect(issues).toEqual([
      { line: 1, term: '精英 2', replacement: '精零、精一或精二', kind: 'forbidden' },
      { line: 1, term: '精 2', replacement: '精零、精一或精二', kind: 'import-hint' },
    ])
  })

  it('无需改写的行不产生任何提示', () => {
    expect(collectTermIssues('进驻训练室单次协助一名干员训练时长达 5 小时。\n')).toEqual([])
  })
})

describe('parseSkillNames：facts 技能分片的技能名提取', () => {
  it('提取技能行中的所有「」名称，忽略公共说明与示例行', () => {
    const raw = [
      '<!-- 头部 -->',
      '',
      '# 加工站基建技能',
      '',
      '例：温蒂精 2 的「仿生海龙」是**提升**。',
      '',
      '## 按干员',
      '',
      '### 凯尔希 ☆6 · 医疗',
      '',
      '- **初始解锁**「未知技术」：进驻加工站加工任意类材料时，副产品的产出概率提升70%　〔标签：任意材料〕',
      '',
      '### 凯尔希·思衡托 ☆6 · 医疗',
      '',
      '- **精英 2 提升，替换「技术阐明」**「理论革新」：副产品的产出概率提升80%',
      '',
    ].join('\n')

    expect(parseSkillNames(raw)).toEqual(['未知技术', '技术阐明', '理论革新'])
  })
})

describe('collectFactCandidates：命中本地对象候选', () => {
  it('长名命中不重复算其内部短名，短名在别处独立出现时仍提示', () => {
    const candidates = collectFactCandidates('本次由斩业星熊进驻，另有星熊单独提及。\n', {
      rosterNames: ['星熊', '斩业星熊'],
    })

    expect(candidates).toEqual([
      { name: '斩业星熊', type: 'operator', line: 1, confidence: 'high', context: '本次由斩业星熊进驻，另有星熊单独提及。' },
      { name: '星熊', type: 'operator', line: 1, confidence: 'high', context: '本次由斩业星熊进驻，另有星熊单独提及。' },
    ])
  })

  it('单字 ASCII 名按词边界提示独立出现，嵌在其它词中不提示', () => {
    const candidates = collectFactCandidates('轮班由 W 接手，SW 与 Wi 不算。\n', {
      rosterNames: ['W'],
    })

    expect(candidates).toEqual([
      { name: 'W', type: 'operator', line: 1, confidence: 'low', context: '轮班由 W 接手，SW 与 Wi 不算。' },
    ])
  })

  it('中文单字名只在两侧都不是中日韩字符时提示，并标为低置信', () => {
    const candidates = collectFactCandidates('两名干员（令）、（夕）的名单；这一年的目标不变。\n', {
      rosterNames: ['令', '夕', '年'],
    })

    expect(candidates.map((item) => [item.name, item.confidence])).toEqual([
      ['令', 'low'],
      ['夕', 'low'],
    ])
  })

  it('候选带完整源行上下文，同一行同名只提示一次，行尾命中不截掉', () => {
    const longLine = `${'甲'.repeat(100)}未知技术，条件仍需满足。`
    const candidates = collectFactCandidates(`未知技术可以提升概率，未知技术再次出现。\n\n${longLine}\n`, {
      skillNames: ['未知技术'],
    })

    expect(candidates).toEqual([
      {
        name: '未知技术',
        type: 'skill',
        line: 1,
        confidence: 'high',
        context: '未知技术可以提升概率，未知技术再次出现。',
      },
      {
        name: '未知技术',
        type: 'skill',
        line: 3,
        confidence: 'high',
        context: longLine,
      },
    ])
  })

  it('空对照集返回空候选', () => {
    expect(collectFactCandidates('本行没有对象', { rosterNames: [], skillNames: [] })).toEqual([])
  })
})

describe('loadFactCatalog：facts 对照集读取', () => {
  it('读取名册标准名与指定设施分片的技能名', () => {
    withRoot((root) => {
      writeFile(root, 'knowledge/facts/名册.md', '# 干员名册\n\n- 凯尔希 | ☆6 | 医疗 | 加工站\n')
      writeFile(root, 'knowledge/facts/技能-加工站.md', '# 加工站基建技能\n\n- **初始解锁**「未知技术」：说明\n')

      expect(loadFactCatalog(root, ['加工站'])).toEqual({
        rosterNames: ['凯尔希'],
        skillNames: ['未知技术'],
      })
    })
  })

  it('名册缺失时报中文错误，不静默视为无命中', () => {
    withRoot((root) => {
      expect(() => loadFactCatalog(root, [])).toThrow(/名册不存在/)
    })
  })

  it('指定设施的分片缺失时报中文错误', () => {
    withRoot((root) => {
      writeFile(root, 'knowledge/facts/名册.md', '# 干员名册\n\n- 凯尔希 | ☆6 | 医疗 | 加工站\n')
      expect(() => loadFactCatalog(root, ['训练室'])).toThrow(/技能分片不存在/)
    })
  })
})

describe('scanSource：单文件预检结果组装', () => {
  it('组装大纲、术语问题与对象候选', () => {
    const result = scanSource({
      path: '外部/加工站机制.md',
      text: '# 加工站机制\n\n## 设施基础\n\n生产效率提升，凯尔希的未知技术。\n',
      rosterNames: ['凯尔希'],
      skillNames: ['未知技术'],
    })

    expect(result.path).toBe('外部/加工站机制.md')
    expect(result.outline).toEqual([
      { level: 1, title: '加工站机制', line: 1 },
      { level: 2, title: '设施基础', line: 3 },
    ])
    expect(result.termIssues).toEqual([
      { line: 5, term: '生产效率', replacement: '生产力', kind: 'forbidden' },
    ])
    expect(result.factCandidateGroups).toEqual([
      { line: 5, context: '生产效率提升，凯尔希的未知技术。', candidates: [
        { name: '凯尔希', type: 'operator', confidence: 'high' },
        { name: '未知技术', type: 'skill', confidence: 'high' },
      ] },
    ])
    expect(result).not.toHaveProperty('factCandidates')
  })

  it('长表格行按列名保留全部内容、单位与空值，同源行多个候选共享上下文', () => {
    const condition = `${'条件'.repeat(50)}，仅未知技术适用，不含白铁。`
    const result = scanSource({ path: '表格.md', text: [
      '| 对象 | 条件 | 数值 | 备注 |',
      '| --- | --- | ---: | --- |',
      `| 凯尔希       | ${condition}       | 5 小时 |   |`,
    ].join('\n'), rosterNames: ['凯尔希', '白铁'], skillNames: ['未知技术'] })
    expect(result.factCandidateGroups).toEqual([{
      line: 3,
      context: `对象：凯尔希；条件：${condition}；数值：5 小时；备注：（空）`,
      candidates: [
        { name: '凯尔希', type: 'operator', confidence: 'high' },
        { name: '未知技术', type: 'skill', confidence: 'high' },
        { name: '白铁', type: 'operator', confidence: 'high' },
      ],
    }])
  })

  it('转义竖线保留在单元格内，列数不齐的行保留原文', () => {
    const broken = '| 未知技术 | 缺少一列 | 多出一列 |'
    const result = scanSource({ path: '边界.md', text: [
      '| 条件 | 技能 |', '| --- | --- |',
      '| `甲\\|乙` | 未知技术 |', broken,
    ].join('\n'), skillNames: ['未知技术'] })
    expect(result.factCandidateGroups).toEqual([
      { line: 3, context: '条件：`甲\\|乙`；技能：未知技术', candidates: [{ name: '未知技术', type: 'skill', confidence: 'high' }] },
      { line: 4, context: broken, candidates: [{ name: '未知技术', type: 'skill', confidence: 'high' }] },
    ])
  })

  it('代码围栏中的伪表格保留原文，不投影字段', () => {
    const row = '| 未知技术 | 5 小时 |'
    const result = scanSource({ path: '代码.md', text: [
      '```text', '| 技能 | 条件 |', '| --- | --- |', row, '```',
    ].join('\n'), skillNames: ['未知技术'] })
    expect(result.factCandidateGroups[0]).toEqual({ line: 4, context: row, candidates: [{ name: '未知技术', type: 'skill', confidence: 'high' }] })
  })

  it.each([
    ['列表内围栏', ['- 示例', '', '    ```text', '    | 技能 | 条件 |', '    | --- | --- |', '    | 未知技术 | 5 小时 |', '    ```']],
    ['缩进代码', ['    | 技能 | 条件 |', '    | --- | --- |', '    | 未知技术 | 5 小时 |']],
    ['制表符缩进代码', ['\t| 技能 | 条件 |', '\t| --- | --- |', '\t| 未知技术 | 5 小时 |']],
  ])('%s 中的表格保留原行及缩进，后续正常表格仍可投影', (_label, codeLines) => {
    const rowIndex = codeLines.findIndex((line) => line.includes('未知技术'))
    const result = scanSource({ path: '代码边界.md', text: [...codeLines, '', '| 技能 | 条件 |', '| --- | --- |', '| 未知技术 | 6 小时 |'].join('\n'), skillNames: ['未知技术'] })
    expect(result.factCandidateGroups.map(({ line, context }) => ({ line, context }))).toEqual([
      { line: rowIndex + 1, context: codeLines[rowIndex] },
      { line: codeLines.length + 4, context: '技能：未知技术；条件：6 小时' },
    ])
  })
})

describe('external-corpus-scan CLI', () => {
  it.each([
    ['未知选项', ['--bad']],
    ['缺少选项值', ['--source']],
    ['意外位置参数', ['外部稿.md']],
  ])('%s 输出中文参数错误与用法，退出 2 且不输出堆栈', (_label, args) => {
    const run = spawnSync(process.execPath, [TASK_PATH, ...args], { encoding: 'utf8', windowsHide: true })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('参数错误')
    expect(run.stderr).toContain('用法：')
    expect(run.stderr).not.toMatch(/TypeError|ERR_PARSE_ARGS|\n\s+at /u)
    expect(run.stdout).toBe('')
  })

  function prepare(root) {
    writeFile(root, 'knowledge/facts/名册.md', '# 干员名册\n\n- 凯尔希 | ☆6 | 医疗 | 加工站\n')
    writeFile(root, 'knowledge/facts/技能-加工站.md', '# 加工站基建技能\n\n- **初始解锁**「未知技术」：副产品的产出概率提升70%\n')
    return writeFile(root, 'dev-temp/work/外部稿/加工站机制.md', [
      '# 加工站机制',
      '',
      '## 设施基础',
      '',
      '生产效率受技能影响，凯尔希的未知技术可提升副产物概率。',
      '',
    ].join('\n'))
  }

  it('输出大纲、术语、对象候选与对照范围，并正常退出', () => {
    withRoot((root) => {
      const source = prepare(root)
      const run = spawnSync(
        process.execPath,
        [TASK_PATH, '--root', root, '--source', source, '--room', '加工站'],
        { encoding: 'utf-8', windowsHide: true },
      )

      expect(run.status).toBe(0)
      expect(run.stdout).toContain('大纲')
      expect(run.stdout).toContain('设施基础')
      expect(run.stdout).toContain('生产效率')
      expect(run.stdout).toContain('生产力')
      expect(run.stdout).toContain('命中本地对象，待核对')
      expect(run.stdout).toContain('L5')
      expect(run.stdout).toContain('技能：未知技术')
      expect(run.stdout).toContain('干员：凯尔希')
      expect(run.stdout.match(/生产效率受技能影响，凯尔希的未知技术可提升副产物概率。/gu)).toHaveLength(1)
      expect(run.stdout).toContain('加工站（技能名）')
      expect(run.stdout).toContain('不代表该段数值、条件或关系已由 facts 覆盖')
      expect(run.stdout).not.toContain('facts 已覆盖，勿抄')
    })
  })

  it('终端与 --json 表达同一口径', () => {
    withRoot((root) => {
      const source = prepare(root)
      const text = spawnSync(
        process.execPath,
        [TASK_PATH, '--root', root, '--source', source, '--room', '加工站'],
        { encoding: 'utf-8', windowsHide: true },
      )
      const json = spawnSync(
        process.execPath,
        [TASK_PATH, '--root', root, '--source', source, '--room', '加工站', '--json'],
        { encoding: 'utf-8', windowsHide: true },
      )

      const parsed = JSON.parse(json.stdout)
      expect(parsed.catalogScope).toContain('加工站（技能名）')
      expect(text.stdout).toContain(parsed.limitation)
      expect(parsed.sources[0].factCandidateGroups).toContainEqual({
        line: 5,
        context: '生产效率受技能影响，凯尔希的未知技术可提升副产物概率。',
        candidates: [
          { name: '凯尔希', type: 'operator', confidence: 'high' },
          { name: '未知技术', type: 'skill', confidence: 'high' },
        ],
      })
      expect(parsed.sources[0]).not.toHaveProperty('factCandidates')
    })
  })

  it('未指定设施时只跳过技能核对，并说明仍核对干员名', () => {
    withRoot((root) => {
      const source = prepare(root)
      const run = spawnSync(
        process.execPath,
        [TASK_PATH, '--root', root, '--source', source],
        { encoding: 'utf-8', windowsHide: true },
      )

      expect(run.status).toBe(0)
      expect(run.stdout).toContain('未指定设施，跳过技能名核对')
      expect(run.stdout).toContain('干员标准名')
      expect(run.stdout).toContain('干员：凯尔希')
      expect(run.stdout).not.toContain('技能：未知技术')
    })
  })

  it('多源文件同一行号分别分组，扫描不修改源文件', () => {
    withRoot((root) => {
      const source = prepare(root)
      const secondText = '# 第二篇\n\n\n\n未知技术的条件。\n'
      const second = writeFile(root, '第二篇.md', secondText)
      const original = readFileSync(source, 'utf8')
      const run = spawnSync(process.execPath, [TASK_PATH, '--root', root, '--source', source, '--source', second, '--room', '加工站', '--json'], { encoding: 'utf8', windowsHide: true })
      expect(run.status).toBe(0)
      const result = JSON.parse(run.stdout)
      expect(result.sources).toHaveLength(2)
      expect(result.sources.map((item) => item.factCandidateGroups[0].line)).toEqual([5, 5])
      expect(result.sources[1].factCandidateGroups[0].context).toBe('未知技术的条件。')
      expect(readFileSync(source, 'utf8')).toBe(original)
      expect(readFileSync(second, 'utf8')).toBe(secondText)
    })
  })

  it('源文件不存在时以参数错误退出并输出中文提示', () => {
    withRoot((root) => {
      const run = spawnSync(
        process.execPath,
        [TASK_PATH, '--root', root, '--source', join(root, '缺失.md')],
        { encoding: 'utf-8', windowsHide: true },
      )

      expect(run.status).toBe(2)
      expect(run.stderr).toContain('源文件不存在')
    })
  })

  it('名册缺失时报中文错误并以一般错误退出', () => {
    withRoot((root) => {
      const source = writeFile(root, '外部稿.md', '# 稿\n\n正文\n')
      const run = spawnSync(
        process.execPath,
        [TASK_PATH, '--root', root, '--source', source],
        { encoding: 'utf-8', windowsHide: true },
      )

      expect(run.status).toBe(1)
      expect(run.stderr).toContain('名册不存在')
    })
  })

  it('源路径为目录时输出中文读取错误并退出 1，不泄漏堆栈', () => {
    withRoot((root) => {
      prepare(root)
      const run = spawnSync(process.execPath, [TASK_PATH, '--root', root, '--source', root], { encoding: 'utf8', windowsHide: true })
      expect(run.status).toBe(1)
      expect(run.stderr).toContain('预检失败')
      expect(run.stderr).not.toMatch(/Error:|\n\s+at /u)
      expect(run.stdout).toBe('')
    })
  })
})
