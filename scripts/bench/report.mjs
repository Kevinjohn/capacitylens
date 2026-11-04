import { spawnSync } from 'node:child_process';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { ms } from './statistics.mjs';

function gitSha(repositoryRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

/** Render the measured fixtures as the Markdown report printed on stdout. */
export function renderReport(options, measured, repositoryRoot) {
  const lines = [
    '# Planning benchmark',
    '',
    `- Harness Git SHA: ${gitSha(repositoryRoot)} (the measured backend is the packaged artifact below)`,
    `- Node: ${process.version}`,
    `- OS: ${platform()} ${release()} ${arch()}`,
    `- CPU: ${cpus()[0]?.model ?? 'unknown'} x${cpus().length}`,
    `- Memory: ${(totalmem() / 2 ** 30).toFixed(1)} GiB`,
    `- Backend: ${options.backend.replace(repositoryRoot, '.')}`,
    `- Warm-up ${options.warmup}, samples ${options.samples}, sequential requests over loopback`,
    '',
    '| Fixture | Operation | p50 ms | p95 ms | max ms | Response bytes | SQL statements |',
    '|---|---|---:|---:|---:|---:|---:|',
  ];
  for (const { name, results } of measured)
    for (const [label, row] of Object.entries(results))
      lines.push(
        `| ${name} | ${label} | ${ms(row.p50)} | ${ms(row.p95)} | ${ms(row.max)} | ${row.bytes} | ${row.statements === null ? 'not measured' : row.statements} |`,
      );
  lines.push(
    '',
    '| Fixture | Resources | Projects | Activities | Allocations | Time off |',
    '|---|---:|---:|---:|---:|---:|',
  );
  for (const { name, counts } of measured)
    lines.push(
      `| ${name} | ${counts.resources} | ${counts.projects} | ${counts.activities} | ${counts.allocations} | ${counts.timeOff} |`,
    );
  return lines.join('\n');
}
