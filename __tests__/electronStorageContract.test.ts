import fs from 'node:fs';
import path from 'node:path';

const storageSourcePath = path.join(
  __dirname,
  '..',
  'electron',
  'main',
  'storage',
  'eventLogStorage.ts',
);

describe('Electron event log storage contract', () => {
  test('uses the legacy Flow Application Support event-log path as canonical', () => {
    const source = fs.readFileSync(storageSourcePath, 'utf8');

    expect(source).toContain("app.getPath('appData')");
    expect(source).toContain("'Flow'");
    expect(source).toContain("'event-log.json'");
  });

  test('keeps migration from Electron userData path non-destructive', () => {
    const source = fs.readFileSync(storageSourcePath, 'utf8');

    expect(source).toContain("app.getPath('userData')");
    expect(source).toContain('await saveEventLog(parsed as DomainEvent[])');
    expect(source).not.toContain('unlink(packagedPath');
    expect(source).not.toContain('unlink(filePath');
    expect(source).not.toContain('rm(packagedPath');
    expect(source).not.toContain('rm(filePath');
  });

  test('rejects corrupt or non-array event log payloads', () => {
    const source = fs.readFileSync(storageSourcePath, 'utf8');

    expect(source).toContain('JSON.parse(fileContents)');
    expect(source).toContain('if (!Array.isArray(parsed))');
    expect(source).toContain('The event log file does not contain an array.');
    expect(source).toContain(
      'The Electron event log file does not contain an array.',
    );
  });

  test('persists with queued atomic temp-file rename and pretty JSON', () => {
    const source = fs.readFileSync(storageSourcePath, 'utf8');

    expect(source).toContain('let saveEventLogQueue: Promise<void>');
    expect(source).toContain('JSON.stringify(eventLog, null, 2)');
    expect(source).toContain('writeSerializedEventLog(serialized)');
    expect(source).toContain(
      'const temporaryPath = `${filePath}.${randomUUID()}.tmp`',
    );
    expect(source).toContain('await fs.writeFile(temporaryPath');
    expect(source).toContain('await fs.rename(temporaryPath, filePath)');
    expect(source).toContain('await fs.unlink(temporaryPath).catch(() => {})');
  });
});
