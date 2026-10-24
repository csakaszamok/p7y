import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    // Claude Code's worktrees (.claude/worktrees) hold other branches' copies of the tests
    exclude: [...configDefaults.exclude, '.claude/**'],
  }
})
