import {memo} from 'react';
import type React from 'react';

import type {NavKey, TimelineUiState} from '../types';

const flowIconUrl = new URL('../../../brand/flow-icon-64.png', import.meta.url).href;

type IconProps = {className?: string};

function IconToday({className}: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={className}>
      <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M7.5 4.5v3.25l1.75 1.75" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconCalendar({className}: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={className}>
      <rect x="1.5" y="3" width="12" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M1.5 6.5h12" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M5 1.5v3M10 1.5v3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  );
}

function IconChat({className}: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={className}>
      <path d="M1.5 2.5a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3.5 3V2.5z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
    </svg>
  );
}

function IconInsights({className}: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={className}>
      <rect x="1.5" y="9" width="3" height="4.5" rx="0.75" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="6" y="5.5" width="3" height="8" rx="0.75" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="10.5" y="2" width="3" height="11.5" rx="0.75" stroke="currentColor" strokeWidth="1.25"/>
    </svg>
  );
}

function IconSettings({className}: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={className}>
      <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M3.05 3.05l1.06 1.06M10.89 10.89l1.06 1.06M3.05 11.95l1.06-1.06M10.89 4.11l1.06-1.06" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  );
}

const NAV_ITEMS: Array<{key: NavKey; label: string; Icon: React.ComponentType<IconProps>}> = [
  {key: 'today',    label: 'Today',    Icon: IconToday},
  {key: 'calendar', label: 'Calendar', Icon: IconCalendar},
  {key: 'chat',     label: 'Chat',     Icon: IconChat},
  {key: 'insights', label: 'Insights', Icon: IconInsights},
  {key: 'settings', label: 'Settings', Icon: IconSettings},
];

export const Sidebar = memo(function Sidebar(props: {
  activeNav: NavKey;
  onNavigate: (key: NavKey) => void;
  timelineStore: TimelineUiState;
}) {
  const {activeNav, onNavigate, timelineStore} = props;
  const hasSession = timelineStore.timeline.currentSessionId != null;
  const captureTone = hasSession
    ? 'is-capturing'
    : timelineStore.hydrationStatus !== 'ready'
      ? 'is-warning'
      : 'is-idle';

  return (
    <aside className="sidebar">
      <div>
        <div className="brand-area">
          <img className="brand-mark" src={flowIconUrl} alt="" />
          <span className="brand-name">Flow</span>
        </div>

        <nav className="nav-list" aria-label="Primary navigation">
          {NAV_ITEMS.map(({key, label, Icon}) => (
            <button
              key={key}
              className={activeNav === key ? 'active' : ''}
              type="button"
              onClick={() => onNavigate(key)}>
              <span className="nav-icon">
                <Icon />
              </span>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className={`capture-footer ${captureTone}`}>
        <div className="capture-status">
          <span className="capture-dot" />
          <div className="capture-status-text">
            <strong>{hasSession ? 'Capturing' : 'Idle'}</strong>
            <p>{timelineStore.continuousModeState.statusMessage}</p>
          </div>
        </div>
        <button
          type="button"
          className={hasSession ? 'button-danger-soft' : 'button-primary'}
          onClick={() => {
            if (hasSession) {
              timelineStore.stopSession().catch(() => {});
            } else {
              timelineStore.startSession();
            }
          }}>
          {hasSession ? 'Stop' : 'Start'}
        </button>
      </div>
    </aside>
  );
});
