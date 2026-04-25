/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';

test('renders the Flow app shell', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });

  expect(renderer.root.findByProps({testID: 'app-running'})).toBeTruthy();
  expect(renderer.root.findAllByProps({children: 'flow'}).length).toBeGreaterThan(0);
  expect(renderer.root.findAllByProps({children: 'Calendar'}).length).toBeGreaterThan(0);

  await ReactTestRenderer.act(async () => {
    renderer.unmount();
    await Promise.resolve();
  });
});
