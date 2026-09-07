import { defineConfig } from 'vitest/config'

/** 独立 A/B 副本和 pnpm store 是现场产物，不应被根测试重复收集。 */
export default defineConfig({
  test: {
    include: [
      'bench/tests/**/*.test.ts',
      'bench/tests/**/*.test.mjs',
      'scripts/**/*.test.mjs',
    ],
    exclude: [
      '**/node_modules/**',
      '**/.pnpm-store/**',
      '**/dev-temp/**',
      '**/dist/**',
    ],
  },
})
