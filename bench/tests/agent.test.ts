import { describe, expect, it } from 'vitest'
import {
  buildSystemPrompt,
  grepSearchTool,
  MAX_RAG_CALLS,
  ragSearchTool,
} from '../src/agent.js'

/** 取工具函数名（OpenAI function calling 的 function.name） */
function toolName(tool: Record<string, unknown>): string {
  const fn = tool.function as { name: string }
  return fn.name
}

describe('agent：grep/rag 检索工具 schema 拆分', () => {
  it('rag_search 与 grep_search 为两个独立 schema（函数名不同）', () => {
    expect(toolName(ragSearchTool())).toBe('rag_search')
    expect(toolName(grepSearchTool())).toBe('grep_search')
  })

  it('两个工具均暴露统一的 query 参数结构', () => {
    for (const tool of [ragSearchTool(), grepSearchTool()]) {
      const fn = tool.function as { parameters: { required: string[]; properties: Record<string, unknown> } }
      expect(fn.parameters.required).toEqual(['query'])
      expect(fn.parameters.properties.query).toBeDefined()
    }
  })

  it('系统提示的工具名随检索器切换，且含检索上限', () => {
    expect(buildSystemPrompt('grep')).toContain('grep_search')
    expect(buildSystemPrompt('bm25')).toContain('rag_search')
    expect(buildSystemPrompt('grep')).toContain(`最多允许检索 ${MAX_RAG_CALLS} 次`)
  })
})
