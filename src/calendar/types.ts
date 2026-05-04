export type CalendarItemKind = 'event' | 'task';

export type CalendarRecurrenceFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly';

export type CalendarRecurrenceRule = {
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  daysOfWeek?: number[];
  until?: string | null;
};

export type UserCalendarItem = {
  id: string;
  kind: CalendarItemKind;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  recurrence: CalendarRecurrenceRule | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type CreateCalendarItemInput = Omit<
  UserCalendarItem,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export type CalendarItemUpdate = Partial<CreateCalendarItemInput>;

