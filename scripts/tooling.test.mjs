import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanWithManifest, createCleanupManifest, writeCleanupManifest } from './tooling.mjs'

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rag-tooling-clean-'))
  execFileSync('git', ['init', '--quiet', root])
  return root
}

describe('tooling 显式清理清单', () => {
  it('默认预览不改目标，apply 删除目标并移除清单', () => {
    const root = tempRoot()
    try {
      const target = join(root, 'dev-temp', 'work', 'answer.txt')
      mkdirSync(join(root, 'dev-temp', 'work'), { recursive: true })
      writeFileSync(target, 'answer')
      const manifest = join(root, 'dev-temp', 'cleanup-test.json')
      writeCleanupManifest(root, manifest, [{ path: 'dev-temp/work/answer.txt', reason: '已提取' }])

      const preview = cleanWithManifest(root, manifest)
      expect(preview.results[0]).toMatchObject({ action: 'delete', files: 1, bytes: 6 })
      expect(existsSync(target)).toBe(true)

      const applied = cleanWithManifest(root, manifest, { apply: true })
      expect(applied).toMatchObject({ deleted: 1, manifestRemoved: true })
      expect(existsSync(target)).toBe(false)
      expect(existsSync(manifest)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('指纹变化、.keep 和未结束 run 均跳过，越界与重叠候选拒绝', () => {
    const root = tempRoot()
    try {
      mkdirSync(join(root, 'dev-temp', 'work'), { recursive: true })
      writeFileSync(join(root, 'dev-temp', 'work', 'changed.txt'), 'before')
      expect(() => createCleanupManifest(root, [{ path: 'package.json', reason: '越界白名单' }])).toThrow('固定白名单')
      expect(() => createCleanupManifest(root, [
        { path: 'dev-temp/work', reason: '父' },
        { path: 'dev-temp/work/changed.txt', reason: '子' },
      ])).toThrow('重叠')

      const changedManifest = join(root, 'dev-temp', 'changed.json')
      writeCleanupManifest(root, changedManifest, [{ path: 'dev-temp/work/changed.txt', reason: '变化' }])
      writeFileSync(join(root, 'dev-temp', 'work', 'changed.txt'), 'after')
      expect(cleanWithManifest(root, changedManifest).results[0]).toMatchObject({ action: 'skip', reason: '指纹已变化' })

      writeFileSync(join(root, 'dev-temp', 'work', '.keep'), '')
      const keepManifest = join(root, 'dev-temp', 'keep.json')
      writeCleanupManifest(root, keepManifest, [{ path: 'dev-temp/work', reason: '保护' }])
      expect(cleanWithManifest(root, keepManifest).results[0].reason).toContain('.keep')

      const run = join(root, 'dev-temp', 'runs', 'task', 'run-1')
      mkdirSync(run, { recursive: true })
      writeFileSync(join(run, 'out.txt'), 'x')
      const runManifest = join(root, 'dev-temp', 'run.json')
      writeCleanupManifest(root, runManifest, [{ path: 'dev-temp/runs/task/run-1', reason: '运行' }])
      expect(cleanWithManifest(root, runManifest).results[0].reason).toContain('结束产物')

      const collectionManifest = join(root, 'dev-temp', 'runs-collection.json')
      writeCleanupManifest(root, collectionManifest, [{ path: 'dev-temp/runs', reason: '运行集合' }])
      expect(cleanWithManifest(root, collectionManifest).results[0].reason).toContain('结束产物')

      const benchRun = join(root, 'bench-runs', 'run-1')
      mkdirSync(benchRun, { recursive: true })
      writeFileSync(join(benchRun, 'records.jsonl'), '')
      const benchManifest = join(root, 'dev-temp', 'bench.json')
      writeCleanupManifest(root, benchManifest, [{ path: 'bench-runs/run-1', reason: '基准运行' }])
      expect(cleanWithManifest(root, benchManifest).results[0].reason).toContain('结束产物')
      writeFileSync(join(benchRun, 'meta.json'), '{}')
      const completedBenchManifest = join(root, 'dev-temp', 'bench-completed.json')
      writeCleanupManifest(root, completedBenchManifest, [{ path: 'bench-runs/run-1', reason: '基准运行' }])
      expect(cleanWithManifest(root, completedBenchManifest).results[0].action).toBe('delete')

      const tracked = join(root, 'dev-temp', 'work', 'protected.txt')
      writeFileSync(tracked, 'tracked')
      execFileSync('git', ['add', '--', 'dev-temp/work/protected.txt'], { cwd: root })
      const caseManifest = join(root, 'dev-temp', 'case.json')
      writeCleanupManifest(root, caseManifest, [{ path: 'dev-temp/work/PROTECTED.txt', reason: '大小写' }])
      expect(cleanWithManifest(root, caseManifest).results[0].reason).toContain('Git 跟踪')

      const trackedChild = join(root, 'dev-temp', 'work', 'tracked-dir', 'child.txt')
      mkdirSync(join(root, 'dev-temp', 'work', 'tracked-dir'), { recursive: true })
      writeFileSync(trackedChild, 'tracked child')
      execFileSync('git', ['add', '--', 'dev-temp/work/tracked-dir/child.txt'], { cwd: root })
      const trackedDirectoryManifest = join(root, 'dev-temp', 'tracked-directory.json')
      writeCleanupManifest(root, trackedDirectoryManifest, [{ path: 'dev-temp/work/tracked-dir', reason: '目录跟踪' }])
      expect(cleanWithManifest(root, trackedDirectoryManifest).results[0].reason).toContain('Git 跟踪')

      writeFileSync(join(root, '.keep'), '')
      writeFileSync(join(root, 'dev-temp', 'work', 'root-protected.txt'), 'root')
      const rootKeepManifest = join(root, 'dev-temp', 'root-keep.json')
      writeCleanupManifest(root, rootKeepManifest, [{ path: 'dev-temp/work/root-protected.txt', reason: '根保护' }])
      expect(cleanWithManifest(root, rootKeepManifest).results[0].reason).toContain('.keep')

      const gitFailureTarget = join(root, 'dev-temp', 'work', 'git-failure.txt')
      writeFileSync(gitFailureTarget, 'git failure')
      const gitFailureManifest = join(root, 'dev-temp', 'git-failure.json')
      writeCleanupManifest(root, gitFailureManifest, [{ path: 'dev-temp/work/git-failure.txt', reason: 'Git 失败' }])
      rmSync(join(root, '.git'), { recursive: true, force: true })
      expect(cleanWithManifest(root, gitFailureManifest).results[0].reason).toContain('无法确认 Git 跟踪状态')

      expect(() => writeCleanupManifest(root, join(root, '..', 'outside.json'), [{ path: 'dev-temp/work/changed.txt', reason: '越界清单' }])).toThrow('dev-temp')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('无清单时只允许预览，不允许旧入口直接 apply 删除', () => {
    const result = spawnSync(process.execPath, ['./scripts/tooling.mjs', 'tmp', 'clean', '--apply'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf-8',
    })
    expect(result.status).toBe(2)
    expect(`${result.stdout}\n${result.stderr}`).toContain('--manifest')
  })
})
