import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DomainError } from '../errors.js';
import { chinaCalendarData } from './china-calendar-data.js';

export interface CalendarYear {
  year: number;
  papers: string[];
  days: { date: string; isOffDay: boolean; name: string }[];
}
export class CalendarUnavailableError extends DomainError {
  constructor(readonly year: number) {
    super(`等待更新 ${year} 年中国大陆节假日日历`);
  }
}
export function parseCalendarYear(input: unknown, year: number): CalendarYear {
  const v = input as Partial<CalendarYear> | null;
  if (
    !v ||
    v.year !== year ||
    !Number.isInteger(year) ||
    year < 2007 ||
    year > 2100 ||
    !Array.isArray(v.papers) ||
    !v.papers.length ||
    v.papers.some((p) => typeof p !== 'string' || !/^https:\/\/(?:www\.)?gov\.cn\//.test(p)) ||
    !Array.isArray(v.days) ||
    !v.days.length ||
    v.days.length > 366
  )
    throw new Error('节假日日历格式无效');
  const dates = new Set<string>();
  for (const day of v.days) {
    if (
      !day ||
      typeof day.date !== 'string' ||
      !new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(day.date) ||
      !Number.isFinite(Date.parse(day.date)) ||
      new Date(day.date).toISOString().slice(0, 10) !== day.date ||
      typeof day.isOffDay !== 'boolean' ||
      typeof day.name !== 'string' ||
      !day.name ||
      day.name.length > 80 ||
      dates.has(day.date)
    )
      throw new Error('节假日日历日期无效');
    dates.add(day.date);
  }
  return { year, papers: [...v.papers], days: v.days.map((d) => ({ ...d })) };
}

async function downloadYear(year: number, signal: AbortSignal): Promise<CalendarYear | null> {
  const response = await fetch(
    `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      redirect: 'error',
    },
  );
  if (response.status === 404) return null;
  if (!response.ok || !response.body) throw new Error('节假日日历下载失败');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw new Error('节假日日历过大');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return parseCalendarYear(JSON.parse(Buffer.concat(chunks).toString('utf8')), year);
}

/** Public yearly data is cached separately from user configuration. */
export class ChinaCalendar {
  private years = new Map<number, CalendarYear>();
  private loaded = new Set<number>();
  private timer?: ReturnType<typeof setInterval>;
  private controller?: AbortController;
  private active?: Promise<boolean>;
  private nextRefresh = 0;
  private stopped = false;
  constructor(
    private readonly dataDir?: string,
    private readonly loadYear = downloadYear,
  ) {
    for (const year of chinaCalendarData)
      this.years.set(year.year, parseCalendarYear(year, year.year));
  }
  private get(year: number) {
    if (!this.loaded.has(year)) {
      this.loaded.add(year);
      if (this.dataDir) {
        try {
          const file = readFileSync(path.join(this.dataDir, 'reminder-calendars', `${year}.json`));
          if (file.length <= 65536)
            this.years.set(year, parseCalendarYear(JSON.parse(file.toString('utf8')), year));
        } catch {
          /* A damaged or absent cache never replaces bundled data. */
        }
      }
    }
    return this.years.get(year);
  }
  matches(date: string, mode: 'cn-workday' | 'cn-holiday') {
    const year = Number(date.slice(0, 4));
    const calendar = this.get(year);
    if (!calendar) throw new CalendarUnavailableError(year);
    const day = calendar.days.find((d) => d.date === date);
    if (mode === 'cn-holiday') return day?.isOffDay === true;
    const weekday = new Date(date).getUTCDay();
    return day ? !day.isOffDay : weekday !== 0 && weekday !== 6;
  }
  refresh(year: number, force = false): Promise<boolean> {
    if (this.stopped || !this.dataDir || (!force && Date.now() < this.nextRefresh))
      return Promise.resolve(false);
    if (this.active) return force ? this.active.then(() => this.refresh(year, true)) : this.active;
    this.nextRefresh = Date.now() + 6 * 3600000;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.active = (async () => {
      let changed = false;
      for (const y of [year, year + 1]) {
        if (signal.aborted || this.stopped) break;
        try {
          const result = await this.loadYear(y, signal);
          if (!result || signal.aborted || this.stopped) continue;
          const data = parseCalendarYear(result, y);
          const before = JSON.stringify(this.get(y));
          const folder = path.join(this.dataDir!, 'reminder-calendars');
          mkdirSync(folder, { recursive: true, mode: 0o700 });
          const file = path.join(folder, `${y}.json`);
          writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 });
          renameSync(file + '.tmp', file);
          this.years.set(y, data);
          changed ||= JSON.stringify(data) !== before;
        } catch {
          /* Keep verified local data and retry on the next refresh. */
        }
      }
      return changed;
    })().finally(() => {
      this.active = undefined;
      this.controller = undefined;
    });
    return this.active;
  }
  start(needed: () => boolean, onUpdated: () => void) {
    if (this.timer || this.stopped) return;
    const refresh = () => {
      if (needed())
        void this.refresh(new Date(Date.now() + 8 * 3600000).getUTCFullYear())
          .then((changed) => {
            if (changed && !this.stopped) onUpdated();
          })
          .catch(() => {});
    };
    this.timer = setInterval(refresh, 60000);
    this.timer.unref();
    refresh();
  }
  async close() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    await this.active;
  }
}

export const defaultChinaCalendar = new ChinaCalendar();
