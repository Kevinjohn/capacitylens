// Shared-package tests run in a plain Node environment (pure logic, no DOM).
export default {
  test: {
    environment: 'node',
    env: { TZ: 'UTC' },
    include: ['src/**/*.test.ts'],
  },
}
