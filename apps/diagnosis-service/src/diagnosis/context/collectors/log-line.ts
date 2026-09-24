import { LOG_LINES_LIMIT } from '@sreai/shared';
import { hhmmss } from '../../../common/time';
import { sanitizeLine } from '../sanitize';

export interface LogEvent {
  timestamp: Date;
  message: string;
}

// Structured (JSON) log lines are flattened to "LEVEL message"; plain text
// is kept as-is (its level, if any, is already in the text). Timestamps are
// reduced to HH:MM:SS to save tokens.
export function formatLogEvent(event: LogEvent): string {
  let level: string | null = null;
  let message = event.message.trim();
  if (message.startsWith('{')) {
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      const lvl = parsed.level ?? parsed.severity ?? parsed.lvl;
      const msg = parsed.message ?? parsed.msg ?? parsed.error;
      if (typeof lvl === 'string') level = lvl.toUpperCase();
      if (typeof msg === 'string') {
        const err =
          typeof parsed.error === 'string' && parsed.error !== msg ? ` error=${parsed.error}` : '';
        message = `${msg}${err}`;
      }
    } catch {
      // Not JSON after all — keep the raw line.
    }
  }
  return sanitizeLine(`${hhmmss(event.timestamp)}${level ? ` ${level}` : ''} ${message}`);
}

// Keep the first 50 (startup / onset) and last 150 (most recent) lines.
export function truncateLogEvents(events: LogEvent[], limit: number = LOG_LINES_LIMIT): LogEvent[] {
  if (events.length <= limit) return events;
  const head = Math.floor(limit / 4);
  return [...events.slice(0, head), ...events.slice(events.length - (limit - head))];
}
