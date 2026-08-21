// icsService.js — build .ics calendar attachments for outbound customer emails.
// Introduced 2026-08-21 for Phase B4 (multi-channel confirm on the merged
// /get-quote residential flow). See [[project-quote-flow-integration-plan]].
//
// Design decision — the customer never picked a specific callback time in
// Step 5; sales rings them within 1 business day. So the .ics we ship is a
// SOFT HOLD (STATUS:TENTATIVE + TRANSP:TRANSPARENT + no attendees) at
// 10:00 Pacific/Auckland next business day. Calendar clients render it as
// a proposal, not a firm booking — customer can drag it, ignore it, or
// treat it as a reminder that GoldenRay will call. When Cal.com scheduling
// lands (deferred per project plan), that will replace this with a real
// firm slot.

import ical from 'ical-generator';

const NZ_TZ = 'Pacific/Auckland';

/**
 * Minutes east of UTC that `timeZone` is at `date`.
 * Positive for NZ (UTC+12 or +13 depending on DST).
 */
function offsetMinutesAt(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, +p.value])
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtc - date.getTime()) / 60000;
}

/**
 * Convert a wall-clock time in Pacific/Auckland to a UTC Date, correctly
 * handling both NZST (UTC+12) and NZDT (UTC+13).
 */
function nztWallClockToUtc(y, m, d, hh, mm) {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off   = offsetMinutesAt(guess, NZ_TZ);
  return new Date(guess.getTime() - off * 60000);
}

/**
 * Wall-clock date parts in Pacific/Auckland for a given UTC instant.
 */
function nztPartsOf(utcDate) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NZ_TZ, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(utcDate).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  );
  return {
    year:    +parts.year,
    month:   +parts.month,
    day:     +parts.day,
    hour:    +parts.hour,
    minute:  +parts.minute,
    weekday: parts.weekday, // 'Sun'..'Sat'
  };
}

/**
 * Next business-day 10:00 NZT as a UTC Date. If the current NZT time is
 * before 10 AM on a weekday, we STILL pick tomorrow (never same-day) so
 * sales has real time to prep + call, and the customer's calendar doesn't
 * silently show an event that's already in-progress.
 */
export function nextBusinessDayNzt10am(now = new Date()) {
  const p = nztPartsOf(now);
  // Start with tomorrow NZT.
  let target = nztWallClockToUtc(p.year, p.month, p.day, 10, 0);
  target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  // Skip Sat/Sun.
  for (let i = 0; i < 3; i++) {
    const wd = nztPartsOf(target).weekday;
    if (wd !== 'Sat' && wd !== 'Sun') break;
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }
  // Re-anchor to 10:00 NZT of the resulting NZT date (DST-safe).
  const q = nztPartsOf(target);
  return nztWallClockToUtc(q.year, q.month, q.day, 10, 0);
}

/**
 * Format a NZT wall-clock label like "Fri 22 Aug, 10:00 AM NZT" for use
 * in email bodies. Kept here so email + ics stay in lockstep.
 */
export function formatNztLabel(utcDate) {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone:  NZ_TZ,
    weekday:   'short',
    day:       '2-digit',
    month:     'short',
    hour:      'numeric',
    minute:    '2-digit',
    hour12:    true,
    timeZoneName: 'short',
  }).format(utcDate);
}

/**
 * Build a soft-hold callback .ics as a Buffer + suggested filename.
 *
 * @param {object} opts
 * @param {string} opts.customerName
 * @param {string} opts.customerEmail
 * @param {Date}   [opts.startAt]        UTC Date. Defaults to nextBusinessDayNzt10am().
 * @param {number} [opts.durationMinutes=30]
 * @param {string} [opts.summary]        Event title. Defaults to a GoldenRay-branded summary.
 * @param {string} [opts.description]    Long text. Defaults sensibly if omitted.
 * @param {string} [opts.location]       Defaults to 'Phone call'.
 * @param {string} [opts.organizerName='Goldenray Energy NZ']
 * @param {string} [opts.organizerEmail='proposals@goldenrayenergy.nz']
 * @returns {{buffer: Buffer, filename: string, startAt: Date, endAt: Date, label: string}}
 */
export function buildCallbackHoldIcs({
  customerName,
  customerEmail,
  startAt,
  durationMinutes = 30,
  summary,
  description,
  location = 'Phone call',
  organizerName = 'Goldenray Energy NZ',
  organizerEmail = 'proposals@goldenrayenergy.nz',
} = {}) {
  const start = startAt || nextBusinessDayNzt10am();
  const end   = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const label = formatNztLabel(start);

  // No calendar-level `timezone` on purpose. ical-generator without a tz
  // conversion plugin (moment-tz / luxon) would fall back to the SERVER'S
  // local timezone when formatting Date objects — so on a Render box in
  // UTC we'd get "10:00 UTC" but on our Windows dev box we'd get whatever
  // the machine offset is. Emitting DTSTART/DTEND as UTC (with Z suffix,
  // the ical-generator default when no calendar timezone is set) is
  // unambiguous and every calendar client renders it in the recipient's
  // local time. The email body carries the "10:00 AM NZT" wording so
  // customers aren't left doing tz math.
  const cal = ical({
    name:   'Goldenray Energy — solar callback',
    prodId: { company: 'Goldenray Energy NZ', product: 'Solar Quote Flow', language: 'EN' },
    scale:  'GREGORIAN',
    method: 'PUBLISH',
  });

  const finalSummary = summary
    || `☀ Goldenray solar callback — ${customerName || 'you'}`;
  const finalDescription = description || [
    `Hi ${customerName || 'there'},`,
    ``,
    `This is a soft hold on your calendar. A Goldenray Energy specialist will`,
    `call you around ${label} to walk through your proposal.`,
    ``,
    `Not the right time? Reply to your proposal email and we'll reschedule.`,
    ``,
    `— The Goldenray Energy team`,
    `proposals@goldenrayenergy.nz · +64 21 839 356`,
  ].join('\n');

  cal.createEvent({
    start,
    end,
    summary:      finalSummary,
    description:  finalDescription,
    location,
    status:       'TENTATIVE',    // soft hold, not confirmed
    transparency: 'TRANSPARENT',  // does not block time on the customer's calendar
    organizer:    { name: organizerName, email: organizerEmail },
    // No attendees on purpose — attendee blocks make some clients (Outlook)
    // treat the invite as a firm booking that generates ACCEPT/DECLINE
    // responses, which is not what we want for a soft callback hold.
  });

  const filename = 'goldenray-callback-hold.ics';
  const buffer = Buffer.from(cal.toString(), 'utf-8');
  return { buffer, filename, startAt: start, endAt: end, label };
}
