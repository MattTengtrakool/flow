import type { WorklogCalendarBlock } from '../../src/worklog/types';

export type CalendarView = 'month' | 'week' | 'day';

export function toDateIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateFromIso(dateIso: string): Date {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

export function addDaysIso(dateIso: string, days: number): string {
  const date = dateFromIso(dateIso);
  date.setDate(date.getDate() + days);
  return toDateIso(date);
}

export function addMonthsIso(dateIso: string, months: number): string {
  const date = dateFromIso(dateIso);
  date.setMonth(date.getMonth() + months, 1);
  return toDateIso(date);
}

export function mondayOfIso(dateIso: string): string {
  const date = dateFromIso(dateIso);
  const dayOfWeek = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayOfWeek);
  return toDateIso(date);
}

export function monthGridDateIsos(anchorIso: string): string[] {
  const anchor = dateFromIso(anchorIso);
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = dateFromIso(toDateIso(firstOfMonth));
  const dayOfWeek = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dayOfWeek);
  const result: string[] = [];
  for (let index = 0; index < 42; index += 1) {
    result.push(toDateIso(start));
    start.setDate(start.getDate() + 1);
  }
  return result;
}

export function dateRangeForView(
  view: CalendarView,
  anchorIso: string,
): string[] {
  if (view === 'month') return monthGridDateIsos(anchorIso);
  if (view === 'week') {
    const start = mondayOfIso(anchorIso);
    return Array.from({ length: 7 }, (_, index) => addDaysIso(start, index));
  }
  return [anchorIso];
}

export function focusedMinutes(blocks: WorklogCalendarBlock[]): number {
  return blocks.reduce(
    (sum, block) =>
      sum +
      Math.max(
        0,
        Math.round(
          (Date.parse(block.endTime) - Date.parse(block.startTime)) / 60000,
        ),
      ),
    0,
  );
}
