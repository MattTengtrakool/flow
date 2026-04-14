'use strict';

const {styleText} = require('node:util');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (typeof styleText !== 'function') {
  fail(
    [
      '',
      'This project needs Node 22+ for the React Native CLI.',
      `Current Node: ${process.version}`,
      '',
      'Use these commands, then try again:',
      'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"',
      'node -v',
      'npm start',
      '',
    ].join('\n'),
  );
}

const [majorVersion] = process.versions.node.split('.').map(Number);

if (!Number.isFinite(majorVersion) || majorVersion < 22) {
  fail(
    [
      '',
      'This project is pinned to Node 22+.',
      `Current Node: ${process.version}`,
      '',
      'Use these commands, then try again:',
      'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"',
      'node -v',
      'npm start',
      '',
    ].join('\n'),
  );
}
