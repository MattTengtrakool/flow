import {memo} from 'react';
import type React from 'react';

import type {NavKey, TimelineUiState} from '../types';
import {DetailPanel} from './DetailPanel';
import {Sidebar} from './Sidebar';

type DetailProps = React.ComponentProps<typeof DetailPanel>;

export const AppShell = memo(function AppShell(props: {
  activeNav: NavKey;
  onNavigate: (key: NavKey) => void;
  timelineStore: TimelineUiState;
  detail: DetailProps;
  children: React.ReactNode;
}) {
  return (
    <main className="app-shell">
      <Sidebar
        activeNav={props.activeNav}
        onNavigate={props.onNavigate}
        timelineStore={props.timelineStore}
      />
      <section className="content">{props.children}</section>
      <DetailPanel {...props.detail} />
    </main>
  );
});
