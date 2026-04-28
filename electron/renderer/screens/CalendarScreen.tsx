import {memo, useEffect, useState} from 'react';
import type {CSSProperties} from 'react';

import type {WorklogCalendarBlock} from '../../../src/worklog/types';
import {
  dateFromIso,
  focusedMinutes,
  mondayOfIso,
  type CalendarView,
} from '../dateUtils';
import {Screen} from '../components/common';

const HOURS = Array.from({length: 17}, (_, index) => index + 6);
const GRID_START_MINUTES = HOURS[0] * 60;
const GRID_END_MINUTES = (HOURS[HOURS.length - 1] + 1) * 60;
const GRID_TOTAL_MINUTES = GRID_END_MINUTES - GRID_START_MINUTES;

// Precompute hour labels once — avoids creating Date + Intl formatter on every render
const hourFormatter = new Intl.DateTimeFormat([], {hour: 'numeric'});
const HOUR_LABELS: Record<number, string> = {};
for (const h of HOURS) {
  HOUR_LABELS[h] = hourFormatter.format(new Date(2026, 0, 1, h, 0));
}

const dayTimeFormatter = new Intl.DateTimeFormat([], {hour: 'numeric', minute: '2-digit'});

function dateNumber(dateIso: string): string {
  return String(dateFromIso(dateIso).getDate());
}

function isSameMonth(dateIso: string, anchorIso: string): boolean {
  const date = dateFromIso(dateIso);
  const anchor = dateFromIso(anchorIso);
  return (
    date.getFullYear() === anchor.getFullYear() &&
    date.getMonth() === anchor.getMonth()
  );
}

function isToday(dateIso: string): boolean {
  const today = new Date();
  const date = dateFromIso(dateIso);
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function categoryClass(block: WorklogCalendarBlock): string {
  return block.category != null ? `category-${block.category}` : 'category-other';
}

function blockPositionStyle(block: WorklogCalendarBlock): CSSProperties {
  const start = new Date(block.startTime);
  const end = new Date(block.endTime);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const clampedStart = Math.max(GRID_START_MINUTES, startMinutes);
  const clampedEnd = Math.min(GRID_END_MINUTES, Math.max(endMinutes, clampedStart + 15));
  const top = ((clampedStart - GRID_START_MINUTES) / GRID_TOTAL_MINUTES) * 100;
  const height = Math.max(
    4,
    ((clampedEnd - clampedStart) / GRID_TOTAL_MINUTES) * 100,
  );
  return {
    top: `${top}%`,
    height: `${height}%`,
    minHeight: '34px',
  };
}

function useCurrentMinutes() {
  const [minutes, setMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return minutes;
}

export const CalendarScreen = memo(function CalendarScreen(props: {
  view: CalendarView;
  anchorIso: string;
  visibleDateIsos: string[];
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  selectedDateIso: string;
  selectedBlockId: string | null;
  selectedDayBlocks: WorklogCalendarBlock[];
  selectedFocusedMinutes: number;
  onChangeView: (view: CalendarView) => void;
  onShift: (delta: number) => void;
  onToday: () => void;
  onSelectDate: (dateIso: string) => void;
  onSelectBlock: (block: WorklogCalendarBlock, dateIso?: string) => void;
}) {
  const currentMinutes = useCurrentMinutes();

  function timeNowStyle(): CSSProperties {
    const clamped = Math.max(GRID_START_MINUTES, Math.min(GRID_END_MINUTES, currentMinutes));
    return {top: `${((clamped - GRID_START_MINUTES) / GRID_TOTAL_MINUTES) * 100}%`};
  }

  return (
    <Screen title="Calendar">
      <div className="calendar-toolbar">
        <button type="button" onClick={() => props.onShift(-1)}>
          Previous
        </button>
        <strong>
          {props.view === 'month'
            ? dateFromIso(props.anchorIso).toLocaleString([], {
                month: 'long',
                year: 'numeric',
              })
            : props.view === 'week'
              ? `Week of ${mondayOfIso(props.anchorIso)}`
              : props.anchorIso}
        </strong>
        <button type="button" onClick={() => props.onShift(1)}>
          Next
        </button>
        <button type="button" onClick={props.onToday}>
          Today
        </button>
        <div className="segmented-control">
          {(['month', 'week', 'day'] as CalendarView[]).map(view => (
            <button
              key={view}
              className={props.view === view ? 'active' : ''}
              type="button"
              onClick={() => props.onChangeView(view)}>
              {view}
            </button>
          ))}
        </div>
      </div>

      {props.view === 'month' ? (
        <div className="month-grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
            <span key={day} className="weekday">
              {day}
            </span>
          ))}
          {props.visibleDateIsos.map(dateIso => {
            const blocks = props.blocksByDate[dateIso] ?? [];
            const muted = !isSameMonth(dateIso, props.anchorIso);
            const minutes = focusedMinutes(blocks);
            return (
              <button
                key={dateIso}
                className={[
                  'month-cell',
                  dateIso === props.selectedDateIso ? 'active' : '',
                  muted ? 'is-muted' : '',
                  isToday(dateIso) ? 'is-today' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                type="button"
                onClick={() => props.onSelectDate(dateIso)}>
                <span className="month-cell__date">{dateNumber(dateIso)}</span>
                <span className="month-cell__meta">
                  {minutes > 0 ? `${minutes}m` : ''}
                </span>
                <span className="calendar-pill-stack">
                  {blocks.slice(0, 4).map(block => (
                    <span
                      key={block.id}
                      className={`calendar-pill ${categoryClass(block)}`}
                      title={block.title}>
                      {block.title}
                    </span>
                  ))}
                  {blocks.length > 4 ? (
                    <span className="calendar-more">+{blocks.length - 4} more</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : props.view === 'week' ? (
        <div className="calendar-time-shell">
          <div className="time-rail">
            {HOURS.map(hour => (
              <span key={hour}>{HOUR_LABELS[hour]}</span>
            ))}
          </div>
          <div className="week-time-grid">
          {props.visibleDateIsos.map(dateIso => {
            const blocks = props.blocksByDate[dateIso] ?? [];
            return (
              <section
                key={dateIso}
                className={dateIso === props.selectedDateIso ? 'time-day active' : 'time-day'}>
                <header>
                  <strong>{dateIso.slice(5)}</strong>
                  <span>{focusedMinutes(blocks)}m</span>
                </header>
                <div className="time-day__canvas">
                  {HOURS.map(hour => (
                    <span key={hour} className="hour-line" />
                  ))}
                  {isToday(dateIso) && currentMinutes >= GRID_START_MINUTES && currentMinutes <= GRID_END_MINUTES ? (
                    <div className="time-now-line" style={timeNowStyle()} />
                  ) : null}
                  {blocks.map(block => (
                    <button
                      key={block.id}
                      type="button"
                      style={blockPositionStyle(block)}
                      className={[
                        'time-block',
                        categoryClass(block),
                        block.id === props.selectedBlockId ? 'active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => props.onSelectBlock(block, dateIso)}>
                      <span className="time-block__meta">
                        {dayTimeFormatter.format(new Date(block.startTime))} ·{' '}
                        {focusedMinutes([block])}m
                      </span>
                      <strong>{block.title}</strong>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          </div>
        </div>
      ) : (
        <div className="day-column">
          <div className="day-heading">
            <strong>{props.selectedDateIso}</strong>
            <span>{props.selectedFocusedMinutes} focused minutes</span>
          </div>
          <div className="calendar-time-shell single-day">
            <div className="time-rail">
              {HOURS.map(hour => (
                <span key={hour}>{HOUR_LABELS[hour]}</span>
              ))}
            </div>
            <div className="time-day__canvas">
              {HOURS.map(hour => (
                <span key={hour} className="hour-line" />
              ))}
              {isToday(props.selectedDateIso) && currentMinutes >= GRID_START_MINUTES && currentMinutes <= GRID_END_MINUTES ? (
                <div className="time-now-line" style={timeNowStyle()} />
              ) : null}
              {props.selectedDayBlocks.map(block => (
                <button
                  key={block.id}
                  type="button"
                  style={blockPositionStyle(block)}
                  className={[
                    'time-block',
                    categoryClass(block),
                    block.id === props.selectedBlockId ? 'active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => props.onSelectBlock(block)}>
                  <span className="time-block__meta">
                    {dayTimeFormatter.format(new Date(block.startTime))} ·{' '}
                    {focusedMinutes([block])}m
                  </span>
                  <strong>{block.title}</strong>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
});
