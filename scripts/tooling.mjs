/**
 * 通用开发脚本工具（tooling）
 *
 * 用法：
 *   node scripts/tooling.mjs list
 *   node scripts/tooling.mjs run <task> -- <args...>
 *   node scripts/tooling.mjs tmp path|list|clean [--manifest <path>] [--older-than <n>] [--reason <text> | --snapshot <path>] [--apply]
 *
 * 约定：
 *   - tasks 目录发现是唯一注册事实，不维护第二份 manifest；
 *   - 退出码：0 成功 / 1 一般错误 / 2 参数错误；
 *   - 核心逻辑为接受注入 root 的纯函数，CLI 只负责参数解析与退出码。
 */

import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, mkdirSync, rmSync, writeFileSync, readFileSync, lstatSync, unlinkSync } from 'node:fs'
import { resolve, dirname, join, relative, basename, isAbsolute } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveRepoRoot, isPathInside as isInside, tasksRoot } from './lib/repo-context.mjs'
import { runStreaming } from './lib/process.mjs'
import { normalizeTaskRef } from './lib/task-ref.mjs'
import { getDevTmpRoot, getRunDirRoot } from './lib/dev-workspace.mjs'

export { normalizeTaskRef }

// ── 常量 ──────────────────────────────────────────────────────

/** 退出码：成功 */
export const EXIT_OK = 0
/** 退出码：一般错误 */
export const EXIT_ERROR = 1
/** 退出码：参数/用法错误 */
export const EXIT_USAGE = 2

/** 显式清理清单版本；清单是一次收尾的输入，不是持久状态库。 */
export const CLEANUP_MANIFEST_SCHEMA_VERSION = 1

/** CLI 入口从本文件位置定位仓库根（lib/repo-context.mjs 向上查找仓库标志文件，默认 .git） */
const CLI_ROOT = resolveRepoRoot(import.meta.url)

// ── 核心纯函数（接受注入 root，无顶层副作用，便于 node:test） ──

/**
 * 校验 child 是否位于 parent 之内（等值视为越界）。
 * 委托 lib/repo-context.mjs 的 isPathInside（路径内收检查单一实现）。
 */
export { isInside }

/**
 * 目录发现：递归枚举 scripts/tasks/**\/*.mjs，返回相对 tasks 根的排序路径。
 * @param {string} root 仓库根
 * @returns {string[]}
 */
export function listTasks(root) {
  const tasksDir = tasksRoot(root)
  if (!existsSync(tasksDir)) return []
  const found = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(resolve(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name)
      } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
        found.push(prefix ? `${prefix}/${entry.name}` : entry.name)
      }
    }
  }
  walk(tasksDir, '')
  return found.sort()
}

/**
 * 枚举 lib 模块：scripts/lib/*.mjs 文件名 + 头部 JSDoc 摘要首行。
 * @param {string} root 仓库根
 * @returns {{name:string, summary:string}[]}
 */
export function listLibModules(root) {
  const libRoot = resolve(root, 'scripts', 'lib')
  if (!existsSync(libRoot)) return []
  const out = []
  for (const f of readdirSync(libRoot).filter(f => f.endsWith('.mjs')).sort()) {
    const content = readFileSync(resolve(libRoot, f), 'utf-8')
    // 取文件头 `/**` 后首个 ` * 描述` 行作摘要
    const summary = content.match(/^\s*\*\s+([^*].+)$/m)?.[1] ?? ''
    out.push({ name: f.replace(/\.mjs$/, ''), summary })
  }
  return out
}

/**
 * run：解析任务文件绝对路径，仅允许 scripts/tasks/ 目录内。
 * @param {string} root 仓库根
 * @param {string} ref 任务引用，如 "git/head-diff"
 * @returns {{norm:string, target:string}}
 */
export function resolveTaskPath(root, ref) {
  const norm = normalizeTaskRef(ref)
  if (!norm) throw new Error(`非法任务路径：${ref}`)

  const tasksDir = tasksRoot(root)
  const target = resolve(tasksDir, `${norm}.mjs`)
  if (!isInside(tasksDir, target)) {
    throw new Error(`路径越界：拒绝运行 tasks 目录之外的文件（${ref}）`)
  }
  return { norm, target }
}

/**
 * 递归收集 dev-temp 工作区下的全部条目（相对 dev-temp 根的路径）。
 * @param {string} root 仓库根
 * @returns {{rel:string, isDir:boolean}[]}
 */
export function listTmpEntries(root) {
  const tmpRoot = getDevTmpRoot(root)
  if (!existsSync(tmpRoot)) return []
  const entries = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        entries.push({ rel, isDir: true })
        walk(resolve(dir, entry.name), rel)
      } else {
        entries.push({ rel, isDir: false })
      }
    }
  }
  walk(tmpRoot, '')
  return entries
}

/**
 * 收集 tmp clean 的目标：tmpRoot 下的顶层条目（绝不包含仓库根或 dev-temp 根自身）。
 * @param {string} root 仓库根
 * @returns {{rel:string, abs:string}[]}
 */
export function collectTmpCleanTargets(root) {
  const tmpRoot = getDevTmpRoot(root)
  if (!existsSync(tmpRoot)) return []
  return readdirSync(tmpRoot)
    .map(name => ({ rel: name, abs: resolve(tmpRoot, name) }))
    .filter(t => isComparableInside(tmpRoot, t.abs))
}

/**
 * 解析 run-id 目录名前缀时间戳（run-id 格式：时间戳-PID-随机后缀）。
 * @param {string} name 目录名
 * @returns {number|null} 毫秒时间戳；非 run-id 命名返回 null
 */
export function parseRunIdTimestamp(name) {
  const m = /^(\d{13})-/.exec(name)
  if (!m) return null
  const ts = Number(m[1])
  return Number.isFinite(ts) ? ts : null
}

/**
 * 按龄期收集过期 run：递归扫描 dev-temp/runs 下全部 run-id 命名目录（run-id 格式：时间戳-PID-随机）。
 * 支持任务名带域的三层结构（如 runs/git/head-diff/<run-id>）：目录条目若为 run-id 命名且超过
 * cutoff 则收集，否则若是目录则继续下探；work 非 run 目录不受影响。
 * @param {string} root 仓库根
 * @param {number} olderThanDays 超过 N 天视为过期（正整数）
 * @returns {{rel:string, abs:string}[]} 相对 dev-temp 根的路径与绝对路径
 */
export function collectTmpOldRunTargets(root, olderThanDays) {
  const runsRoot = getRunDirRoot(root)
  if (!existsSync(runsRoot)) return []
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  const targets = []
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const ts = parseRunIdTimestamp(entry.name)
      const abs = resolve(dir, entry.name)
      if (!isComparableInside(runsRoot, abs)) continue
      if (ts !== null) {
        if (ts < cutoff) targets.push({ rel: rel ? `${rel}/${entry.name}` : entry.name, abs })
      } else {
        walk(abs, rel ? `${rel}/${entry.name}` : entry.name)
      }
    }
  }
  walk(runsRoot, 'runs')
  return targets
}

// ── 显式清理清单 ──────────────────────────────────────────────

/**
 * 根据操作者明确选择的路径生成清理清单；扫描只计算指纹，不推断分支归属。
 * @param {string} root 仓库根
 * @param {{path:string, snapshot?:string, reason?:string}[]} selections
 * @returns {{schemaVersion:number, entries:{path:string, fingerprint:string, snapshot?:string, reason?:string}[]}}
 */
export function createCleanupManifest(root, selections) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('清理清单至少需要一个明确选择的路径')
  }
  const entries = selections.map((selection) => {
    if (!selection || typeof selection.path !== 'string') throw new Error('清理清单条目缺少 path')
    const target = resolveCleanupTarget(root, selection.path)
    if (!existsSync(target.abs)) throw new Error(`清理目标不存在：${target.rel}`)
    assertSafeTree(target.abs)
    const destination = normalizeDestination(root, selection)
    return { path: target.rel, fingerprint: fingerprintPath(target.abs), ...destination }
  })
  const manifest = { schemaVersion: CLEANUP_MANIFEST_SCHEMA_VERSION, entries }
  validateCleanupManifest(root, manifest)
  return manifest
}

/** 将新清单写入指定路径；拒绝覆盖已有清单，避免误换收尾范围。 */
export function writeCleanupManifest(root, manifestPath, selections) {
  const target = resolveManifestPath(root, manifestPath)
  const manifest = createCleanupManifest(root, selections)
  assertManifestOutsideTargets(root, target, manifest.entries)
  if (existsSync(target)) throw new Error(`清理清单已存在，拒绝覆盖：${target}`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
  return target
}

/**
 * 预览或执行一份显式清理清单。apply 会在每个条目删除前再次执行全部保护检查。
 * @param {string} root 仓库根
 * @param {string} manifestInput 清单路径（可为相对或绝对路径）
 * @param {{apply?:boolean}} [options]
 */
export function cleanWithManifest(root, manifestInput, { apply = false } = {}) {
  const manifestPath = resolveManifestPath(root, manifestInput)
  if (!existsSync(manifestPath)) throw new Error(`清理清单不存在：${manifestPath}`)
  let raw
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (e) {
    throw new Error(`读取清理清单失败：${manifestPath}（${e.message ?? String(e)}）`)
  }
  const manifest = validateCleanupManifest(root, raw)
  return evaluateAndMaybeApplyCleanupManifest(root, manifest, { apply, manifestPath })
}

/**
 * 评估内存中的清理清单，不写入清单文件，也不执行删除。
 * @param {string} root 仓库根
 * @param {{schemaVersion:number,entries:object[]}} manifest 内存清单
 * @param {{manifestPath?:string}} [options] 仅在需要检查清单自身时提供持久路径
 */
export function previewCleanupManifest(root, manifest, { manifestPath } = {}) {
  const validated = validateCleanupManifest(root, manifest)
  const resolvedManifestPath = manifestPath === undefined ? undefined : resolveManifestPath(root, manifestPath)
  return evaluateAndMaybeApplyCleanupManifest(root, validated, { apply: false, manifestPath: resolvedManifestPath })
}

function evaluateAndMaybeApplyCleanupManifest(root, manifest, { apply, manifestPath }) {
  if (manifestPath !== undefined) assertManifestOutsideTargets(root, manifestPath, manifest.entries)
  const results = manifest.entries.map((entry) => evaluateCleanupEntry(root, manifestPath, entry))
  let deleted = 0
  let failures = 0
  for (const result of results) {
    if (result.action !== 'delete') {
      if (result.blocking) failures++
      continue
    }
    if (!apply) continue
    // 指纹、保护条件和 snapshot 状态在真正删除前再检查一次，防止预览期间目标变化。
    const checked = evaluateCleanupEntry(root, manifestPath, result.entry)
    if (checked.action !== 'delete') {
      result.action = 'skip'
      result.reason = checked.reason
      result.blocking = checked.blocking
      if (checked.blocking) failures++
      continue
    }
    try {
      rmSync(checked.abs, { recursive: true, force: false })
      result.action = 'deleted'
      deleted++
    } catch (e) {
      result.action = 'skip'
      result.reason = `删除失败：${e.message ?? String(e)}`
      result.blocking = true
      failures++
    }
  }
  if (apply && failures === 0 && manifestPath !== undefined) {
    unlinkSync(manifestPath)
  }
  return { manifestPath, apply, results, deleted, failures, manifestRemoved: apply && failures === 0 && manifestPath !== undefined }
}

/** @param {string} root @param {unknown} value */
export function validateCleanupManifest(root, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('清理清单格式错误：顶层必须是对象')
  const keys = Object.keys(value).sort()
  if (keys.join('\0') !== ['entries', 'schemaVersion'].join('\0')) throw new Error('清理清单格式错误：顶层字段必须为 schemaVersion、entries')
  if (value.schemaVersion !== CLEANUP_MANIFEST_SCHEMA_VERSION) throw new Error(`不支持的清理清单 schemaVersion：${value.schemaVersion}`)
  if (!Array.isArray(value.entries) || value.entries.length === 0) throw new Error('清理清单格式错误：entries 必须是非空数组')
  const entries = value.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`清理清单第 ${index + 1} 项格式错误`)
    const entryKeys = Object.keys(entry).sort()
    const hasSnapshot = typeof entry.snapshot === 'string'
    const hasReason = typeof entry.reason === 'string'
    if (hasSnapshot === hasReason) throw new Error(`清理清单第 ${index + 1} 项必须且只能有 snapshot 或 reason`)
    const expected = hasSnapshot ? ['fingerprint', 'path', 'snapshot'] : ['fingerprint', 'path', 'reason']
    if (entryKeys.join('\0') !== expected.join('\0')) throw new Error(`清理清单第 ${index + 1} 项字段错误：需要 path、fingerprint 及 snapshot 或 reason`)
    if (typeof entry.path !== 'string' || !entry.path) throw new Error(`清理清单第 ${index + 1} 项 path 无效`)
    if (typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.fingerprint)) throw new Error(`清理清单第 ${index + 1} 项 fingerprint 无效`)
    const target = resolveCleanupTarget(root, entry.path)
    const destination = normalizeDestination(root, entry)
    return { path: target.rel, fingerprint: entry.fingerprint.toLowerCase(), ...destination }
  })
  for (let i = 0; i < entries.length; i++) {
    for (let j = 0; j < i; j++) {
      if (isRelativeInside(entries[j].path, entries[i].path) || isRelativeInside(entries[i].path, entries[j].path) || samePath(entries[j].path, entries[i].path)) {
        throw new Error(`清理清单包含重叠或重复候选：${entries[j].path} / ${entries[i].path}`)
      }
    }
  }
  return { schemaVersion: CLEANUP_MANIFEST_SCHEMA_VERSION, entries }
}

function normalizeDestination(root, selection) {
  if (typeof selection.snapshot === 'string') {
    const snapshot = resolveRepoRelative(root, selection.snapshot, 'snapshot')
    if (!isComparableInside(resolve(root, 'bench', 'results'), snapshot.abs)) throw new Error(`snapshot 必须位于 bench/results/：${snapshot.rel}`)
    return { snapshot: snapshot.rel }
  }
  if (typeof selection.reason === 'string' && selection.reason.trim()) return { reason: redactCleanupText(selection.reason.trim()) }
  throw new Error('清理清单条目必须提供非空 snapshot 或 reason')
}

function resolveManifestPath(root, input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('清理清单路径无效')
  const rootAbs = resolve(root)
  const target = resolve(input)
  const devTempRoot = resolve(rootAbs, 'dev-temp')
  if (!isComparableInside(devTempRoot, target)) {
    throw new Error(`清理清单必须位于仓库内 dev-temp/：${input}`)
  }
  assertNoReparsePoints(rootAbs, target)
  return target
}

function assertManifestOutsideTargets(root, manifestPath, entries) {
  for (const entry of entries) {
    const target = resolveCleanupTarget(root, entry.path)
    if (samePath(target.abs, manifestPath) || isComparableInside(target.abs, manifestPath)) {
      throw new Error(`清理清单必须位于所有候选目标之外：${manifestPath} 位于 ${target.rel} 内`)
    }
  }
}

function resolveCleanupTarget(root, input) {
  const target = resolveRepoRelative(root, input, '清理目标')
  const rel = target.rel
  const devTempRoot = resolve(root, 'dev-temp')
  const benchRunsRoot = resolve(root, 'bench-runs')
  const allowedDevTemp = isComparableInside(devTempRoot, target.abs)
  const benchRelative = relative(benchRunsRoot, target.abs).replace(/\\/g, '/')
  const allowedBenchRuns = isComparableInside(benchRunsRoot, target.abs) && benchRelative.split('/').length === 1
  if (!allowedDevTemp && !allowedBenchRuns) {
    throw new Error(`清理目标不在固定白名单内：${rel}（仅支持 dev-temp/ 内明确路径或 bench-runs 下运行目录）`)
  }
  if (samePath(devTempRoot, target.abs) || samePath(benchRunsRoot, target.abs)) throw new Error(`拒绝清理根目录：${rel}`)
  if (allowedBenchRuns && existsSync(target.abs) && !lstatSync(target.abs).isDirectory()) throw new Error(`bench-runs 目标必须是运行目录：${rel}`)
  return target
}

function resolveRepoRelative(root, input, label) {
  if (typeof input !== 'string' || !input.trim() || isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input) || input.replace(/\\/g, '/').startsWith('/')) throw new Error(`${label}必须是仓库相对路径：${input}`)
  const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '')
  const abs = resolve(root, normalized)
  const rel = relative(resolve(root), abs).replace(/\\/g, '/')
  if (!rel || rel.startsWith('../') || rel === '..') throw new Error(`${label}路径越界：${input}`)
  return { rel, abs }
}

function isRelativeInside(parent, child) {
  return isComparableInside(parent, child)
}

function redactCleanupText(value) {
  return value
    .replace(/((?:api[_-]?key|authorization|secret|password|token)\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, '$1[已脱敏]')
    .replace(/\b(?:sk|dashscope|tokenhub)-[A-Za-z0-9_-]{4,}\b/gi, '[已脱敏]')
}

function assertSafeTree(abs) {
  let current = abs
  while (current && existsSync(current)) {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error(`目标包含符号链接或 junction，拒绝清理：${abs}`)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const stat = lstatSync(abs)
  if (!stat.isDirectory()) return
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = join(abs, entry.name)
    const childStat = lstatSync(child)
    if (childStat.isSymbolicLink()) throw new Error(`目标包含符号链接或 junction，拒绝清理：${child}`)
    if (childStat.isDirectory()) assertSafeTree(child)
  }
}

function assertNoReparsePoints(root, abs) {
  let current = abs
  const rootAbs = resolve(root)
  while (current && isComparableInside(rootAbs, current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`路径包含符号链接或 junction，拒绝使用：${abs}`)
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

/** 指纹覆盖文件内容、目录结构和条目类型。 */
export function fingerprintPath(abs) {
  const hash = createHash('sha256')
  const walk = (path, rel) => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`目标包含符号链接或 junction，无法计算指纹：${path}`)
    if (stat.isDirectory()) {
      hash.update(`D:${rel}\n`)
      for (const name of readdirSync(path).sort()) walk(join(path, name), rel ? `${rel}/${name}` : name)
    } else if (stat.isFile()) {
      hash.update(`F:${rel}:${stat.size}\n`)
      hash.update(readFileSync(path))
    } else {
      throw new Error(`目标包含不支持的文件类型：${path}`)
    }
  }
  walk(abs, '')
  return hash.digest('hex')
}

function pathStats(abs) {
  const stat = lstatSync(abs)
  if (stat.isSymbolicLink()) throw new Error(`目标包含符号链接或 junction：${abs}`)
  if (stat.isFile()) return { files: 1, bytes: stat.size }
  if (!stat.isDirectory()) throw new Error(`目标包含不支持的文件类型：${abs}`)
  return readdirSync(abs).reduce((total, name) => {
    const child = pathStats(join(abs, name))
    return { files: total.files + child.files, bytes: total.bytes + child.bytes }
  }, { files: 0, bytes: 0 })
}

function hasKeepMarker(abs, root) {
  if (sameName(basename(abs), '.keep')) return true
  let current = lstatSync(abs).isDirectory() ? abs : dirname(abs)
  const repoRoot = resolve(root)
  while (samePath(repoRoot, current) || isComparableInside(repoRoot, current)) {
    if (readdirSync(current).some((name) => sameName(name, '.keep'))) return true
    if (samePath(repoRoot, current)) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const walk = (path) => {
    if (sameName(basename(path), '.keep')) return true
    const stat = lstatSync(path)
    if (!stat.isDirectory()) return false
    return readdirSync(path).some((name) => walk(join(path, name)))
  }
  return walk(abs)
}

function isTracked(root, rel) {
  const target = normalizeComparablePath(resolve(root, rel))
  try {
    const output = execFileSync('git', ['ls-files', '-z', '--'], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
    return output.split('\0')
      .filter(Boolean)
      .some((tracked) => {
        const trackedPath = normalizeComparablePath(resolve(root, tracked))
        return trackedPath === target || isComparableInside(target, trackedPath)
      })
  } catch (e) {
    const detail = e?.message ?? String(e)
    throw new Error(`无法确认 Git 跟踪状态，拒绝清理：${rel}（${detail}）`)
  }
}

function isDirty(root, rel) {
  try {
    const output = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', rel], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    return output.trim() !== ''
  } catch {
    return true
  }
}

function snapshotReady(root, rel) {
  const target = resolve(root, rel)
  if (!existsSync(target)) return 'snapshot 不存在'
  if (!lstatSync(target).isFile()) return 'snapshot 不是文件'
  if (!isTracked(root, rel)) return 'snapshot 尚未提交'
  if (isDirty(root, rel)) return 'snapshot 工作区有改动'
  return null
}

function runCompleted(abs, root) {
  const benchRunsRoot = resolve(root, 'bench-runs')
  if (samePath(benchRunsRoot, abs) || isComparableInside(benchRunsRoot, abs)) {
    return existsSync(join(abs, 'meta.json'))
  }
  const runsRoot = resolve(root, 'dev-temp', 'runs')
  if (!samePath(runsRoot, abs) && !isComparableInside(runsRoot, abs)) return true
  const relativeToRuns = relative(runsRoot, abs).replace(/\\/g, '/')
  // runs/task 是集合目录，无法从其自身证明每个 run 都已结束；必须选择具体 run 目录。
  if (!relativeToRuns || relativeToRuns.split('/').length < 2) return false
  let current = lstatSync(abs).isDirectory() ? abs : dirname(abs)
  while (samePath(runsRoot, current) || isComparableInside(runsRoot, current)) {
    if (existsSync(join(current, 'result.json'))) return true
    if (samePath(runsRoot, current)) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return false
}

function samePath(left, right) {
  return normalizeComparablePath(left) === normalizeComparablePath(right)
}

function sameName(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function normalizeComparablePath(path) {
  const normalized = resolve(path).replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isComparableInside(parent, child) {
  const rel = relative(normalizeComparablePath(parent), normalizeComparablePath(child)).replace(/\\/g, '/')
  return rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
}

function evaluateCleanupEntry(root, manifestPath, entry) {
  const target = resolveCleanupTarget(root, entry.path)
  const base = { entry, path: target.rel, abs: target.abs, files: 0, bytes: 0, destination: entry.snapshot ? `提取至 ${entry.snapshot}` : `舍弃：${entry.reason}`, action: 'skip', reason: '', blocking: false }
  if (manifestPath !== undefined && samePath(target.abs, manifestPath)) return { ...base, reason: '清理清单自身不得成为删除目标', blocking: true }
  if (!existsSync(target.abs)) return { ...base, reason: '目标已不存在', blocking: false }
  try {
    assertSafeTree(target.abs)
    if (isTracked(root, target.rel)) return { ...base, reason: 'Git 跟踪文件受保护', blocking: true }
    if (hasKeepMarker(target.abs, root)) return { ...base, reason: '候选或其祖先/后代存在 .keep，受保护', blocking: true }
    if (!runCompleted(target.abs, root)) return { ...base, reason: '未找到结束产物 result.json，无法确认运行已停止', blocking: true }
    if (entry.snapshot) {
      const snapshotProblem = snapshotReady(root, entry.snapshot)
      if (snapshotProblem) return { ...base, reason: snapshotProblem, blocking: true }
    }
    if (fingerprintPath(target.abs) !== entry.fingerprint) return { ...base, reason: '指纹已变化', blocking: true }
    const stats = pathStats(target.abs)
    return { ...base, ...stats, action: 'delete' }
  } catch (e) {
    return { ...base, reason: e.message ?? String(e), blocking: true }
  }
}

function printCleanupResults(summary) {
  const mode = summary.apply ? 'apply' : 'dry-run'
  console.log(`[${mode}] ${summary.manifestPath ? `清理清单：${summary.manifestPath}` : '内存预览（未写入清单文件）'}`)
  for (const result of summary.results) {
    if (result.action === 'delete' || result.action === 'deleted') {
      console.log(`  - ${result.path}（${result.files} 个文件，${result.bytes} 字节；${result.destination}）${result.action === 'deleted' ? '：已删除' : ''}`)
    } else {
      console.log(`  - ${result.path}（跳过：${result.reason}）`)
    }
  }
  if (summary.apply) console.log(summary.manifestRemoved ? `清理完成：删除 ${summary.deleted} 项，已移除清单` : `清理部分完成：删除 ${summary.deleted} 项，清单保留以便重试`)
  else console.log(`预览完成：可删除 ${summary.results.filter((result) => result.action === 'delete').length} 项；真实删除需 --manifest <path> --apply`)
}

// ── CLI（只负责参数解析与退出码） ──────────────────────────────

function usage() {
  console.log(`开发脚本工具

用法：
  node scripts/tooling.mjs <命令> [参数...]

命令：
  list                     列出 scripts/tasks/ 下的可运行任务（目录发现）
  list --lib               列出 scripts/lib/ 共享基元（文件名 + 头部摘要，能力发现）
  run <task> -- <args...>  以独立 Node 子进程运行任务，args 透传给任务
  tmp path                 显示仓库内开发工作区根路径（dev-temp/）
  tmp list                 列出 dev-temp/runs|work 内容
  tmp manifest --out <path> (--snapshot <path> | --reason <text>) <target...>
                           按明确选择生成清单并计算指纹
  tmp clean --manifest <path> [--apply]
                           按显式 JSON 清单预览或删除 dev-temp/、bench-runs/ 目标；
                           默认 dry-run，--apply 才真实删除
  tmp clean (--snapshot <path> | --reason <text>) <target...>
                           在内存生成清单并预览，不写文件、不支持 --apply

退出码：0 成功 / 1 一般错误 / 2 参数错误`)
}

function fail(message, code = EXIT_ERROR) {
  console.error(`错误：${message}`)
  process.exit(code)
}

function failUsage(message) {
  console.error(`用法错误：${message}`)
  process.exit(EXIT_USAGE)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    usage()
    process.exit(EXIT_USAGE)
  }

  // run 命令的任务参数可能以 `-` 开头（如 --scope/--iterations），且经包管理器 script
  // 或 shell 别名调用时 `--` 分隔符可能被中间层消费，因此 run 命令完全绕过 parseArgs 的 strict 校验，
  // 任务名之后（含可选显式 `--`）的参数原样透传给任务脚本。
  if (argv[0] === 'run') {
    const task = argv[1]
    if (!task) failUsage('run 缺少任务名（tooling run <task> -- <args...>）')
    let taskArgs = argv.slice(2)
    if (taskArgs[0] === '--') taskArgs = taskArgs.slice(1) // 直调时的显式分隔
    try {
      const { target } = resolveTaskPath(CLI_ROOT, task)
      if (!existsSync(target)) {
        fail(`任务不存在：${task}（可用 tooling list 查看）`)
      }
      process.exit(await runStreaming(process.execPath, [target, ...taskArgs]))
    } catch (e) {
      fail(e.message ?? String(e))
    }
  }

  let values
  let positionals
  try {
    ;({ values, positionals } = parseArgs({
      args: argv,
      options: {
        apply: { type: 'boolean', default: false },
        lib: { type: 'boolean', default: false },
        'older-than': { type: 'string' },
        manifest: { type: 'string' },
        out: { type: 'string' },
        snapshot: { type: 'string' },
        reason: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    }))
  } catch (e) {
    failUsage(`${e.message}；向任务传参请使用：tooling run <task> -- <args...>`)
  }

  const [cmd, ...rest] = positionals
  if (!cmd) {
    usage()
    process.exit(EXIT_USAGE)
  }

  try {
    switch (cmd) {
      case 'list': {
        if (values.lib) {
          // 能力发现：列出 scripts/lib/ 共享基元（文件名 + 头部摘要），不 import 任何模块
          const mods = listLibModules(CLI_ROOT)
          if (mods.length === 0) {
            console.log('（scripts/lib/ 下无模块）')
          } else {
            for (const m of mods) console.log(`${m.name} — ${m.summary}`)
          }
          break
        }
        const tasks = listTasks(CLI_ROOT)
        if (tasks.length === 0) {
          console.log('（暂无任务：scripts/tasks/ 尚未注册任何任务）')
        } else {
          for (const t of tasks) console.log(t)
        }
        break
      }

      case 'tmp': {
        const sub = rest[0] ?? ''
        const tmpRoot = getDevTmpRoot(CLI_ROOT)
        if (sub === 'manifest') {
          const targets = rest.slice(1)
          if (!values.out) failUsage('tmp manifest 需要 --out <path>')
          if ((values.snapshot === undefined) === (values.reason === undefined)) failUsage('tmp manifest 需要且只能指定 --snapshot 或 --reason')
          if (targets.length === 0) failUsage('tmp manifest 至少需要一个目标路径')
          const selections = targets.map((path) => values.snapshot !== undefined
            ? { path, snapshot: values.snapshot }
            : { path, reason: values.reason })
          const manifestPath = writeCleanupManifest(CLI_ROOT, values.out, selections)
          console.log(`已生成清理清单：${manifestPath}`)
        } else if (sub === 'path') {
          console.log(tmpRoot)
        } else if (sub === 'list') {
          if (!existsSync(tmpRoot)) {
            console.log('（dev-temp/ 尚未创建）')
          } else {
            const entries = listTmpEntries(CLI_ROOT)
            if (entries.length === 0) {
              console.log('（dev-temp/ 下无内容）')
            } else {
              for (const e of entries) {
                console.log(`${e.isDir ? '[目录] ' : '[文件] '}${e.rel}`)
              }
            }
          }
        } else if (sub === 'clean') {
          if (values.manifest !== undefined && rest.length !== 1) failUsage('tmp clean --manifest 不能同时接收直接目标路径')
          if (values.manifest !== undefined && (values.reason !== undefined || values.snapshot !== undefined)) {
            failUsage('tmp clean --manifest 不能同时使用 --reason 或 --snapshot')
          }
          if (values.apply && values.manifest === undefined) {
            if (values.reason !== undefined || values.snapshot !== undefined || rest.length > 1) {
              failUsage('tmp clean 直接路径只支持内存预览，不支持 --apply；请先用 tmp manifest 保存持久清单')
            }
            failUsage('tmp clean --apply 必须使用 --manifest <path>')
          }
          if (values.manifest !== undefined) {
            if (values['older-than'] !== undefined) failUsage('--manifest 与 --older-than 不能同时使用')
            const summary = cleanWithManifest(CLI_ROOT, values.manifest, { apply: values.apply })
            printCleanupResults(summary)
            if (summary.failures > 0) process.exitCode = EXIT_ERROR
            break
          }
          if (values['older-than'] !== undefined && (values.reason !== undefined || values.snapshot !== undefined || rest.length > 1)) {
            failUsage('--older-than 不能同时使用直接预览参数或目标路径')
          }
          if (values.reason !== undefined || values.snapshot !== undefined) {
            if ((values.reason === undefined) === (values.snapshot === undefined)) {
              failUsage('tmp clean 直接预览需要且只能指定 --snapshot 或 --reason')
            }
            const targets = rest.slice(1)
            if (targets.length === 0) failUsage('tmp clean 直接预览至少需要一个目标路径')
            const selections = targets.map((path) => values.snapshot !== undefined
              ? { path, snapshot: values.snapshot }
              : { path, reason: values.reason })
            const summary = previewCleanupManifest(CLI_ROOT, createCleanupManifest(CLI_ROOT, selections))
            printCleanupResults(summary)
            if (summary.failures > 0) process.exitCode = EXIT_ERROR
            break
          }
          if (rest.length > 1) failUsage('tmp clean 直接目标路径必须同时指定 --snapshot 或 --reason')
          // --older-than <n>：只按龄期淘汰 dev-temp/runs 下过期 run；否则全清顶层条目
          if (values['older-than'] !== undefined) {
            const days = Number(values['older-than'])
            if (!Number.isInteger(days) || days <= 0) {
              failUsage('--older-than 需要正整数（天）')
            }
            const targets = collectTmpOldRunTargets(CLI_ROOT, days)
            if (targets.length === 0) {
              console.log(`dev-temp/runs 下无超过 ${days} 天的 run 可清理`)
              break
            }
            console.log(`[dry-run] 将清理 ${targets.length} 个过期 run（如需删除请先用 tmp manifest 生成持久清单）：`)
            for (const t of targets) console.log(`  - ${t.rel}`)
            break
          }
          const targets = collectTmpCleanTargets(CLI_ROOT)
          if (targets.length === 0) {
            console.log('dev-temp/ 下无内容可清理')
            break
          }
          console.log(`[dry-run] 将清理 ${targets.length} 个顶层条目（真实删除需 --manifest <path> --apply）：`)
          for (const t of targets) console.log(`  - ${t.rel}`)
        } else {
          failUsage('tmp 需要子命令：path | list | manifest | clean')
        }
        break
      }

      default:
        usage()
        process.exit(EXIT_USAGE)
    }
  } catch (e) {
    fail(e.message ?? String(e))
  }
}

// 大小写不敏感判定直接调用：import.meta.url 与 argv[1] 分别 resolve 后归一比对，兼容 Windows 盘符大小写
const isMain =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()
if (isMain) {
  main()
}
