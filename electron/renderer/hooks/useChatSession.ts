import { useCallback, useState } from 'react';

import type { ChatMessage } from '../../../src/chat/runChat';
import { getCalendarEventMode } from '../../../src/calendar/calendarLogic';
import type {
  CalendarEventAnnotationView,
  CalendarSourceView,
  ExternalCalendarEventView,
} from '../../../src/calendar/types';
import type { TimelineView } from '../../../src/timeline/eventLog';
import type { WorklogCalendarBlock } from '../../../src/worklog/types';
import type { FlowElectronApi } from '../../shared/flowApi';

export function useChatSession(args: {
  flow: FlowElectronApi | undefined;
  timeline: TimelineView;
  timezone: string;
  selectedDateIso: string;
  selectedBlock: WorklogCalendarBlock | null;
  selectedCalendarEvent: ExternalCalendarEventView | null;
  selectedCalendarEventAnnotation: CalendarEventAnnotationView | null;
  selectedCalendarEventSource: CalendarSourceView | null;
}) {
  const {
    flow,
    selectedBlock,
    selectedCalendarEvent,
    selectedCalendarEventAnnotation,
    selectedCalendarEventSource,
    selectedDateIso,
    timeline,
    timezone,
  } = args;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');

  const send = useCallback(async () => {
    const content = draft.trim();
    if (content.length === 0) return;

    const conversation = messages;
    const userMessage: ChatMessage = {
      id: `chat_${Date.now()}_user`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    setMessages(previous => [...previous, userMessage]);
    setDraft('');
    setLoading(true);
    try {
      if (flow == null) {
        throw new Error('Electron bridge missing.');
      }
      const result = await flow.chat.runTurn({
        conversation,
        userMessage: content,
        timeline,
        timezone,
        selectedContext: {
          selectedDateIso,
          selectedBlock:
            selectedBlock != null
              ? {
                  id: selectedBlock.id,
                  title: selectedBlock.title,
                  startTime: selectedBlock.startTime,
                  endTime: selectedBlock.endTime,
                }
              : null,
          selectedCalendarEvent:
            selectedCalendarEvent != null
              ? {
                  id: selectedCalendarEvent.id,
                  title: selectedCalendarEvent.title,
                  startTime: selectedCalendarEvent.startTime,
                  endTime: selectedCalendarEvent.endTime,
                  busy: selectedCalendarEvent.busy,
                  mode: getCalendarEventMode(
                    selectedCalendarEvent,
                    selectedCalendarEventSource,
                    selectedCalendarEventAnnotation,
                  ),
                  annotation:
                    selectedCalendarEventAnnotation != null
                      ? {
                          notes: selectedCalendarEventAnnotation.notes,
                          outcome: selectedCalendarEventAnnotation.outcome,
                          followUps: selectedCalendarEventAnnotation.followUps,
                          modeOverride:
                            selectedCalendarEventAnnotation.modeOverride,
                          confirmedBlockIds:
                            selectedCalendarEventAnnotation.confirmedBlockIds,
                          dismissedBlockIds:
                            selectedCalendarEventAnnotation.dismissedBlockIds,
                        }
                      : null,
                }
              : null,
        },
      });
      setMessages(previous => [...previous, result.assistantMessage]);
    } catch (error) {
      setMessages(previous => [
        ...previous,
        {
          id: `chat_${Date.now()}_error`,
          role: 'assistant',
          content:
            error instanceof Error ? error.message : 'Chat request failed.',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [
    draft,
    flow,
    messages,
    selectedBlock,
    selectedCalendarEvent,
    selectedCalendarEventAnnotation,
    selectedCalendarEventSource,
    selectedDateIso,
    timeline,
    timezone,
  ]);

  return {
    messages,
    loading,
    draft,
    setDraft,
    send,
  };
}
