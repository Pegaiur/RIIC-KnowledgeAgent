/**
 * 基准运行的非敏感输入记录：只保存可复核的配置和必要的脱敏文本。
 * 该模块不读取运行时输入，也不在导入时写盘；调用方负责选择写入时机。
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { effectiveAttachFacts, type BenchConfig } from './config.js'
import type { CardStore } from './facts/store.js'
import type { SectionDirectory } from './sections.js'
import { currentEntityBoost, currentTokenizer } from './retriever.js'
import type { BenchQuery, DocChunk, ThinkingMode, TokenizerId } from './types.js'

export const RUN_INPUTS_SCHEMA_VERSION = 1 as const

export interface CapturedText {
  text: string
  redacted: boolean
}

export interface CapturedJson {
  value: unknown
  redacted: boolean
}

export interface SourceMetadata {
  nodeVersion: string | null
  packageVersion: string | null
  gitHead: string | null
  gitDirty: boolean | null
  metadataCapturedAt: string
}

export interface FactsInputObservation {
  status: 'not_used' | 'captured' | 'load_failed'
  cardCount?: number
  error?: string
}

export interface RunInputs {
  schemaVersion: typeof RUN_INPUTS_SCHEMA_VERSION
  captureStatus: 'pending' | 'complete'
  capturedAt: string
  agentInstructions: CapturedText
  systemPrompt: CapturedText
  toolSchema: {
    version: number
    names: string[]
    definitions: unknown
    redacted: boolean
  }
  config: {
    provider: BenchConfig['provider']
    providerLabel: string
    model: string
    baseUrl: string
    chatPath: string
    thinking: ThinkingMode
    dry: boolean
    temperature: number | null
    maxTokens: number
    retriever: BenchConfig['retriever']
    /** 检索语料是否包含技能表；false = 排除九份 references/技能-*.md（ADR-013）。 */
    includeSkillTables: boolean
    /** 是否把 base/guides 命中小节扩展到原文文件范围（ADR-013）。 */
    expandFulltext: boolean
    /** RAG 内部 facts 附带的有效开关；未显式声明时随模式默认（ADR-013）。 */
    attachFacts: boolean
    corpusDir: string
    tokenizer: TokenizerId
    entityBoost: number
    declaredTokenizer: TokenizerId
    declaredEntityBoost: number
    topK: number
    maxContextChars: number
    toolBudget: number
    toolAttemptLimit: number
    sessionTimeoutMs: number
    feedbackOnNoToolAnswer: boolean
    toolChoice: 'auto'
    parallelToolCalls: boolean
    stringCaptures: {
      providerLabel: CapturedText
      model: CapturedText
      baseUrl: CapturedText
      chatPath: CapturedText
      corpusDir: CapturedText
    }
    prices: {
      inPerM: number
      outPerM: number
      cachePerM: number
    }
  }
  questions: Array<{
    id: string
    category: BenchQuery['category']
    question: string
    questionRedacted: boolean
  }>
  sourceAtStart: SourceMetadata
  rag: {
    chunkCount: number
    fields: string[]
    orderPreserved: true
  }
  /** 仅在开放阅读能力的模式提供；记录小节数量与顺序。 */
  sections?: {
    version: number
    sectionCount: number
    orderPreserved: true
  }
  facts: FactsInputObservation
}

export interface RunInputsOptions {
  config: BenchConfig
  thinking: ThinkingMode
  dry: boolean
  agentInstructions: string
  systemPrompt: string
  toolSchema: {
    toolSchemaVersion: number
    toolNames: string[]
  }
  toolDefinitions: unknown[]
  questions: BenchQuery[]
  chunks: DocChunk[]
  /** 可选的运行级小节目录；仅开放阅读能力的模式提供。 */
  sections?: SectionDirectory
  sourceAtStart: SourceMetadata
}

/** 构造一份首个模型请求前即可写盘的输入快照。 */
export function createRunInputs(options: RunInputsOptions): RunInputs {
  const sensitiveValues = [options.config.apiKey]
  const agentInstructions = captureText(options.agentInstructions, sensitiveValues)
  const systemPrompt = captureText(options.systemPrompt, sensitiveValues)
  const toolSchema = captureJson(options.toolDefinitions, sensitiveValues)
  const configStrings = {
    providerLabel: captureText(options.config.providerLabel, sensitiveValues),
    model: captureText(options.config.model, sensitiveValues),
    baseUrl: captureText(options.config.baseUrl, sensitiveValues),
    chatPath: captureText(options.config.chatPath, sensitiveValues),
    corpusDir: captureText(options.config.corpusDir, sensitiveValues),
  }
  return {
    schemaVersion: RUN_INPUTS_SCHEMA_VERSION,
    captureStatus: 'pending',
    capturedAt: new Date().toISOString(),
    agentInstructions,
    systemPrompt,
    toolSchema: {
      version: options.toolSchema.toolSchemaVersion,
      names: [...options.toolSchema.toolNames],
      definitions: toolSchema.value,
      redacted: toolSchema.redacted,
    },
    config: {
      provider: options.config.provider,
      providerLabel: configStrings.providerLabel.text,
      model: configStrings.model.text,
      baseUrl: configStrings.baseUrl.text,
      chatPath: configStrings.chatPath.text,
      thinking: options.thinking,
      dry: options.dry,
      temperature: options.config.temperature ?? null,
      maxTokens: options.config.maxTokens,
      retriever: options.config.retriever,
      includeSkillTables: options.config.includeSkillTables,
      expandFulltext: options.config.expandFulltext,
      attachFacts: effectiveAttachFacts(options.config),
      corpusDir: redactSensitiveText(options.config.corpusDir, sensitiveValues),
      tokenizer: currentTokenizer(),
      entityBoost: currentEntityBoost(),
      declaredTokenizer: options.config.tokenizer,
      declaredEntityBoost: options.config.entityBoost,
      topK: options.config.topK,
      maxContextChars: options.config.maxContextChars,
      toolBudget: options.config.toolBudget,
      toolAttemptLimit: options.config.toolAttemptLimit,
      sessionTimeoutMs: options.config.sessionTimeoutMs,
      feedbackOnNoToolAnswer: options.config.feedbackOnNoToolAnswer,
      toolChoice: 'auto',
      // 宿主不再开启并行工具调用：同批按返回顺序逐项串行执行与结算。
      parallelToolCalls: false,
      stringCaptures: configStrings,
      prices: {
        inPerM: options.config.prices.inPerM,
        outPerM: options.config.prices.outPerM,
        cachePerM: options.config.prices.cachePerM,
      },
    },
    questions: options.questions.map((question) => {
      const captured = captureText(question.question, sensitiveValues)
      return {
        id: redactSensitiveText(question.id, sensitiveValues),
        category: question.category,
        question: captured.text,
        questionRedacted: captured.redacted,
      }
    }),
    sourceAtStart: options.sourceAtStart,
    rag: {
      chunkCount: options.chunks.length,
      fields: ['id', 'file', 'heading', 'text', 'anchor', 'startLine', 'endLine'],
      orderPreserved: true,
    },
    ...(options.sections
      ? {
          sections: {
            version: options.sections.version,
            sectionCount: options.sections.sections.length,
            orderPreserved: true as const,
          },
        }
      : {}),
    facts: { status: 'not_used' },
  }
}

/** 仅在 facts 工具实际取得 store 后调用；不主动触发 store 加载。 */
export function markFactsCaptured(inputs: RunInputs, store: CardStore): void {
  if (inputs.facts.status === 'captured') return
  inputs.facts = {
    status: 'captured',
    cardCount: store.cards.length,
  }
}

/** 记录 facts 加载失败，不写入卡片观测。 */
export function markFactsLoadFailed(inputs: RunInputs, error: unknown, sensitiveValues: Array<string | undefined> = []): void {
  if (inputs.facts.status === 'captured') return
  inputs.facts = {
    status: 'load_failed',
    error: redactSensitiveText(error instanceof Error ? error.message : String(error), sensitiveValues),
  }
}

/** 完成运行后再标记，避免中途终止的目录被误称为完整输入快照。 */
export function completeRunInputs(inputs: RunInputs): void {
  inputs.captureStatus = 'complete'
}

/** 写入最终 UTF-8 字节。 */
export function writeRunInputs(path: string, inputs: RunInputs): void {
  const content = `${JSON.stringify(inputs, null, 2)}\n`
  writeFileSync(path, content, 'utf-8')
}

export function captureText(value: string, sensitiveValues: Array<string | undefined> = []): CapturedText {
  const text = redactSensitiveText(value, sensitiveValues)
  const redacted = text !== value
  return {
    text,
    redacted,
  }
}

export function captureJson(value: unknown, sensitiveValues: Array<string | undefined> = []): CapturedJson {
  const redactedValue = redactJson(value, sensitiveValues)
  const redacted = JSON.stringify(redactedValue) !== JSON.stringify(value)
  return {
    value: redactedValue,
    redacted,
  }
}

/**
 * 在运行开始和结束分别采集源码状态。Git 不可用时字段为 null，不用导出阶段的 HEAD 猜测。
 * gitRunner 仅供测试注入，不改变正常运行路径。
 */
export function collectSourceMetadata(
  root = process.cwd(),
  gitRunner: (args: string[], cwd: string) => string = (args, cwd) => execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
): SourceMetadata {
  let gitHead: string | null = null
  let gitDirty: boolean | null = null
  try {
    gitHead = gitRunner(['rev-parse', 'HEAD'], root).trim() || null
    gitDirty = gitRunner(['status', '--porcelain', '--untracked-files=all'], root).trim().length > 0
  } catch {
    // 非 Git 副本或 git 不可用时如实保留未知状态。
  }
  let packageVersion: string | null = null
  try {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { version?: unknown }
    packageVersion = typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    // package.json 缺失时不阻塞运行。
  }
  return { nodeVersion: process.version, packageVersion, gitHead, gitDirty, metadataCapturedAt: new Date().toISOString() }
}

const SENSITIVE_PATTERNS = [
  /((?:api[_-]?key|authorization|secret|password|token)\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi,
  /\b(?:sk|dashscope|tokenhub)-[A-Za-z0-9_-]{4,}\b/gi,
]

export function redactSensitiveText(value: string, sensitiveValues: Array<string | undefined> = []): string {
  const values = [...new Set(sensitiveValues.filter((item): item is string => Boolean(item)))].sort((a, b) => b.length - a.length)
  const exact = values.reduce((text, secret) => text.split(secret).join('[已脱敏]'), value)
  return SENSITIVE_PATTERNS.reduce((text, pattern) => text.replace(pattern, '$1[已脱敏]'), exact)
}

function redactJson(value: unknown, sensitiveValues: Array<string | undefined>): unknown {
  if (typeof value === 'string') return redactSensitiveText(value, sensitiveValues)
  if (Array.isArray(value)) return value.map((item) => redactJson(item, sensitiveValues))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactJson(item, sensitiveValues)]))
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex')
}
