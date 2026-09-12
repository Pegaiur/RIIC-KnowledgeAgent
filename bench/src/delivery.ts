/** 工具送达观测的共享类型；不含工具执行逻辑或运行时副作用。 */
import type { ResolutionPath } from './facts/store.js'

/** RAG 内部 facts 附带的单触发词观测（ADR-013 步骤 3）：触发、匹配与送达分开记录。 */
export interface AttachedFactsObservation {
  /** 触发词（完整登记词）。 */
  term: string
  /** 触发词在本次实际检索 query 中的 UTF-16 起止区间 [start, end)；工具参数层已 trim 首尾，识别函数对未 trim 输入自行校正偏移。 */
  start: number
  end: number
  /** 该词的解析路径并集（exact/alias/substring/combo）；未附带时仍保留匹配到的路径。 */
  paths: ResolutionPath[]
  /** factsSearch 命中的 canonical（按 store 稳定卡序去重）。 */
  matched: string[]
  /** 本次实际送达的 canonical；整组未附带时为空。 */
  delivered: string[]
  /** 未附带原因；完整附带时为 null。 */
  omittedReason: string | null
  /** 该词实际写入的附带正文 UTF-16 字符数：已附带为整组块，未附带为提示行长度（提示也未写入时为 0）。 */
  chars: number
  /** 该次内部 factsSearch 耗时（毫秒）。 */
  elapsedMs: number
}

/** 原文扩展的实际送达范围（ADR-013）：offset/行范围对应原文，用于观测与续读。 */
export interface FulltextRange {
  file: string
  /** 可调用续读的文档范围 ID（read_section 可解析）。 */
  docId: string
  /** 已送达正文在文档正文中的起止 UTF-16 offset。 */
  offset: number
  endOffset: number
  startLine: number
  endLine: number
  complete: boolean
  nextOffset: number | null
}

/** 持久化路径只保留解析身份与成员；完整来源登记继续保存在 trace/inputs。 */
export type DeliveryPath = Pick<ResolutionPath, 'kind' | 'term' | 'memberIds'> & { category?: string }

/** 单次外部 RAG 的送达台账；数组缺失表示异常时不可用，空数组表示已观察为零。 */
export interface RagDeliveryRecord {
  callId: string
  status: string
  fulltextRanges?: FulltextRange[]
  attachedFacts?: Array<Omit<AttachedFactsObservation, 'paths'> & { paths: DeliveryPath[] }>
}
