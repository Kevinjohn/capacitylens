/**
 * Build the isolated environment shared by the access-lab setup, API and web processes.
 * Preserve process essentials (PATH, locale, terminal), but strip every account/CapacityLens/Auth/
 * Vite deployment input before applying the fixed loopback-only lab posture.
 *
 * @param {NodeJS.ProcessEnv} inherited
 * @param {{ apiPort: number, webPort: number }} ports
 * @returns {NodeJS.ProcessEnv}
 */
export function buildAccessLabEnv(inherited, { apiPort, webPort }) {
  const env = { ...inherited }
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('SMALLSASS_ACCOUNT_') ||
      key.startsWith('CAPACITYLENS_') ||
      key.startsWith('BETTER_AUTH_') ||
      key.startsWith('VITE_CAPACITYLENS_')
    ) {
      delete env[key]
    }
  }
  return Object.assign(env, {
    NODE_ENV: 'development',
    PORT: String(apiPort),
    CAPACITYLENS_HOST: '127.0.0.1',
    CAPACITYLENS_DB: '.access-lab.db',
    SMALLSASS_ACCOUNT_MODE: 'password',
    SMALLSASS_ACCOUNT_REQUIRE_MFA: '0',
    CAPACITYLENS_ALLOW_RESET: '0',
    CAPACITYLENS_MULTI_ACCOUNT: '0',
    CAPACITYLENS_SEED_DEMO: '0',
    CAPACITYLENS_HTTPS: '0',
    SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK: 'off',
    SMALLSASS_ACCOUNT_SETUP_TOKEN: 'access-lab-setup-token-0123456789abcdef',
    CAPACITYLENS_AUDIT: 'off',
    SMALLSASS_ACCOUNT_SECRET: 'capacitylens-access-lab-secret-0123456789abcdef',
    SMALLSASS_ACCOUNT_PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
    CAPACITYLENS_CORS_ORIGIN: `http://localhost:${webPort},http://127.0.0.1:${webPort}`,
    VITE_CAPACITYLENS_DEMO: '0',
    VITE_CAPACITYLENS_API: '',
  })
}
