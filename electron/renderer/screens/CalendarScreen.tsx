import { memo, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';

import type {
  CalendarReconciliationView,
  CalendarSourceView,
  ExternalCalendarEventView,
  TaskFitSuggestion,
} from '../../../src/calendar/types';
import type { WorklogCalendarBlock } from '../../../src/worklog/types';
import {
  addDaysIso,
  dateFromIso,
  focusedMinutes,
  mondayOfIso,
  type CalendarView,
} from '../dateUtils';
import { Screen } from '../components/common';

const HOURS = Array.from({ length: 17 }, (_, index) => index + 6);
const GRID_START_MINUTES = HOURS[0] * 60;
const GRID_END_MINUTES = (HOURS[HOURS.length - 1] + 1) * 60;
const GRID_TOTAL_MINUTES = GRID_END_MINUTES - GRID_START_MINUTES;

// Precompute hour labels once — avoids creating Date + Intl formatter on every render
const hourFormatter = new Intl.DateTimeFormat([], { hour: 'numeric' });
const HOUR_LABELS: Record<number, string> = {};
for (const h of HOURS) {
  HOUR_LABELS[h] = hourFormatter.format(new Date(2026, 0, 1, h, 0));
}

const dayTimeFormatter = new Intl.DateTimeFormat([], {
  hour: 'numeric',
  minute: '2-digit',
});

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
  return block.category != null
    ? `category-${block.category}`
    : 'category-other';
}

function blockPositionStyle(block: WorklogCalendarBlock): CSSProperties {
  return timeRangePositionStyle(block.startTime, block.endTime);
}

function eventPositionStyle(event: ExternalCalendarEventView): CSSProperties {
  return timeRangePositionStyle(event.startTime, event.endTime);
}

function timeRangePositionStyle(
  startIso: string,
  endIso: string,
): CSSProperties {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const clampedStart = Math.max(GRID_START_MINUTES, startMinutes);
  const clampedEnd = Math.min(
    GRID_END_MINUTES,
    Math.max(endMinutes, clampedStart + 15),
  );
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
  selectedExternalEventId: string | null;
  selectedDayBlocks: WorklogCalendarBlock[];
  selectedFocusedMinutes: number;
  externalEventsByDate: Record<string, ExternalCalendarEventView[]>;
  calendarSources: CalendarSourceView[];
  reconciliation: CalendarReconciliationView;
  taskFitSuggestions: TaskFitSuggestion[];
  onChangeView: (view: CalendarView) => void;
  onShift: (delta: number) => void;
  onToday: () => void;
  onSelectDate: (dateIso: string) => void;
  onSelectBlock: (block: WorklogCalendarBlock, dateIso?: string) => void;
  onSelectExternalEvent: (
    event: ExternalCalendarEventView,
    dateIso?: string,
  ) => void;
}) {
  const currentMinutes = useCurrentMinutes();
  const scheduledEventIds = new Set(
    props.reconciliation.scheduledItems.map(item => item.eventId),
  );
  const sourceById = useMemo(
    () => new Map(props.calendarSources.map(source => [source.id, source])),
    [props.calendarSources],
  );

  function externalEventClassName(event: ExternalCalendarEventView): string {
    return scheduledEventIds.has(event.id) ? 'scheduled' : 'context';
  }

  function eventSourceStyle(event: ExternalCalendarEventView): CSSProperties {
    const sourceColor = sourceById.get(event.sourceId)?.color;
    if (sourceColor == null || sourceColor.trim().length === 0) return {};
    return {
      '--calendar-source-color': sourceColor,
    } as CSSProperties;
  }

  function positionedEventStyle(
    event: ExternalCalendarEventView,
  ): CSSProperties {
    return {
      ...eventPositionStyle(event),
      ...eventSourceStyle(event),
    };
  }

  function timeNowStyle(): CSSProperties {
    const clamped = Math.max(
      GRID_START_MINUTES,
      Math.min(GRID_END_MINUTES, currentMinutes),
    );
    return {
      top: `${((clamped - GRID_START_MINUTES) / GRID_TOTAL_MINUTES) * 100}%`,
    };
  }

  function handleMonthCellKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    dateIso: string,
  ) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    props.onSelectDate(dateIso);
  }

  return (
    <section
      className="calendar-screen"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') {
          props.onSelectDate(addDaysIso(props.selectedDateIso, -1));
        }
        if (event.key === 'ArrowRight') {
          props.onSelectDate(addDaysIso(props.selectedDateIso, 1));
        }
      }}
    >
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
                onClick={() => props.onChangeView(view)}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        <div className="day-summary-card">
          <div>
            <span>Observed</span>
            <strong>{props.selectedDayBlocks.length} blocks</strong>
          </div>
          <div>
            <span>Observed time</span>
            <strong>{props.selectedFocusedMinutes}m</strong>
          </div>
          <div>
            <span>Scheduled</span>
            <strong>{props.reconciliation.totals.scheduledBusyMinutes}m</strong>
          </div>
          <div>
            <span>Linked</span>
            <strong>
              {props.reconciliation.totals.observedWithinScheduledMinutes}m
            </strong>
          </div>
          <div className="category-legend">
            {['coding', 'meeting', 'research', 'other'].map(category => (
              <span
                key={category}
                className={`legend-dot category-${category}`}
              >
                {category}
              </span>
            ))}
          </div>
        </div>

        {props.taskFitSuggestions.length > 0 ? (
          <div className="task-fit-strip">
            {props.taskFitSuggestions.slice(0, 3).map(suggestion => (
              <span key={suggestion.id}>
                {dayTimeFormatter.format(
                  new Date(suggestion.suggestedStartTime),
                )}{' '}
                ·{' '}
                {suggestion.sourceKind === 'calendar_follow_up'
                  ? 'Follow-up'
                  : 'Fit'}{' '}
                · {suggestion.sourceNextAction ?? suggestion.sourceTitle}
              </span>
            ))}
          </div>
        ) : null}

        {props.view === 'month' ? (
          <div className="month-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
              <span key={day} className="weekday">
                {day}
              </span>
            ))}
            {props.visibleDateIsos.map(dateIso => {
              const blocks = props.blocksByDate[dateIso] ?? [];
              const externalEvents = props.externalEventsByDate[dateIso] ?? [];
              const muted = !isSameMonth(dateIso, props.anchorIso);
              const minutes = focusedMinutes(blocks);
              return (
                <div
                  key={dateIso}
                  className={[
                    'month-cell',
                    dateIso === props.selectedDateIso ? 'active' : '',
                    muted ? 'is-muted' : '',
                    isToday(dateIso) ? 'is-today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  role="button"
                  tabIndex={0}
                  onClick={() => props.onSelectDate(dateIso)}
                  onKeyDown={event => handleMonthCellKeyDown(event, dateIso)}
                >
                  <span className="month-cell__date">
                    {dateNumber(dateIso)}
                  </span>
                  <span className="month-cell__meta">
                    {minutes > 0 ? `${minutes}m` : ''}
                  </span>
                  <span className="calendar-pill-stack">
                    {blocks.slice(0, 4).map(block => (
                      <button
                        key={block.id}
                        type="button"
                        className={`calendar-pill ${categoryClass(block)}`}
                        title={block.title}
                        onClick={event => {
                          event.stopPropagation();
                          props.onSelectBlock(block, dateIso);
                        }}
                      >
                        {block.title}
                      </button>
                    ))}
                    {externalEvents
                      .slice(0, Math.max(0, 4 - blocks.length))
                      .map(event => (
                        <button
                          key={event.id}
                          type="button"
                          className={[
                            'calendar-pill external',
                            externalEventClassName(event),
                            event.id === props.selectedExternalEventId
                              ? 'active'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={eventSourceStyle(event)}
                          title={event.title}
                          onClick={mouseEvent => {
                            mouseEvent.stopPropagation();
                            props.onSelectExternalEvent(event, dateIso);
                          }}
                        >
                          {event.title}
                        </button>
                      ))}
                    {blocks.length > 4 ? (
                      <span className="calendar-more">
                        +{blocks.length - 4} more
                      </span>
                    ) : null}
                  </span>
                </div>
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
                const externalEvents =
                  props.externalEventsByDate[dateIso] ?? [];
                return (
                  <section
                    key={dateIso}
                    className={
                      dateIso === props.selectedDateIso
                        ? 'time-day active'
                        : 'time-day'
                    }
                  >
                    <header>
                      <strong>{dateIso.slice(5)}</strong>
                      <span>{focusedMinutes(blocks)}m</span>
                    </header>
                    <div className="time-day__canvas">
                      {HOURS.map(hour => (
                        <span key={hour} className="hour-line" />
                      ))}
                      {isToday(dateIso) &&
                      currentMinutes >= GRID_START_MINUTES &&
                      currentMinutes <= GRID_END_MINUTES ? (
                        <div className="time-now-line" style={timeNowStyle()} />
                      ) : null}
                      {externalEvents.map(event => (
                        <button
                          key={event.id}
                          type="button"
                          style={positionedEventStyle(event)}
                          className={[
                            scheduledEventIds.has(event.id)
                              ? 'scheduled-calendar-block'
                              : 'external-block',
                            externalEventClassName(event),
                            event.busy ? 'busy' : '',
                            event.id === props.selectedExternalEventId
                              ? 'active'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          title={event.title}
                          onClick={() =>
                            props.onSelectExternalEvent(event, dateIso)
                          }
                        >
                          <span>
                            {dayTimeFormatter.format(new Date(event.startTime))}
                          </span>
                          <strong>{event.title}</strong>
                        </button>
                      ))}
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
                          onClick={() => props.onSelectBlock(block, dateIso)}
                        >
                          <span className="time-block__meta">
                            {dayTimeFormatter.format(new Date(block.startTime))}{' '}
                            · {focusedMinutes([block])}m
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
                {isToday(props.selectedDateIso) &&
                currentMinutes >= GRID_START_MINUTES &&
                currentMinutes <= GRID_END_MINUTES ? (
                  <div className="time-now-line" style={timeNowStyle()} />
                ) : null}
                {(props.externalEventsByDate[props.selectedDateIso] ?? []).map(
                  event => (
                    <button
                      key={event.id}
                      type="button"
                      style={positionedEventStyle(event)}
                      className={[
                        scheduledEventIds.has(event.id)
                          ? 'scheduled-calendar-block'
                          : 'external-block',
                        externalEventClassName(event),
                        event.busy ? 'busy' : '',
                        event.id === props.selectedExternalEventId
                          ? 'active'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={event.title}
                      onClick={() =>
                        props.onSelectExternalEvent(
                          event,
                          props.selectedDateIso,
                        )
                      }
                    >
                      <span>
                        {dayTimeFormatter.format(new Date(event.startTime))}
                      </span>
                      <strong>{event.title}</strong>
                    </button>
                  ),
                )}
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
                    onClick={() => props.onSelectBlock(block)}
                  >
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
    </section>
  );
});
