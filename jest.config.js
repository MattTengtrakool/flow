module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm/)?((jest-)?react-native|@react-native(-community)?)|node_modules/\\.pnpm/(jest-)?react-native|node_modules/\\.pnpm/@react-native(-community)?)',
  ],
};
