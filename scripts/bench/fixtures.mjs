import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

// Benchmark fixtures: the canonical seed company and a deterministic large company, written
// straight into the stopped server's SQLite file.

const snake = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** Insert camelCase rows into a table, JSON-encoding structured values like the app does. */
function insertRows(database, table, rows) {
  if (rows.length === 0) return;
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);
  const now = new Date().toISOString();
  const statement = database.prepare(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  );
  for (const row of rows) {
    const flat = Object.fromEntries(Object.entries(row).map(([key, value]) => [snake(key), value]));
    flat.created_at ??= now;
    flat.updated_at ??= now;
    statement.run(
      ...columns.map((column) => {
        const value = flat[column];
        if (value === undefined || value === null) return null;
        return typeof value === 'object' || typeof value === 'boolean'
          ? JSON.stringify(value)
          : value;
      }),
    );
  }
}

const FIRST = [
  'Bruce',
  'Clark',
  'Diana',
  'Barry',
  'Arthur',
  'Hal',
  'Oliver',
  'Dinah',
  'Selina',
  'Dick',
  'Tony',
  'Steve',
  'Natasha',
  'Wanda',
  'Peter',
  'Carol',
  'Scott',
  'Hope',
  'Stephen',
  'Sam',
];
const LAST = [
  'Wayne',
  'Kent',
  'Prince',
  'Allen',
  'Curry',
  'Jordan',
  'Queen',
  'Lance',
  'Kyle',
  'Grayson',
  'Stark',
  'Rogers',
  'Romanoff',
  'Maximoff',
  'Parker',
  'Danvers',
  'Lang',
  'van Dyne',
  'Strange',
  'Wilson',
];
const PROJECTS = [
  'Wakanda Portal',
  'Gotham Rail Timetable',
  'Metropolis Dashboard',
  'Asgard Booking',
  'Themyscira Shop',
  'Atlantis Mobile',
  'Latveria Intranet',
  'Star City Website',
  'Central City Tracker',
  'Sokovia Rebrand',
];

/** Deterministic generator so every run measures the same data. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

export function buildLarge(accountId) {
  const next = random(1735);
  const pick = (n) => Math.floor(next() * n);
  const colours = ['#2d75da', '#da2d92', '#e02727', '#1f9d55', '#e0a100', '#7a4dd8'];
  const disciplines = ['Design', 'Engineering', 'Delivery', 'Strategy'].map((name, sortOrder) => ({
    id: randomUUID(),
    accountId,
    name,
    color: colours[sortOrder],
    sortOrder,
  }));
  const clients = Array.from({ length: 8 }, (_, index) => ({
    id: randomUUID(),
    accountId,
    name: `${LAST[index]} Holdings`,
    color: colours[index % colours.length],
  }));
  const projects = Array.from({ length: 40 }, (_, index) => ({
    id: randomUUID(),
    accountId,
    name: `${PROJECTS[index % PROJECTS.length]} ${Math.floor(index / PROJECTS.length) + 1}`,
    clientId: clients[index % clients.length].id,
    color: colours[index % colours.length],
  }));
  const phases = projects.map((project) => ({
    id: randomUUID(),
    accountId,
    name: 'Build',
    projectId: project.id,
  }));
  const resources = Array.from({ length: 60 }, (_, index) => ({
    id: randomUUID(),
    accountId,
    kind: 'person',
    name: `${FIRST[index % FIRST.length]} ${LAST[Math.floor(index / FIRST.length) + (index % 3)]}`,
    role: 'Designer',
    avatarUrl: null,
    disciplineId: disciplines[index % disciplines.length].id,
    employmentType: 'permanent',
    engagement: 'studio',
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: disciplines[index % disciplines.length].color,
  }));
  const activities = projects.flatMap((project, index) =>
    ['Discovery', 'Build', 'Review'].map((name) => ({
      id: randomUUID(),
      accountId,
      name,
      kind: 'project',
      projectId: project.id,
      phaseId: name === 'Build' ? phases[index].id : null,
    })),
  );
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 26 * 7);
  const dayAt = (week, day) => isoDay(new Date(monday.getTime() + (week * 7 + day) * 86_400_000));
  const allocations = Array.from({ length: 30_000 }, (_, index) => {
    const start = pick(5);
    const week = pick(104);
    return {
      id: randomUUID(),
      accountId,
      resourceId: resources[index % resources.length].id,
      activityId: activities[pick(activities.length)].id,
      startDate: dayAt(week, start),
      endDate: dayAt(week, start + pick(5 - start)),
      hoursPerDay: 1 + pick(4) * 0.5,
      status: next() < 0.8 ? 'confirmed' : 'tentative',
    };
  });
  const types = ['holiday', 'sick', 'unpaid', 'other'];
  const timeOff = Array.from({ length: 2000 }, (_, index) => {
    const start = pick(5);
    const week = pick(104);
    return {
      id: randomUUID(),
      accountId,
      resourceId: resources[index % resources.length].id,
      startDate: dayAt(week, start),
      endDate: dayAt(week, start + pick(5 - start)),
      type: types[pick(4)],
    };
  });
  return {
    clients,
    disciplines,
    projects,
    phases,
    resources,
    activities,
    allocations,
    time_off: timeOff,
  };
}

export async function buildSeed(backend, accountId) {
  const { seed } = await import(
    pathToFileURL(
      join(backend, 'node_modules', '@capacitylens', 'shared', 'dist', 'data', 'seed.js'),
    ).href
  );
  const data = seed();
  const own = (rows) =>
    rows.filter((row) => row.accountId === 'a-studio').map((row) => ({ ...row, accountId }));
  return {
    // The company's own built-in client already exists; no seed project references it.
    clients: own(data.clients).filter((row) => row.builtin !== true),
    disciplines: own(data.disciplines),
    projects: own(data.projects),
    phases: own(data.phases),
    resources: own(data.resources),
    activities: own(data.activities),
    allocations: own(data.allocations),
    time_off: own(data.timeOff),
    closures: own(data.closures),
  };
}

export function writeFixture(databasePath, accountId, tables) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('BEGIN');
    for (const table of [
      'clients',
      'disciplines',
      'projects',
      'phases',
      'resources',
      'activities',
      'allocations',
      'time_off',
      'closures',
    ])
      insertRows(database, table, tables[table] ?? []);
    database
      .prepare('UPDATE company_planning_revisions SET revision = revision + 1 WHERE account_id = ?')
      .run(accountId);
    database.exec('COMMIT');
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    database.close();
  }
}
