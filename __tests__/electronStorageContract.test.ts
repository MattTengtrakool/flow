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
    expect(source).not.toContain('unlink');
    expect(source).not.toContain('rm(');
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

  test('persists with atomic temp-file rename and pretty JSON', () => {
    const source = fs.readFileSync(storageSourcePath, 'utf8');

    expect(source).toContain("const temporaryPath = `${filePath}.tmp`");
    expect(source).toContain('JSON.stringify(eventLog, null, 2)');
    expect(source).toContain('await fs.writeFile(temporaryPath');
    expect(source).toContain('await fs.rename(temporaryPath, filePath)');
  });
});
