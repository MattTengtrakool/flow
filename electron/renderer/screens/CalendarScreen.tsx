import {memo, useEffect, useState} from 'react';
import type {CSSProperties, FormEvent} from 'react';

import type {
  CalendarItemKind,
  CalendarItemUpdate,
  CreateCalendarItemInput,
} from '../../../src/calendar/types';
import type {WorklogCalendarBlock} from '../../../src/worklog/types';
import {
  dateFromIso,
  focusedMinutes,
  mondayOfIso,
  toDateIso,
  type CalendarView,
} from '../dateUtils';
import {Screen} from '../components/common';

const HOURS = Array.from({length: 17}, (_, index) => index + 6);
const GRID_START_MINUTES = HOURS[0] * 60;
const GRID_END_MINUTES = (HOURS[HOURS.length - 1] + 1) * 60;
const GRID_TOTAL_MINUTES = GRID_END_MINUTES - GRID_START_MINUTES;

type RepeatOption =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'weekdays'
  | 'monthly'
  | 'yearly';

type EditorMode = 'closed' | 'create' | 'edit';

type CalendarEditorState = {
  kind: CalendarItemKind;
  title: string;
  dateIso: string;
  startTime: string;
  endTime: string;
  description: string;
  location: string;
  repeat: RepeatOption;
  repeatDaysOfWeek: number[];
  repeatUntil: string;
};

const REPEAT_OPTIONS: Array<{value: RepeatOption; label: string}> = [
  {value: 'none', label: 'Does not repeat'},
  {value: 'daily', label: 'Daily'},
  {value: 'weekly', label: 'Weekly'},
  {value: 'weekdays', label: 'Every weekday'},
  {value: 'monthly', label: 'Monthly'},
  {value: 'yearly', label: 'Yearly'},
];

// Precompute hour labels once to avoid creating Date + Intl formatter on every render.
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

function twoDigit(value: number): string {
  return String(value).padStart(2, '0');
}

function timeInputValue(date: Date): string {
  return `${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}`;
}

function defaultEditorState(dateIso: string): CalendarEditorState {
  const now = new Date();
  const start = dateFromIso(dateIso);
  if (dateIso === toDateIso(now)) {
    start.setHours(Math.min(20, now.getHours() + 1), 0, 0, 0);
  } else {
    start.setHours(9, 0, 0, 0);
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    kind: 'event',
    title: '',
    dateIso,
    startTime: timeInputValue(start),
    endTime: timeInputValue(end),
    description: '',
    location: '',
    repeat: 'none',
    repeatDaysOfWeek: [],
    repeatUntil: '',
  };
}

function repeatOptionFromBlock(block: WorklogCalendarBlock): RepeatOption {
  const recurrence = block.calendarItemRecurrence;
  if (recurrence == null) return 'none';
  if (
    recurrence.frequency === 'weekly' &&
    recurrence.daysOfWeek?.length === 5 &&
    [1, 2, 3, 4, 5].every(day => recurrence.daysOfWeek?.includes(day))
  ) {
    return 'weekdays';
  }
  return recurrence.frequency;
}

function editorStateFromBlock(block: WorklogCalendarBlock): CalendarEditorState {
  const start = new Date(block.startTime);
  const end = new Date(block.endTime);
  return {
    kind: block.calendarItemKind ?? 'event',
    title: block.title,
    dateIso: toDateIso(start),
    startTime: timeInputValue(start),
    endTime: timeInputValue(end),
    description: block.notes ?? block.summary.narrative ?? '',
    location: block.calendarItemLocation ?? '',
    repeat: repeatOptionFromBlock(block),
    repeatDaysOfWeek: block.calendarItemRecurrence?.daysOfWeek ?? [],
    repeatUntil: block.calendarItemRecurrence?.until ?? '',
  };
}

function localDateTimeIso(dateIso: string, timeValue: string): string {
  const safeDateIso = /^\d{4}-\d{2}-\d{2}$/.test(dateIso)
    ? dateIso
    : toDateIso(new Date());
  const safeTimeValue = /^\d{2}:\d{2}$/.test(timeValue) ? timeValue : '09:00';
  return new Date(`${safeDateIso}T${safeTimeValue}:00`).toISOString();
}

function weekdayForDate(dateIso: string): number {
  return dateFromIso(dateIso).getDay();
}

function recurrenceForState(state: CalendarEditorState): CreateCalendarItemInput['recurrence'] {
  if (state.repeat === 'none') return null;
  const until = state.repeatUntil.trim().length > 0 ? state.repeatUntil : null;
  if (state.repeat === 'weekdays') {
    return {
      frequency: 'weekly',
      interval: 1,
      daysOfWeek: [1, 2, 3, 4, 5],
      until,
    };
  }
  return {
    frequency: state.repeat,
    interval: 1,
    daysOfWeek:
      state.repeat === 'weekly'
        ? state.repeatDaysOfWeek.length > 0
          ? state.repeatDaysOfWeek
          : [weekdayForDate(state.dateIso)]
        : undefined,
    until,
  };
}

function inputFromEditorState(state: CalendarEditorState): CreateCalendarItemInput {
  const startAt = localDateTimeIso(state.dateIso, state.startTime);
  const parsedStart = Date.parse(startAt);
  const parsedEnd = Date.parse(localDateTimeIso(state.dateIso, state.endTime));
  const endAt =
    Number.isFinite(parsedEnd) && parsedEnd > parsedStart
      ? new Date(parsedEnd).toISOString()
      : new Date(parsedStart + 60 * 60 * 1000).toISOString();

  return {
    kind: state.kind,
    title: state.title.trim(),
    description: state.description.trim(),
    location: state.location.trim(),
    startAt,
    endAt,
    recurrence: recurrenceForState(state),
  };
}

function isUserCalendarBlock(block: WorklogCalendarBlock | null): boolean {
  return block?.source === 'user_calendar' && block.calendarItemId != null;
}

export const CalendarScreen = memo(function CalendarScreen(props: {
  view: CalendarView;
  anchorIso: string;
  visibleDateIsos: string[];
  blocksByDate: Record<string, WorklogCalendarBlock[]>;
  selectedDateIso: string;
  selectedBlockId: string | null;
  selectedBlock: WorklogCalendarBlock | null;
  selectedDayBlocks: WorklogCalendarBlock[];
  selectedFocusedMinutes: number;
  onChangeView: (view: CalendarView) => void;
  onShift: (delta: number) => void;
  onToday: () => void;
  onSelectDate: (dateIso: string) => void;
  onSelectBlock: (block: WorklogCalendarBlock, dateIso?: string) => void;
  onCreateCalendarItem: (input: CreateCalendarItemInput) => Promise<void>;
  onUpdateCalendarItem: (
    itemId: string,
    updates: CalendarItemUpdate,
  ) => Promise<void>;
  onDeleteCalendarItem: (itemId: string) => Promise<void>;
}) {
  const currentMinutes = useCurrentMinutes();
  const [editorMode, setEditorMode] = useState<EditorMode>('closed');
  const [editorState, setEditorState] = useState(() =>
    defaultEditorState(props.selectedDateIso),
  );
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    if (editorMode === 'create') {
      setEditorState(defaultEditorState(props.selectedDateIso));
    }
  }, [editorMode, props.selectedDateIso]);

  const selectedIsUserCalendarBlock = isUserCalendarBlock(props.selectedBlock);

  function timeNowStyle(): CSSProperties {
    const clamped = Math.max(GRID_START_MINUTES, Math.min(GRID_END_MINUTES, currentMinutes));
    return {top: `${((clamped - GRID_START_MINUTES) / GRID_TOTAL_MINUTES) * 100}%`};
  }

  function startCreate() {
    setEditorError(null);
    setEditorState(defaultEditorState(props.selectedDateIso));
    setEditorMode('create');
  }

  function startEdit() {
    if (!selectedIsUserCalendarBlock || props.selectedBlock == null) return;
    setEditorError(null);
    setEditorState(editorStateFromBlock(props.selectedBlock));
    setEditorMode('edit');
  }

  async function deleteSelectedItem() {
    const itemId = props.selectedBlock?.calendarItemId;
    if (itemId == null) return;
    const confirmed = window.confirm('Delete this item and all repeats?');
    if (!confirmed) return;
    await props.onDeleteCalendarItem(itemId);
    setEditorMode('closed');
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = inputFromEditorState(editorState);
    if (input.title.trim().length === 0) {
      setEditorError('Add a title before saving.');
      return;
    }
    setEditorError(null);
    if (editorMode === 'edit') {
      const itemId = props.selectedBlock?.calendarItemId;
      if (itemId == null) return;
      await props.onUpdateCalendarItem(itemId, input);
    } else {
      await props.onCreateCalendarItem(input);
    }
    setEditorMode('closed');
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
        <button type="button" onClick={startCreate}>
          New
        </button>
        {selectedIsUserCalendarBlock ? (
          <>
            <button type="button" onClick={startEdit}>
              Edit
            </button>
            <button type="button" onClick={deleteSelectedItem}>
              Delete
            </button>
          </>
        ) : null}
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

      {editorMode !== 'closed' ? (
        <form className="calendar-editor" onSubmit={submitEditor}>
          <div className="calendar-editor__topline">
            <div className="segmented-control" aria-label="Calendar item type">
              {(['event', 'task'] as CalendarItemKind[]).map(kind => (
                <button
                  key={kind}
                  type="button"
                  className={editorState.kind === kind ? 'active' : ''}
                  onClick={() =>
                    setEditorState(previous => ({
                      ...previous,
                      kind,
                    }))
                  }>
                  {kind}
                </button>
              ))}
            </div>
            <span>{editorMode === 'edit' ? 'Edit item' : 'New item'}</span>
          </div>

          <label className="form-field calendar-editor__title">
            <span>Title</span>
            <input
              value={editorState.title}
              onChange={event =>
                setEditorState(previous => ({
                  ...previous,
                  title: event.target.value,
                }))
              }
              placeholder={editorState.kind === 'task' ? 'Task name' : 'Event name'}
            />
          </label>

          <div className="calendar-editor__grid">
            <label className="form-field">
              <span>Date</span>
              <input
                type="date"
                value={editorState.dateIso}
                onChange={event =>
                  setEditorState(previous => ({
                    ...previous,
                    dateIso: event.target.value,
                    repeatDaysOfWeek:
                      previous.repeat === 'weekly' && previous.repeatDaysOfWeek.length <= 1
                        ? [weekdayForDate(event.target.value)]
                        : previous.repeatDaysOfWeek,
                  }))
                }
              />
            </label>
            <label className="form-field">
              <span>Start</span>
              <input
                type="time"
                value={editorState.startTime}
                onChange={event =>
                  setEditorState(previous => ({
                    ...previous,
                    startTime: event.target.value,
                  }))
                }
              />
            </label>
            <label className="form-field">
              <span>End</span>
              <input
                type="time"
                value={editorState.endTime}
                onChange={event =>
                  setEditorState(previous => ({
                    ...previous,
                    endTime: event.target.value,
                  }))
                }
              />
            </label>
            <label className="form-field">
              <span>Repeat</span>
              <select
                value={editorState.repeat}
                onChange={event =>
                  setEditorState(previous => ({
                    ...previous,
                    repeat: event.target.value as RepeatOption,
                    repeatDaysOfWeek:
                      event.target.value === 'weekly'
                        ? previous.repeatDaysOfWeek.length > 0
                          ? previous.repeatDaysOfWeek
                          : [weekdayForDate(previous.dateIso)]
                        : [],
                  }))
                }>
                {REPEAT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {editorState.repeat !== 'none' ? (
              <label className="form-field">
                <span>Ends</span>
                <input
                  type="date"
                  value={editorState.repeatUntil}
                  onChange={event =>
                    setEditorState(previous => ({
                      ...previous,
                      repeatUntil: event.target.value,
                    }))
                  }
                />
              </label>
            ) : null}
            {editorState.kind === 'event' ? (
              <label className="form-field">
                <span>Location</span>
                <input
                  value={editorState.location}
                  onChange={event =>
                    setEditorState(previous => ({
                      ...previous,
                      location: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </label>
            ) : null}
          </div>

          <label className="form-field">
            <span>Description</span>
            <textarea
              rows={3}
              value={editorState.description}
              onChange={event =>
                setEditorState(previous => ({
                  ...previous,
                  description: event.target.value,
                }))
              }
              placeholder="Optional"
            />
          </label>

          {editorError != null ? <p className="calendar-editor__error">{editorError}</p> : null}

          <div className="action-row">
            <button type="submit">
              {editorMode === 'edit' ? 'Save changes' : 'Create'}
            </button>
            <button type="button" onClick={() => setEditorMode('closed')}>
              Cancel
            </button>
          </div>
        </form>
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
                  <button type="button" onClick={() => props.onSelectDate(dateIso)}>
                    <strong>{dateIso.slice(5)}</strong>
                    <span>{focusedMinutes(blocks)}m</span>
                  </button>
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
