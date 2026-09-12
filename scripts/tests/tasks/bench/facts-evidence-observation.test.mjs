import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadRosterFormalNames,
  observeFactsEvidence,
  renderObservation,
} from '../../../tasks/bench/facts-evidence-observation.mjs'

const ROSTER = [
  '# 干员名册',
  '',
  '- 甲干员 | ☆6 | 近卫 | 制造站',
  '- 乙干员 | ☆5 | 狙击 | 贸易站',
  '- 甲干员·改 | ☆6 | 术师 | 发电站',
  '',
].join('\n')

function record(queryId, ragDelivery) {
  return JSON.stringify({
    ts: '2026-09-12T00:00:00.000Z',
    queryId,
    category: 'fact',
    round: 1,
    thinking: 'off',
    model: 'qwen3.7-flash',
    truncated: false,
    ...(ragDelivery ? { tools: ['rag_search'], ragDelivery } : {}),
  })
}

function factsEvent(callId, hitIds) {
  return {
    type: 'tool_call',
    round: 1,
    callId,
    tool: 'facts_search',
    rawArguments: '{"queries":["甲干员"]}',
    status: 'success',
    executed: true,
    budgetRemaining: 4,
    hitIds,
  }
}

function trace(queryId, events) {
  return JSON.stringify({ schemaVersion: 3, queryId, question: '', status: 'completed', events })
}

/** 写一份最小合成运行目录：多对象部分送达、附带省略、重复送达与缺失 trace。 */
function writeRunDir() {
  const dir = mkdtempSync(join(tmpdir(), 'rag-facts-observation-'))
  writeFileSync(join(dir, '名册.md'), ROSTER)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    topic: 'rag-hybrid',
    questions: 7,
    questionIds: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'],
    questionDefinitions: [
      { id: 'Q1', category: 'fact', question: '甲干员与乙干员如何搭配？' },
      { id: 'Q2', category: 'fact', question: '甲干员的基建技能是什么？' },
      { id: 'Q3', category: 'fact', question: '甲干员·改的发电站技能怎么用？' },
      { id: 'Q4', category: 'fact', question: '丙干员怎么排班？' },
      { id: 'Q5', category: 'fact', question: '乙干员在贸易站的表现' },
      { id: 'Q6', category: 'fact', question: '甲干员和乙干员谁的贸易站更强？' },
      { id: 'Q7', category: 'fact', question: '甲干员的发电站技能？' },
    ],
    source: { gitHead: 'fixture-head', gitDirty: false },
  }))
  writeFileSync(join(dir, 'records.jsonl'), [
    // Q1：RAG 未附带任何卡；显式 facts 送达甲干员，乙干员未送达。
    record('Q1', [{ callId: 'r1', status: 'success', attachedFacts: [] }]),
    // Q2：RAG 附带实际送达甲干员。
    record('Q2', [{
      callId: 'r2',
      status: 'success',
      attachedFacts: [{
        term: '甲干员', start: 0, end: 3, matched: ['甲干员'], delivered: ['甲干员'],
        omittedReason: null, chars: 10, elapsedMs: 1, paths: [],
      }],
    }]),
    // Q3：附带词条因额度省略（delivered 为空），不得计为送达。
    record('Q3', [{
      callId: 'r3',
      status: 'success',
      attachedFacts: [{
        term: '甲干员·改', start: 0, end: 5, matched: ['甲干员·改'], delivered: [],
        omittedReason: '整组未放入剩余额度', chars: 0, elapsedMs: 1, paths: [],
      }],
    }]),
    record('Q4'),
    record('Q5'),
    // Q6：有工具批次但缺 ragDelivery，RAG 台账不可用；显式 facts 只送达甲干员。
    JSON.stringify({
      ts: '2026-09-12T00:00:00.000Z',
      queryId: 'Q6',
      category: 'fact',
      round: 1,
      thinking: 'off',
      model: 'qwen3.7-flash',
      truncated: false,
      tools: ['rag_search'],
      toolBatch: { requested: 1, granted: 1, executed: 1, denied: 0, errors: 0, attempts: 1, successes: 1, budgetBefore: 5, budgetAfter: 4, resultChars: 20 },
    }),
    // Q7：同样缺 RAG 台账，但显式 facts 已覆盖本题唯一命中对象，仍应判适用。
    JSON.stringify({
      ts: '2026-09-12T00:00:00.000Z',
      queryId: 'Q7',
      category: 'fact',
      round: 1,
      thinking: 'off',
      model: 'qwen3.7-flash',
      truncated: false,
      tools: ['rag_search'],
      toolBatch: { requested: 1, granted: 1, executed: 1, denied: 0, errors: 0, attempts: 1, successes: 1, budgetBefore: 4, budgetAfter: 3, resultChars: 10 },
    }),
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'trace.jsonl'), [
    trace('Q1', [factsEvent('a', ['甲干员'])]),
    trace('Q2', []),
    // Q3：两次调用重复送达同一对象，按对象去重。
    trace('Q3', [factsEvent('b', ['甲干员·改']), factsEvent('c', ['甲干员·改'])]),
    trace('Q4', []),
    // Q6：显式 facts 只送达甲干员，乙干员须由 RAG 台账判定，而台账不可用。
    trace('Q6', [factsEvent('d', ['甲干员'])]),
    // Q7：显式 facts 覆盖唯一命中对象，使 RAG 台账不可用不影响判定。
    trace('Q7', [factsEvent('e', ['甲干员'])]),
    // Q5 故意缺 trace 行，用于覆盖缺失观测的不可判定。
    '',
  ].join('\n'))
  return dir
}

describe('bench/facts-evidence-observation：正式名命中对象的事实卡送达统计', () => {
  it('按行解析名册正式名，保持文件顺序', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-roster-'))
    try {
      const path = join(dir, '名册.md')
      writeFileSync(path, ROSTER)
      expect(loadRosterFormalNames(path)).toEqual(['甲干员', '乙干员', '甲干员·改'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('区分部分送达、附带省略、重复送达、不适用与缺失观测', () => {
    const dir = writeRunDir()
    try {
      const result = observeFactsEvidence({ runDir: dir, rosterPath: join(dir, '名册.md'), currentHead: 'fixture-head' })
      const byId = Object.fromEntries(result.questions.map((row) => [row.id, row]))

      expect(byId.Q1).toMatchObject({
        verdict: 'applicable',
        hitObjects: ['甲干员', '乙干员'],
        explicitDelivered: ['甲干员'],
        ragDelivered: [],
        deliveredUnion: ['甲干员'],
        undelivered: ['乙干员'],
      })
      expect(byId.Q2).toMatchObject({
        verdict: 'applicable',
        explicitDelivered: [],
        ragDelivered: ['甲干员'],
        undelivered: [],
      })
      expect(byId.Q3).toMatchObject({
        verdict: 'applicable',
        hitObjects: ['甲干员', '甲干员·改'],
        explicitDelivered: ['甲干员·改'],
        ragDelivered: [],
        undelivered: ['甲干员'],
      })
      expect(byId.Q4).toMatchObject({ verdict: 'not_applicable', hitObjects: [] })
      expect(byId.Q5).toMatchObject({ verdict: 'undecidable', hitObjects: ['乙干员'] })
      expect(byId.Q5.reason).toContain('trace')
      // RAG 台账不可用：显式 facts 已送达甲干员，乙干员不由显式覆盖且 RAG 无法确认，整题不可判定。
      expect(byId.Q6).toMatchObject({
        verdict: 'undecidable',
        hitObjects: ['甲干员', '乙干员'],
        explicitDelivered: ['甲干员'],
      })
      expect(byId.Q6.reason).toContain('RAG')
      // RAG 台账不可用但显式 facts 已覆盖唯一命中对象：仍判适用，不因台账缺失降级。
      expect(byId.Q7).toMatchObject({
        verdict: 'applicable',
        hitObjects: ['甲干员'],
        explicitDelivered: ['甲干员'],
        deliveredUnion: ['甲干员'],
        undelivered: [],
      })

      expect(result.totals).toEqual({
        questions: 7,
        applicable: 4,
        notApplicable: 1,
        undecidable: 2,
        objects: 6,
        delivered: 4,
        undelivered: 2,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('渲染终端表格含统计名、字面命中说明与逐题明细', () => {
    const dir = writeRunDir()
    try {
      const result = observeFactsEvidence({ runDir: dir, rosterPath: join(dir, '名册.md'), currentHead: 'fixture-head' })
      const text = renderObservation(result)
      expect(text).toContain('正式名命中对象的事实卡送达统计')
      expect(text).toContain('字面命中')
      expect(text).toContain('Q1')
      expect(text).toContain('乙干员')
      expect(text).toContain('不可判定')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('运行版本与当前 HEAD 无法对应时整题不可判定，不用当前名册无条件解释', () => {
    const dir = writeRunDir()
    try {
      const result = observeFactsEvidence({ runDir: dir, rosterPath: join(dir, '名册.md'), currentHead: 'other-head' })
      expect(result.questions.every((row) => row.verdict === 'undecidable')).toBe(true)
      expect(result.questions[0]?.reason).toContain('名册')
      expect(result.totals).toMatchObject({ applicable: 0, undecidable: result.questions.length })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
