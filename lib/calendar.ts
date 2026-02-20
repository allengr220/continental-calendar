import fs from "fs";
import path from "path";

export const PROJECT_START = "1775-07-04";
export const PROJECT_END = "1776-07-04";

export type DayItem = { title: string; summary?: string; source?: string };
export type DayData = {
  date: string;
  continental_congress: DayItem[];
  battles: DayItem[];
  letters_and_deeds: DayItem[];
};

export function loadDayData(isoDate: string): DayData | null {
  const filePath = path.join(process.cwd(), "data", `${isoDate}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function todayMappedIso(): string {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();

  const afterJul4 = m > 7 || (m === 7 && d >= 4);
  const year = afterJul4 ? 1775 : 1776;

  return `${year}-${pad2(m)}-${pad2(d)}`;
}

export function addDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(
    dt.getUTCDate()
  )}`;
}

export function clampToProject(isoDate: string): string {
  if (isoDate < PROJECT_START) return PROJECT_START;
  if (isoDate > PROJECT_END) return PROJECT_END;
  return isoDate;
}

export function isoToRoute(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `/${y}/${m}/${d}`;
}
export function formatIsoHuman(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Use UTC so the date doesn't shift with timezone
  const dt = new Date(Date.UTC(y, m - 1, d));

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(dt);
}
