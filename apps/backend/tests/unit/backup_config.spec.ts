import { test } from '@japa/runner';
import { parseBackupConfig, MAX_BACKUP_KEEP } from '#config/backup';

test('backup config disables without a directory and preserves retention defaults, warnings and bounds', ({
  assert,
}) => {
  const warnings: string[] = [];
  const log = (message: string) => warnings.push(message);
  for (const directory of [undefined, '']) {
    assert.equal(
      parseBackupConfig(
        { CAPACITYLENS_BACKUP_DIR: directory, CAPACITYLENS_BACKUP_KEEP: 'bad' },
        log
      ).directory,
      ''
    );
  }
  assert.deepEqual(warnings, []);
  assert.equal(parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: '/tmp/b' }).keep, 48);
  for (const raw of ['bad', '', '0', '-1', 'Infinity']) {
    assert.equal(
      parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: '/tmp/b', CAPACITYLENS_BACKUP_KEEP: raw }, log)
        .keep,
      48
    );
  }
  const fractional = parseBackupConfig(
    { CAPACITYLENS_BACKUP_DIR: '/tmp/b', CAPACITYLENS_BACKUP_KEEP: '100.5' },
    log
  );
  assert.equal(fractional.directory, '/tmp/b');
  assert.equal(fractional.keep, 100);
  assert.equal(
    parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: '/tmp/b', CAPACITYLENS_BACKUP_KEEP: '10001' }, log)
      .keep,
    MAX_BACKUP_KEEP
  );
  assert.lengthOf(warnings, 7);
  assert.include(warnings[5]!, '100.5');
  assert.include(warnings[5]!, 'using 100');
  assert.include(warnings[6]!, 'using 10000');
});
