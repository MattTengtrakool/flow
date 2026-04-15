/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';

test('renders the observation lab shell', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });

  expect(renderer.root.findByProps({testID: 'app-running'}).props.children).toBe(
    'App running',
  );
  expect(
    renderer.root.findByProps({testID: 'capture-now-button'}),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({testID: 'observe-last-capture-button'}),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({testID: 'save-fixture-button'}),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({testID: 'start-manual-workflow-button'}),
  ).toBeTruthy();
});
