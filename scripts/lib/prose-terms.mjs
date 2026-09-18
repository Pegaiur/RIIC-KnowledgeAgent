/**
 * RAG 玩家侧散文统一术语表与文本命中检测。
 *
 * 真源为 docs/spec/rag-prose-terminology.md 的规范词表。本模块只承载术语表与纯匹配逻辑，
 * 扫描范围、文件豁免与退出码由各消费者自行决定。
 *
 * 消费者：
 *   - scripts/prose-terms-check.mjs（合并门禁：扫描 knowledge/base 与 knowledge/guides）
 *   - scripts/tasks/knowledge/external-corpus-scan.mjs（外部语料导入预检：扫描外部稿全文）
 */

/**
 * 禁词表：与规范词表逐条对应，命中即视为非规范写法。
 * 修改此处会同时改变合并门禁与导入预检的行为，须与 docs/spec/rag-prose-terminology.md 同步。
 */
export const FORBIDDEN_PROSE_TERMS = [
  { pattern: /星级/u, replacement: '稀有度' },
  { pattern: /(?:[1-6]|[一二三四五六])★|☆[1-6一二三四五六]|[1-6]星/u, replacement: '一星～六星的中文写法' },
  { pattern: /精英\s*[012零一二]|精[012]|[eE][012]/u, replacement: '精零、精一或精二' },
  { pattern: /无(?:额外)?练度要求|没有额外练度要求|练度无要求|无练度门槛|不(?:需要|要求)额外培养/u, replacement: '精零即可；若表达推荐策略则用“不设独立培养目标”' },
  { pattern: /订单效率|贸易效率/u, replacement: '订单获取效率' },
  { pattern: /生产效率/u, replacement: '生产力' },
  { pattern: /联络效率/u, replacement: '联络速度' },
  { pattern: /仓库容量上限|仓库上限/u, replacement: '仓库容量' },
  { pattern: /体力/u, replacement: '心情' },
  { pattern: /经验书/u, replacement: '作战记录' },
  { pattern: /角色|人物/u, replacement: '干员' },
  { pattern: /线索收集/u, replacement: '线索搜集' },
  { pattern: /技能档/u, replacement: '技能解锁档' },
]

/**
 * 导入期补充提示：门禁禁词表漏掉、但外部稿常见的写法。
 * 只用于外部语料清洗预检，不进入合并门禁，避免在未改写前就判定本库语料失败。
 */
export const IMPORT_HINT_PROSE_TERMS = [
  // 禁词表的 精英\s*[012] 要求“精英”紧跟数字；外部稿常写“精 2”，带空格因此漏检。
  { pattern: /精\s+[012]/u, replacement: '精零、精一或精二' },
]

/**
 * 匹配单行文本中的术语：每个术语只取该行首个命中（门禁既有口径）。
 *
 * @param {string} line 单行文本
 * @param {{ pattern: RegExp, replacement: string }[]} terms 术语表
 * @param {'forbidden'|'import-hint'} kind 命中来源分类
 * @returns {{ term: string, replacement: string, kind: string }[]}
 */
export function matchTermsInLine(line, terms, kind) {
  const hits = []
  for (const term of terms) {
    const match = term.pattern.exec(line)
    if (!match) continue
    hits.push({ term: match[0], replacement: term.replacement, kind })
  }
  return hits
}
