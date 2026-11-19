// Threat numbers for the bot boss runs (docs/ROADMAP.md J4), shared by test/wardenskill.js and test/floor3boss.js:
//  - the tank's share of boss time: snapshots where the boss (engaged) is after the party's Guardian;
//  - each taunt lock's end (server log `[threat] lockend`, needs THREAT_STATS=1): every other fighter's threat as % of L.
// NO_TAUNT=1 makes the bot Guardians never taunt (to compare). Not a test on its own.
export function threatWatch(team, bossType) {
  if (process.env.NO_TAUNT) for (const b of team) if (b.cls === 'guardian') b.noTaunt = true;
  const W = { on: 0, tank: 0 };
  return {
    snap(msg) {
      const boss = msg.w.mobs.find(m => m[1] === bossType);
      const tgt = boss && new Map(msg.w.th || []).get(boss[0]);
      if (!tgt) return;
      W.on++;
      if (team.some(b => b.id === tgt && b.cls === 'guardian')) W.tank++;
    },
    // { share, locks, dps: [pct...], heal: [pct...] } from this run's server log
    report(log) {
      const dps = [], heal = [];
      let locks = 0;
      for (const m of log.matchAll(/\[threat\] lockend \w+ by \w+ L \d+(.*)/g)) {
        locks++;
        for (const [, cls, pct] of m[1].matchAll(/(\w+):(\d+)/g)) (cls === 'cleric' ? heal : dps).push(+pct);
      }
      return { share: W.on ? Math.round((100 * W.tank) / W.on) : null, locks, dps, heal };
    },
  };
}
const avg = a => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : '-');
export const threatLine = r => r ? ` · threat: tank held it ${r.share ?? '-'}% · ${r.locks} locks, DPS at lock end ${avg(r.dps)}% of L (${r.dps.length ? `${Math.min(...r.dps)}–${Math.max(...r.dps)}` : '-'}), healer ${avg(r.heal)}%` : '';
export const threatSummary = out => {
  const all = out.map(r => r.threat).filter(Boolean), dps = all.flatMap(r => r.dps), sh = all.map(r => r.share).filter(v => v !== null);
  const inBand = dps.filter(v => v >= 75 && v <= 85).length;
  return ` · tank share ${avg(sh)}% · DPS at lock end avg ${avg(dps)}% (median ${dps.length ? [...dps].sort((a, b) => a - b)[dps.length >> 1] : '-'}, ${dps.length ? Math.round((100 * inBand) / dps.length) : '-'}% in 75–85) over ${all.reduce((s, r) => s + r.locks, 0)} locks${process.env.NO_TAUNT ? ' [NO_TAUNT]' : ''}${process.env.THREAT_LIST ? ` [${[...dps].sort((a, b) => a - b).join(' ')}]` : ''}`;
};
