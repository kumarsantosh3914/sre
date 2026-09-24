// Everything collected from customer systems is untrusted text headed
// into an LLM prompt. Strip control characters, neutralise our section
// delimiters and citation tag syntax (so a log line can't close a section
// or forge a citation), and cap line length.
const MAX_LINE_LENGTH = 500;

export function sanitizeLine(raw: string, maxLength: number = MAX_LINE_LENGTH): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/<<<|>>>/g, '···')
    .replace(/\[SOURCE:/gi, '[source-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}
