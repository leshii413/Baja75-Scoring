// Discord posts from a BeamJoy Revived server, pasted as copied. Dates are read in the device's time zone: pin it for the test.
process.env.TZ = 'Asia/Singapore';
import { describe, expect, it } from 'vitest';
import { NO_DATA } from '../csv';
import { discordDate, looksLikeDiscordResults, parseDiscordResults } from '../parseDiscord';
import { parseRaceLog } from '../parseLog';

const HILLY = `hilly
BAJA75 Series: October 3rd Race
\`38:32.360\`
New server record, 0.579s faster than their old best
Leaderboard
#1 of 4
Best lap
\`6:27.173\`
Laps
4
Vehicle
SP Dunekicker (2008) (custom)
-►Baja75 Casual Server•10/6/2026 1:09 PM`;

const FOX = `DH_FOX911
BAJA75 Series: October 3rd Race
\`37:54.771\`
Not counted for the leaderboard (anti-cheat options or the vehicle rule were changed)
Best lap
\`7:59.556\`
Laps
3
Vehicle
Brenthel Gen3 Trophy Truck - Mike Marsal
Record
\`6:27.173\` hilly
-►Baja75 Casual Server•10/7/2026 9:39 AM`;

// what Discord gives when a whole stretch of the channel is copied: bot header, date divider, two posts
const CHANNEL = `-►Baja75 Casual Server APP — 10/6/2026 1:09 PM
${HILLY}
October 7, 2026
-►Baja75 Casual Server APP — Yesterday at 9:39 AM
${FOX}`;

describe('Discord (BeamJoy Revived) results', () => {
  it('reads a single post as pasted', () => {
    expect(looksLikeDiscordResults(HILLY)).toBe(true);
    const p = parseDiscordResults(HILLY);
    expect(p.rejected).toEqual([]);
    expect(p.runs).toHaveLength(1);
    const r = p.runs[0];
    expect(r.sourceDriver).toBe('hilly');
    expect(r.courseName).toBe('BAJA75 Series: October 3rd Race');
    expect(r.elapsedMs).toBe(38 * 60000 + 32360);
    expect(r.precisionMs).toBe(1);
    expect(r.status).toBe('FINISHED');
    expect(r.vehicle).toBe('SP Dunekicker (2008) (custom)');
    expect(r.configText).toBe('SP Dunekicker (2008) (custom)');
    expect(r.modelId).toBeNull();
    expect(r.raw.split('\n').at(-1)).toBe('-►Baja75 Casual Server•10/6/2026 1:09 PM');
    expect(r.timestampText).toBe('2026-10-06 13:09:00 UTC+08:00');
    expect(r.utcIso).toBe('2026-10-06T05:09:00Z');
    expect(r.unknownFields).toMatchObject({ server: 'Baja75 Casual Server', laps: '4', 'best lap': '6:27.173', leaderboard: '#1 of 4' });
    expect(r.unknownFields.notes).toContain('New server record');
    expect(Object.values(r.counters)).toEqual(Array(8).fill(0));
    expect(r.noData).toEqual(['number', 'map', 'off_course', 'wrong_way', 'speeding', 'missed_vcps', 'jump_starts', 'resets', 'recoveries', 'damage']);
    expect(r.issues[0]).toBe('From Discord (BeamJoy Revived), server: Baja75 Casual Server');
    expect(r.issues.join(' ')).toContain(`${NO_DATA}:`);
  });

  it('the Record line (someone else\'s best lap) is not taken as the time', () => {
    const r = parseDiscordResults(FOX).runs[0];
    expect(r.sourceDriver).toBe('DH_FOX911');
    expect(r.elapsedMs).toBe(37 * 60000 + 54771);
    expect(r.unknownFields['server record']).toBe('6:27.173 hilly');
    expect(r.issues.join(' ')).toContain('Not counted for the leaderboard');
    expect(r.timestampText).toBe('2026-10-07 09:39:00 UTC+08:00');
  });

  it('reads several posts copied from the channel, ignoring Discord\'s own header and date lines', () => {
    const p = parseDiscordResults(CHANNEL);
    expect(p.rejected).toEqual([]);
    expect(p.runs.map((r) => [r.sourceDriver, r.elapsedMs])).toEqual([['hilly', 2312360], ['DH_FOX911', 2274771]]);
    expect(p.runs[0].vehicle).toBe('SP Dunekicker (2008) (custom)');
    expect(p.runs[1].vehicle).toBe('Brenthel Gen3 Trophy Truck - Mike Marsal');
    // each saved source text stops at its own footer (no divider or header lines from the next post)
    expect(p.runs[0].raw).not.toContain('October 7, 2026');
    expect(p.runs[0].raw.split('\n').at(-1)).toBe('-►Baja75 Casual Server•10/6/2026 1:09 PM');
  });

  it('any server name works and is only a note', () => {
    const other = HILLY.replace('-►Baja75 Casual Server', 'Dusty Trails Racing League');
    const r = parseDiscordResults(other).runs[0];
    expect(r.unknownFields.server).toBe('Dusty Trails Racing League');
    expect(r.issues[0]).toBe('From Discord (BeamJoy Revived), server: Dusty Trails Racing League');
    expect(r.issues.join(' ')).not.toMatch(/unknown server/i);
  });

  it('the same post pasted twice gets the same fingerprint (so it is a duplicate, not a second run)', () => {
    expect(parseDiscordResults(HILLY).runs[0].fingerprint).toBe(parseDiscordResults(`\n\n${HILLY}\n`).runs[0].fingerprint);
    expect(parseDiscordResults(HILLY).runs[0].fingerprint).not.toBe(parseDiscordResults(FOX).runs[0].fingerprint);
  });

  it('Discord dates', () => {
    const now = new Date(2026, 9, 8, 12, 0);
    expect(discordDate('10/6/2026 1:09 PM', now)?.stamp).toBe('2026-10-06 13:09:00 UTC+08:00');
    expect(discordDate('10/6/2026 12:05 AM', now)?.stamp).toBe('2026-10-06 00:05:00 UTC+08:00');
    expect(discordDate('Yesterday at 9:39 AM', now)).toEqual({ stamp: '2026-10-07 09:39:00 UTC+08:00', relative: true });
    expect(discordDate('Today at 9:39 PM', now)?.stamp).toBe('2026-10-08 21:39:00 UTC+08:00');
    expect(discordDate('13/6/2026 1:09 PM', now)).toBeNull();
  });

  it('a missing footer still imports, with the date as No Data Provided', () => {
    const r = parseDiscordResults(HILLY.split('\n').slice(0, -1).join('\n')).runs[0];
    expect(r.timestampText).toBe('');
    expect(r.noData).toContain('date');
  });

  it('run logs are not mistaken for Discord posts', () => {
    const log = '2026-10-07 08:38:06 UTC+08:00 | Map: johnson_valley | Course: route 1 | Time: 4:16.8 | Vehicle: X (utv) | Off course: 0';
    expect(looksLikeDiscordResults(log)).toBe(false);
    expect(parseRaceLog(log).runs).toHaveLength(1);
  });
});
