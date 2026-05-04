import { memo, useEffect, useState } from 'react';

import { getCalendarEventMode } from '../../../src/calendar/calendarLogic';
import type {
  CalendarEventAnnotationPatch,
  CalendarEventAnnotationView,
  CalendarEventBlockLinkAction,
  CalendarReconciliationView,
  CalendarSourceMode,
  CalendarSourceView,
  ExternalCalendarEventView,
} from '../../../src/calendar/types';
import type { WorklogCalendarBlock } from '../../../src/worklog/types';
import { focusedMinutes } from '../dateUtils';
import { SmallList } from './common';
import { NotesEditor } from './NotesEditor';

export const DetailPanel = memo(function DetailPanel(props: {
  selectedBlock: WorklogCalendarBlock | null;
  selectedExternalEvent: ExternalCalendarEventView | null;
  selectedExternalEventAnnotation: CalendarEventAnnotationView | null;
  selectedExternalEventBlocks: WorklogCalendarBlock[];
  selectedExternalEventSource: CalendarSourceView | null;
  selectedUserNotes: string | undefined;
  editableNotesKey: string;
  selectedObservationIds: string[];
  selectedCalendarEvents: ExternalCalendarEventView[];
  calendarReconciliation: CalendarReconciliationView;
  onEditNotes: (notes: string) => void;
  onCorrectBlock: (correction: {
    title?: string;
    category?: string;
    markedWrong?: boolean;
    feedback?: string;
    mergeWithBlockId?: string;
    splitAt?: string;
  }) => void;
  onEditCalendarEventAnnotation: (
    eventId: string,
    patch: CalendarEventAnnotationPatch,
  ) => Promise<unknown>;
  onUpdateCalendarEventBlockLink: (
    eventId: string,
    blockId: string,
    action: CalendarEventBlockLinkAction,
  ) => Promise<unknown>;
  visible: boolean;
}) {
  const [titleDraft, setTitleDraft] = useState('');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [feedbackDraft, setFeedbackDraft] = useState('');

  useEffect(() => {
    setTitleDraft(props.selectedBlock?.title ?? '');
    setCategoryDraft(props.selectedBlock?.category ?? 'other');
    setFeedbackDraft(props.selectedBlock?.userCorrection?.feedback ?? '');
  }, [props.selectedBlock]);

  if (!props.visible) return null;

  if (props.selectedExternalEvent != null) {
    return (
      <ExternalCalendarEventDetails
        event={props.selectedExternalEvent}
        annotation={props.selectedExternalEventAnnotation}
        reconciliation={props.calendarReconciliation}
        linkedBlocks={props.selectedExternalEventBlocks}
        source={props.selectedExternalEventSource}
        onEditAnnotation={props.onEditCalendarEventAnnotation}
        onUpdateBlockLink={props.onUpdateCalendarEventBlockLink}
      />
    );
  }

  const block = props.selectedBlock;
  if (block == null) return null;

  return (
    <aside className="detail-panel">
      <p className="eyebrow">Details</p>
      <div className="detail-heading">
        <h2>{block.title}</h2>
        <span>{focusedMinutes([block])} min</span>
      </div>
      <div className="detail-editor">
        <label>
          <span>Title</span>
          <input
            value={titleDraft}
            onChange={event => setTitleDraft(event.target.value)}
          />
        </label>
        <label>
          <span>Category</span>
          <select
            value={categoryDraft}
            onChange={event => setCategoryDraft(event.target.value)}
          >
            {[
              'coding',
              'research',
              'review',
              'writing',
              'communication',
              'planning',
              'browsing',
              'file_management',
              'meeting',
              'other',
            ].map(category => (
              <option key={category} value={category}>
                {category.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Feedback</span>
          <textarea
            value={feedbackDraft}
            onChange={event => setFeedbackDraft(event.target.value)}
            placeholder="What should Flow learn about this block?"
            rows={2}
          />
        </label>
        <div className="detail-actions">
          <button
            type="button"
            className="button-primary"
            onClick={() =>
              props.onCorrectBlock({
                title: titleDraft,
                category: categoryDraft,
                feedback: feedbackDraft,
              })
            }
          >
            Save correction
          </button>
          <button
            type="button"
            className={
              block.userCorrection?.markedWrong
                ? 'button-danger-soft is-active'
                : 'button-danger-soft'
            }
            onClick={() =>
              props.onCorrectBlock({
                markedWrong: !block.userCorrection?.markedWrong,
                feedback: feedbackDraft,
              })
            }
          >
            {block.userCorrection?.markedWrong ? 'Marked wrong' : 'Mark wrong'}
          </button>
        </div>
      </div>
      <p>{block.summary.narrative}</p>
      <div className="notes-field">
        <span className="notes-label">Notes</span>
        <NotesEditor
          value={
            props.selectedUserNotes ??
            block.notes ??
            block.summary.narrative ??
            ''
          }
          onChange={props.onEditNotes}
          placeholder="Add notes…"
        />
      </div>
      <details className="detail-section" open>
        <summary>Artifacts</summary>
        <SmallList label="Repos" values={block.repos} />
        <SmallList label="Tickets" values={block.tickets} />
        <SmallList label="Apps" values={block.apps} />
        <SmallList label="Documents" values={block.documents} />
        <SmallList label="URLs" values={block.urls ?? []} />
        <SmallList label="People" values={block.people ?? []} />
      </details>
      {props.selectedCalendarEvents.length > 0 ? (
        <details className="detail-section" open>
          <summary>Calendar context</summary>
          <div className="linked-calendar-list">
            {props.selectedCalendarEvents.slice(0, 6).map(event => {
              const link = props.calendarReconciliation.links.find(
                item => item.eventId === event.id && item.blockId === block.id,
              );
              return (
                <div key={event.id} className="linked-calendar-row">
                  <span>
                    {event.title} ({formatTime(event.startTime)}) ·{' '}
                    {link?.status ?? 'overlap'}
                  </span>
                  {link?.status === 'auto' ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() =>
                        props.onUpdateCalendarEventBlockLink(
                          event.id,
                          block.id,
                          'confirm',
                        )
                      }
                    >
                      Confirm
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button-danger-soft"
                    onClick={() =>
                      props.onUpdateCalendarEventBlockLink(
                        event.id,
                        block.id,
                        'dismiss',
                      )
                    }
                  >
                    Not this
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
      <details className="detail-section">
        <summary>Why Flow thinks this</summary>
        <SmallList label="Key activities" values={block.keyActivities ?? []} />
        <SmallList label="Reason codes" values={block.reasonCodes} />
        <SmallList label="Evidence" values={props.selectedObservationIds} />
      </details>
      <div className="small-list">
        <strong>Confidence</strong>
        <span>{Math.round(block.confidence * 100)}%</span>
      </div>
    </aside>
  );
});

function ExternalCalendarEventDetails(props: {
  event: ExternalCalendarEventView;
  annotation: CalendarEventAnnotationView | null;
  reconciliation: CalendarReconciliationView;
  linkedBlocks: WorklogCalendarBlock[];
  source: CalendarSourceView | null;
  onEditAnnotation: (
    eventId: string,
    patch: CalendarEventAnnotationPatch,
  ) => Promise<unknown>;
  onUpdateBlockLink: (
    eventId: string,
    blockId: string,
    action: CalendarEventBlockLinkAction,
  ) => Promise<unknown>;
}) {
  const { annotation, event, linkedBlocks, reconciliation, source } = props;
  const effectiveMode = getCalendarEventMode(event, source, annotation);
  const sourceMode = source?.mode ?? 'ignored';
  const [notesDraft, setNotesDraft] = useState(annotation?.notes ?? '');
  const [outcomeDraft, setOutcomeDraft] = useState(annotation?.outcome ?? '');
  const [followUpsDraft, setFollowUpsDraft] = useState(
    (annotation?.followUps ?? []).join('\n'),
  );
  const links = [event.conferenceUrl, event.htmlLink].filter(
    (value): value is string => value != null && value.length > 0,
  );

  useEffect(() => {
    setNotesDraft(annotation?.notes ?? '');
    setOutcomeDraft(annotation?.outcome ?? '');
    setFollowUpsDraft((annotation?.followUps ?? []).join('\n'));
  }, [annotation, event.id]);

  function saveAnnotation() {
    props.onEditAnnotation(event.id, {
      notes: notesDraft,
      outcome: outcomeDraft,
      followUps: followUpsDraft.split(/\r?\n/),
    });
  }

  function updateModeOverride(mode: CalendarSourceMode) {
    props.onEditAnnotation(event.id, {
      modeOverride: mode === sourceMode ? null : mode,
    });
  }

  return (
    <aside className="detail-panel">
      <p className="eyebrow">{eventModeHeading(effectiveMode)}</p>
      <div className="detail-heading">
        <h2>{event.title}</h2>
        <span>
          {event.busy ? 'Busy' : 'Free'} · {eventModeLabel(effectiveMode)}
        </span>
      </div>
      <details className="detail-section" open>
        <summary>Schedule</summary>
        <SmallList label="Calendar" values={[source?.summary ?? 'Google']} />
        <SmallList label="When" values={[formatEventRange(event)]} />
        <SmallList label="Duration" values={[formatDuration(event)]} />
      </details>
      <details className="detail-section" open>
        <summary>Treatment</summary>
        <SmallList
          label="Source default"
          values={[eventModeLabel(sourceMode)]}
        />
        <div className="event-treatment-control">
          {EVENT_MODE_OPTIONS.map(option => (
            <button
              key={option.mode}
              type="button"
              className={effectiveMode === option.mode ? 'active' : ''}
              onClick={() => updateModeOverride(option.mode)}
              title={option.description}
            >
              {option.label}
            </button>
          ))}
        </div>
        {annotation?.modeOverride != null ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              props.onEditAnnotation(event.id, { modeOverride: null })
            }
          >
            Use source default
          </button>
        ) : null}
      </details>
      <details className="detail-section" open>
        <summary>Private Flow Notes</summary>
        <label className="notes-field">
          <span className="notes-label">Notes</span>
          <textarea
            value={notesDraft}
            onChange={changeEvent => setNotesDraft(changeEvent.target.value)}
            rows={4}
            placeholder="Private notes for this scheduled item"
          />
        </label>
        <label className="notes-field">
          <span className="notes-label">Outcome</span>
          <textarea
            value={outcomeDraft}
            onChange={changeEvent => setOutcomeDraft(changeEvent.target.value)}
            rows={2}
            placeholder="What came out of this?"
          />
        </label>
        <label className="notes-field">
          <span className="notes-label">Follow-ups</span>
          <textarea
            value={followUpsDraft}
            onChange={changeEvent =>
              setFollowUpsDraft(changeEvent.target.value)
            }
            rows={3}
            placeholder="One follow-up per line"
          />
        </label>
        <button
          type="button"
          className="button-primary"
          onClick={saveAnnotation}
        >
          Save event notes
        </button>
      </details>
      <details className="detail-section" open>
        <summary>Observed Flow Blocks</summary>
        {linkedBlocks.length > 0 ? (
          <div className="linked-calendar-list">
            {linkedBlocks.map(block => {
              const link = reconciliation.links.find(
                item => item.eventId === event.id && item.blockId === block.id,
              );
              const status = link?.status ?? 'overlap';
              return (
                <div key={block.id} className="linked-calendar-row">
                  <span>
                    {block.title} ({formatTime(block.startTime)}) · {status}
                  </span>
                  {status !== 'confirmed' ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() =>
                        props.onUpdateBlockLink(event.id, block.id, 'confirm')
                      }
                    >
                      Confirm
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button-danger-soft"
                    onClick={() =>
                      props.onUpdateBlockLink(event.id, block.id, 'dismiss')
                    }
                  >
                    Unlink
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <SmallList label="Matches" values={['No observed work linked yet']} />
        )}
      </details>
      <details className="detail-section" open>
        <summary>Event Details</summary>
        <SmallList
          label="State"
          values={[
            event.status,
            event.transparency === 'transparent' ? 'transparent' : 'opaque',
            event.eventType,
          ]}
        />
        <SmallList label="Visibility" values={[event.visibility]} />
        <SmallList
          label="Location"
          values={event.location != null ? [event.location] : []}
        />
        <SmallList label="Attendees" values={event.attendees} />
        <SmallList label="Links" values={links} />
      </details>
      <div className="small-list">
        <strong>Source</strong>
        <span>{event.provider} calendar event · read only</span>
      </div>
    </aside>
  );
}

const EVENT_MODE_OPTIONS: Array<{
  mode: CalendarSourceMode;
  label: string;
  description: string;
}> = [
  {
    mode: 'scheduled',
    label: 'Scheduled',
    description: 'Treat as intended time and block availability.',
  },
  {
    mode: 'context_only',
    label: 'Context',
    description: 'Keep visible without blocking availability.',
  },
  {
    mode: 'ignored',
    label: 'Ignore',
    description: 'Hide this event from Flow context.',
  },
];

function eventModeLabel(mode: CalendarSourceMode): string {
  if (mode === 'scheduled') return 'scheduled';
  if (mode === 'context_only') return 'context only';
  return 'ignored';
}

function eventModeHeading(mode: CalendarSourceMode): string {
  if (mode === 'scheduled') return 'Scheduled Event';
  if (mode === 'context_only') return 'Context Event';
  return 'Ignored Event';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatEventRange(event: ExternalCalendarEventView): string {
  if (event.allDay) {
    return `${formatDate(event.startTime)} all day`;
  }
  return `${formatDateTime(event.startTime)} - ${formatTime(event.endTime)}`;
}

function formatDuration(event: ExternalCalendarEventView): string {
  if (event.allDay) return 'All day';
  const startMs = Date.parse(event.startTime);
  const endMs = Date.parse(event.endTime);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return 'Unknown';
  }
  const minutes = Math.round((endMs - startMs) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`;
}
