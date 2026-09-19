/**
 * 统一投影 knowledge/facts 技能分片中的公共练度说明。
 *
 * 上游解包生成器不在当前仓库内，因此把跨九个分片的公共说明收敛为
 * 一个可重跑、可检查的投影步骤；设施事实正文仍以各分片的版本控制文本为准。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REFERENCE_ROOMS = [
  '办公室',
  '发电站',
  '会客室',
  '加工站',
  '控制中枢',
  '贸易站',
  '宿舍',
  '训练室',
  '制造站',
]

export const GENERATED_HEADER = '<!-- 本文件的历史内容由上游生成；当前以版本控制内的文本为输入，本仓库不含该生成脚本，不能承诺重跑即可重建。公共练度说明由 scripts/tasks/knowledge/update-reference-projection.mjs 统一投影。 -->'

export const REFERENCE_PREAMBLE = `**练度门槛**：\`精N\` = 精英化 N 阶段；\`Lv.30\` = 等级 30。

- 一星、二星干员通常在达到 30 级（精零满级）时解锁相应后勤技能；
- 三星、四星干员通常在精一阶段解锁或提升后勤技能；
- 五星、六星干员通常在精二阶段解锁或提升后勤技能；
- 具体技能行的解锁字段优先于按星级概括的常见规则，不能把一、二星的常见规则扩展到三星。

**提升 vs 解锁 —— 这个区分很关键**：

- **解锁**：在对应练度获得新的后勤技能，前一技能仍然保留；
- **提升**：在对应练度替换或增强前一技能，具体替换关系以技能行的“替换”字段为准。

例：温蒂精 2 的「仿生海龙」是**提升**，不是新增的第三个技能；巫恋精 2 的「低语」是**解锁**，不是替换精零技能。`

const PREAMBLE_PATTERN = /\*\*练度门槛\*\*：[\s\S]*?(?=\r?\n\r?\n## 按干员)/

export function projectText(sourceText) {
  if (!sourceText.includes('## 按干员')) {
    throw new Error('技能分片缺少“## 按干员”锚点，拒绝覆盖：无法确认公共说明边界')
  }
  if (!PREAMBLE_PATTERN.test(sourceText)) {
    throw new Error('技能分片缺少可识别的公共练度说明，拒绝覆盖：请先核对生成格式')
  }
  const withHeader = sourceText.replace(/^<!--[\s\S]*?-->/, GENERATED_HEADER)
  // 保留检出文件的换行风格，避免 Windows core.autocrlf 将已投影内容误判为差异。
  const lineEnding = sourceText.includes('\r\n') ? '\r\n' : '\n'
  const preamble = REFERENCE_PREAMBLE.replace(/\n/g, lineEnding)
  return withHeader.replace(PREAMBLE_PATTERN, preamble)
}

export function projectReferenceFragments(root, { write = true } = {}) {
  const fragmentsDir = join(resolve(root), 'knowledge', 'facts')
  const changes = []
  for (const room of REFERENCE_ROOMS) {
    const relativePath = `knowledge/facts/技能-${room}.md`
    const filePath = join(fragmentsDir, `技能-${room}.md`)
    const sourceText = readFileSync(filePath, 'utf-8')
    const projectedText = projectText(sourceText)
    if (projectedText !== sourceText) {
      if (write) writeFileSync(filePath, projectedText, 'utf-8')
      changes.push(relativePath)
    }
  }
  return changes
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const changes = projectReferenceFragments(root, { write: !checkOnly })
  if (checkOnly && changes.length > 0) {
    throw new Error(`facts 技能分片公共练度说明未与统一投影一致：${changes.join('、')}`)
  }
  process.stdout.write(checkOnly
    ? 'facts 技能分片公共练度说明投影校验通过：9 个分片一致\n'
    : `facts 技能分片公共练度说明已投影：${changes.length} 个分片更新\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
