// taskParser.ts — pure functions, no Obsidian dependencies

export interface Task {
  id: string;
  raw: string;
  name: string;
  durationMinutes: number;
  category: string;
  completed: boolean;
  lineIndex: number;
}

// Matches duration tokens: 1m, 15m, 1h, 2h, 1h30m, etc.
const DURATION_RE = /(\d+h\d+m|\d+h|\d+m)$/;
// Matches a category tag at the end: -word (preceded by whitespace or start)
const CATEGORY_RE = /\s(-\w+)$/;

export function parseDurationToken(token: string): number {
  const hmMatch = token.match(/^(\d+)h(\d+)m$/);
  if (hmMatch) return parseInt(hmMatch[1]!) * 60 + parseInt(hmMatch[2]!);
  const hMatch = token.match(/^(\d+)h$/);
  if (hMatch) return parseInt(hMatch[1]!) * 60;
  const mMatch = token.match(/^(\d+)m$/);
  if (mMatch) return parseInt(mMatch[1]!);
  return 0;
}

export function formatDuration(minutes: number): string {
  if (minutes === 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function formatTime(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const mm = minutes.toString().padStart(2, "0");
  return `${hours}:${mm} ${ampm}`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

export function parseLine(line: string, lineIndex: number): Task | null {
  const trimmed = line.trimEnd();
  // Must start with "- " (task list item)
  if (!trimmed.startsWith("- ")) return null;

  let content = trimmed.slice(2).trim();
  if (!content) return null;

  // Detect and strip markdown checkbox prefix: - [x] or - [ ]
  let completed = false;
  if (/^\[.\]\s/.test(content)) {
    completed = /^\[x\]/i.test(content); // [x] = done, [ ] = not done
    const completedMatch = content.match(/^\[.\]\s+(.*)/);
    content = completedMatch
      ? completedMatch[1]!.trim()
      : content.slice(4).trim();
  }

  // Extract category: last " -word" at end of line
  let category = "other";
  const catMatch = content.match(CATEGORY_RE);
  if (catMatch) {
    category = catMatch[1]!.slice(1).toLowerCase(); // strip leading "-"
    content = content.slice(0, catMatch.index).trimEnd();
  }

  // Extract duration: last duration token at end
  let durationMinutes = 0;
  const durMatch = content.match(DURATION_RE);
  if (durMatch) {
    durationMinutes = parseDurationToken(durMatch[1]!);
    content = content.slice(0, content.length - durMatch[0]!.length).trimEnd();
  }

  const name = content.trim();
  if (!name) return null;

  return {
    id: generateId(),
    raw: line,
    name,
    durationMinutes,
    category,
    completed,
    lineIndex,
  };
}

export function parseNote(content: string): Task[] {
  const lines = content.split("\n");
  const tasks: Task[] = [];
  for (let i = 0; i < lines.length; i++) {
    const task = parseLine(lines[i]!, i);
    if (task !== null) tasks.push(task);
  }
  return tasks;
}

export function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function generateId(): string {
  // Simple unique ID without external deps
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}
