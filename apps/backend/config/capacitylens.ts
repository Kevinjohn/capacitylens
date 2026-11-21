import env from '#start/env';

// Getters read the environment at call time: tests change these values with `env.set(...)`.
const capacitylens = {
  /** Whether a visitor may create an account without an invitation. */
  get allowOpenSignUp() {
    return env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP');
  },
  /** The folder that holds database backups. */
  get backupDirectory() {
    return env.get('CAPACITYLENS_BACKUP_DIR');
  },
  /** Whether request and sign-in outcome logging is on. */
  get requestLogging() {
    return env.get('CAPACITYLENS_LOG') === '1';
  },
  /** The configured API request limit, unparsed. */
  get rateLimit() {
    return env.get('CAPACITYLENS_RATE_LIMIT');
  },
  /** The date that replaces today, for tests and demonstrations. */
  get fixedToday() {
    return env.get('CAPACITYLENS_FIXED_TODAY');
  },
  /** Whether the development bootstrap creates the administrator account. */
  get createAdmin() {
    return env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN');
  },
  /** The password the development bootstrap gives the administrator account. */
  get bootstrapAdminPassword() {
    return env.get('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD');
  },
  /** The SQLite database file path. */
  get databasePath() {
    return env.get('CAPACITYLENS_DB');
  },
  /** The SMTP host; mail is configured only when it is set. */
  get mailHost() {
    return env.get('CAPACITYLENS_MAIL_HOST');
  },
  /** Whether the browser-test reset harness may run; production refuses it. */
  get allowReset() {
    return env.get('CAPACITYLENS_ALLOW_RESET');
  },
};

export default capacitylens;
