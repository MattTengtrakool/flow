import React from 'react';
import {createRoot} from 'react-dom/client';

import {ElectronApp} from './App';
import './styles.css';

const root = document.getElementById('root');

if (root == null) {
  throw new Error('Flow renderer root element was not found.');
}

createRoot(root).render(
  <React.StrictMode>
    <ElectronApp />
  </React.StrictMode>,
);
