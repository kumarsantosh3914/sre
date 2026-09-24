import { IncidentSeverity, SilenceWindow } from '@sreai/shared';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localParts(at: Date, timezone: string): { day: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    // Unknown timezone string: fall back to UTC rather than never paging.
    return localParts(at, 'UTC');
  }
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    day: WEEKDAYS.indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// True when `at` falls inside any silence window (tenant's local time).
// Windows may cross midnight (22:00–07:00): the part after midnight belongs
// to the window that started the previous day.
export function isInSilenceWindow(at: Date, timezone: string, windows: SilenceWindow[]): boolean {
  const { day, minutes } = localParts(at, timezone);
  return windows.some((w) => {
    const start = toMinutes(w.start);
    const end = toMinutes(w.end);
    if (start === end) return false;
    if (start < end) return w.days.includes(day) && minutes >= start && minutes < end;
    const previousDay = (day + 6) % 7;
    return (
      (w.days.includes(day) && minutes >= start) || (w.days.includes(previousDay) && minutes < end)
    );
  });
}

// PRD: "no pages during defined hours unless P1 (user-impacting)".
export function shouldPage(
  severity: IncidentSeverity,
  at: Date,
  timezone: string,
  windows: SilenceWindow[],
): boolean {
  return severity === IncidentSeverity.P1 || !isInSilenceWindow(at, timezone, windows);
}
