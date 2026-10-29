import { z } from 'zod';

const identifier = z.string().min(1).max(64);
export const operatingSettingsSchema = z.object({
  frequency: z.number().int().min(1).max(65535).optional(), coreVoltage: z.number().int().min(1).max(65535).optional(),
  autofanspeed: z.union([z.literal(0), z.literal(1)]).optional(), manualFanSpeed: z.number().int().min(0).max(100).optional(),
}).strict().refine(s => Object.keys(s).length > 0)
  .refine(s => s.manualFanSpeed === undefined || s.autofanspeed === 0);
export const changePointSchema = z.object({ id: identifier, name: z.string().trim().min(1).max(80),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(d => new Set(d).size === d.length),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict();
export const scheduleSchema = z.object({ name: z.string().trim().min(1).max(80),
  timeZone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }),
  points: z.array(changePointSchema).min(1).max(32),
  members: z.array(z.object({ deviceId: identifier, assignments: z.record(identifier, identifier),
    customValuesAcknowledged: z.boolean().default(false),
  }).strict()).max(500),
}).strict().superRefine((s, ctx) => {
  const seen = new Set<string>(), ids = new Set<string>();
  for (const p of s.points) {
    if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: 'duplicatePoint' });
    ids.add(p.id);
    for (const day of p.days) {
      const key = `${day}:${p.time}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: 'overlappingPoints' });
      seen.add(key);
    }
  }
  if (new Set(s.members.map(m => m.deviceId)).size !== s.members.length) ctx.addIssue({ code: 'custom', message: 'duplicateMiner' });
  for (const member of s.members) if (Object.keys(member.assignments).some(id => !ids.has(id))) ctx.addIssue({ code: 'custom', message: 'unknownPoint' });
});
export type OperatingSettings = z.infer<typeof operatingSettingsSchema>;
export type ChangePoint = z.infer<typeof changePointSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type Occurrence = { pointId: string; name: string; at: string };
export type ScheduleView = ScheduleInput & { id: string; enabled: boolean; revision: number;
  current: Occurrence; next: Occurrence;
  results: { deviceId: string; profileName: string | null; status: string; reason: string | null; overrideUntil: string | null; timestamp: string | null }[];
};
export type SavedOperatingProfile = { id: string; name: string; settings: OperatingSettings };

// Calendar calculations are server-owned. Resolve local times with the offsets
// around the target date: folds choose the first instant, gaps choose their end.
const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(at: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (formatters.size > 100) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(at).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
}
function resolveLocal(local: number, timeZone: string) {
  const offsets = new Set([-36, -12, 0, 12, 36].map(h => { const at = local + h * 3600000; return localParts(at, timeZone) - at; }));
  const matches = [...offsets].map(offset => local - offset).filter(at => localParts(at, timeZone) === local);
  if (matches.length) return Math.min(...matches);
  // A missing local minute resolves to the first valid local minute after it.
  const candidates = [...offsets].map(offset => local - offset).sort((a, b) => a - b);
  for (let at = candidates[0]; at <= candidates[candidates.length - 1]; at += 60000) {
    if (localParts(at, timeZone) >= local) return at;
  }
  throw new Error('invalidLocalTime');
}
export function schedulePeriod(points: ChangePoint[], timeZone: string, now: number): { current: Occurrence; next: Occurrence } {
  const local = new Date(localParts(now, timeZone));
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const occurrences: Occurrence[] = [];
  for (let offset = -8; offset <= 8; offset++) {
    const date = midnight + offset * 86400000;
    for (const point of points) if (point.days.includes(new Date(date).getUTCDay())) {
      const [hour, minute] = point.time.split(':').map(Number);
      occurrences.push({ pointId: point.id, name: point.name, at: new Date(resolveLocal(date + hour * 3600000 + minute * 60000, timeZone)).toISOString() });
    }
  }
  occurrences.sort((a, b) => a.at.localeCompare(b.at) || a.pointId.localeCompare(b.pointId));
  const stamp = new Date(now).toISOString();
  return { current: occurrences.filter(o => o.at <= stamp).at(-1)!, next: occurrences.find(o => o.at > stamp)! };
}
