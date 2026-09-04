import { describe, expect, it } from 'vitest'
import {
  GENERATED_HEADER,
  REFERENCE_PREAMBLE,
  projectText,
} from '../../scripts/tasks/knowledge/update-reference-projection.mjs'

function sourceWithLineEnding(lineEnding) {
  return [
    GENERATED_HEADER,
    '',
    REFERENCE_PREAMBLE,
    '',
    '## 按干员',
    '',
    '### 测试干员',
  ].join('\n').replace(/\n/g, lineEnding)
}

describe('references 公共练度投影', () => {
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('已投影的 %s 文件保持幂等', (_name, lineEnding) => {
    const source = sourceWithLineEnding(lineEnding)
    expect(projectText(source)).toBe(source)
  })

  it('替换旧公共说明时保留 CRLF', () => {
    const source = [
      '<!-- 旧生成头 -->',
      '',
      '**练度门槛**：旧说明',
      '',
      '旧公共说明内容',
      '',
      '## 按干员',
      '',
      '### 测试干员',
    ].join('\r\n')
    const expected = sourceWithLineEnding('\r\n')

    expect(projectText(source)).toBe(expected)
  })
})
