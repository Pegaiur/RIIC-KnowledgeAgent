import { describe, expect, it } from 'vitest'
import { validateBenchmarkIntegrity } from '../src/benchmark-integrity.js'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\')

describe('20 题基准完整性', () => {
  it('questions、gold、spec 与 manifest/实际切块完全对齐', () => {
    expect(validateBenchmarkIntegrity(ROOT)).toMatchObject({
      questionCount: 20,
      goldCount: 20,
      specCount: 20,
      corpusFileCount: 31,
    })
  })
})
