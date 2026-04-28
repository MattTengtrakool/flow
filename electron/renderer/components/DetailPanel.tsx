import {memo} from 'react';

import type {WorklogCalendarBlock} from '../../../src/worklog/types';
import {focusedMinutes} from '../dateUtils';
import {SmallList} from './common';
import {NotesEditor} from './NotesEditor';

export const DetailPanel = memo(function DetailPanel(props: {
  selectedBlock: WorklogCalendarBlock | null;
  selectedUserNotes: string | undefined;
  editableNotesKey: string;
  selectedObservationIds: string[];
  onEditNotes: (notes: string) => void;
  visible: boolean;
}) {
  if (!props.visible) return null;

  const block = props.selectedBlock;
  if (block == null) return null;

  return (
    <aside className="detail-panel">
      <p className="eyebrow">Details</p>
      <div className="detail-heading">
        <h2>{block.title}</h2>
        <span>{focusedMinutes([block])} min</span>
      </div>
      <p>{block.summary.narrative}</p>
      <div className="notes-field">
        <span className="notes-label">Notes</span>
        <NotesEditor
          value={props.selectedUserNotes ?? block.notes ?? block.summary.narrative ?? ''}
          onChange={props.onEditNotes}
          placeholder="Add notes…"
        />
      </div>
      <SmallList label="Repos" values={block.repos} />
      <SmallList label="Tickets" values={block.tickets} />
      <SmallList label="Apps" values={block.apps} />
      <SmallList label="Documents" values={block.documents} />
      <SmallList label="URLs" values={block.urls ?? []} />
      <SmallList label="People" values={block.people ?? []} />
      <SmallList label="Key activities" values={block.keyActivities ?? []} />
      <SmallList label="Reason codes" values={block.reasonCodes} />
      <SmallList label="Evidence" values={props.selectedObservationIds} />
      <div className="small-list">
        <strong>Confidence</strong>
        <span>{Math.round(block.confidence * 100)}%</span>
      </div>
    </aside>
  );
});
