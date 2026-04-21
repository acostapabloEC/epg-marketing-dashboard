import { useState, useEffect } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

const weeklyData = [
  { week: "Jan 05", engagements: 49,  impressions: 3648,  posts: 3  },
  { week: "Jan 12", engagements: 359, impressions: 21385, posts: 8  },
  { week: "Jan 19", engagements: 104, impressions: 9534,  posts: 6  },
  { week: "Jan 26", engagements: 154, impressions: 15452, posts: 7  },
  { week: "Feb 02", engagements: 96,  impressions: 9714,  posts: 8  },
  { week: "Feb 09", engagements: 229, impressions: 20769, posts: 10 },
  { week: "Feb 16", engagements: 85,  impressions: 12127, posts: 9  },
  { week: "Feb 23", engagements: 138, impressions: 9501,  posts: 9  },
  { week: "Mar 02", engagements: 198, impressions: 12040, posts: 22 },
  { week: "Mar 09", engagements: 130, impressions: 12579, posts: 25 },
  { week: "Mar 16", engagements: 190, impressions: 9776,  posts: 26 },
  { week: "Mar 23", engagements: 44,  impressions: 8379,  posts: 24 },
  { week: "Mar 30", engagements: 86,  impressions: 9787,  posts: 7  },
  { week: "Apr 06", engagements: 93,  impressions: 8771,  posts: 16 },
  { week: "Apr 13", engagements: 144, impressions: 10993, posts: 10 },
];

const monthlyData = [
  { month: "Jan", engagements: 611, goal: 750 },
  { month: "Feb", engagements: 543, goal: 750 },
  { month: "Mar", engagements: 591, goal: 750 },
  { month: "Apr*", engagements: 316, goal: 750 },
];

const topPosts = [
  { date: "Jan 12", engagements: 253, impressions: 12689, format: "Photo",  preview: "Son Taylor sworn into the bar at NJ Supreme Court — a proud father moment" },
  { date: "Mar 20", engagements: 99,  impressions: 4359,  format: "Photo",  preview: "Farewell to Benjamin Hassett after 4 years at Elite Consulting Partners" },
  { date: "Feb 09", engagements: 98,  impressions: 9729,  format: "Link",   preview: "MassMutual's Private Wealth Division — what advisors should pay attention to" },
  { date: "Jan 15", engagements: 69,  impressions: 3953,  format: "Status", preview: "Cetera/Osaic rumors: separating fact from speculation" },
  { date: "Feb 14", engagements: 65,  impressions: 5023,  format: "Photo",  preview: "Valentine's Day: building Elite and building a life with Kim" },
];

const formatColors = { Photo: "#3fb950", Link: "#c9a84c", Status: "#58a6ff", Video: "#f85149" };

const formatMix = [
  { name: "Photo",  avgEng: 25.7, avgImpr: 1645, totalEng: 103, totalImpr: 6580,  color: "#3fb950" },
  { name: "Link",   avgEng: 8.2,  avgImpr: 1400, totalEng: 197, totalImpr: 33600, color: "#c9a84c" },
  { name: "Status", avgEng: 6.1,  avgImpr: 933,  totalEng: 159, totalImpr: 24258, color: "#58a6ff" },
  { name: "Video",  avgEng: 4.8,  avgImpr: 429,  totalEng: 432, totalImpr: 38610, color: "#f85149" },
];

const GOLD     = "#c9a84c";
const GOLD_DIM = "rgba(201,168,76,0.15)";
const GREEN    = "#3fb950";
const GREEN_DIM= "rgba(63,185,80,0.12)";
const RED      = "#f85149";
const RED_DIM  = "rgba(248,81,73,0.12)";
const BLUE     = "#58a6ff";
const BLUE_DIM = "rgba(88,166,255,0.1)";
const PURPLE   = "#a855f7";
const MUTED    = "#8892a4";
const BORDER   = "rgba(255,255,255,0.07)";
const SURFACE  = "#111827";

function KpiCard({ source, label, value, delta, deltaLabel, accent, large, sub }) {
  const isUp = delta > 0;
  return (
    <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent || GOLD, borderRadius: "12px 12px 0 0" }} />
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: 2, color: MUTED, textTransform: "uppercase", marginBottom: 8 }}>{source}</div>
      <div style={{ fontSize: 13, color: "#a0aab4", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: large ? 52 : 40, fontWeight: 700, color: "#f0f6fc", lineHeight: 1, marginBottom: 10 }}>{value}</div>
      {delta !== undefined && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: isUp ? GREEN_DIM : RED_DIM, color: isUp ? GREEN : RED, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 20, width: "fit-content" }}>
          {isUp ? "↑" : "↓"} {Math.abs(delta)}%
        </div>
      )}
      {deltaLabel && <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>{deltaLabel}</div>}
      {sub && <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a2235", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 13, color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{p.value?.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  const h = time.getHours() % 12 || 12;
  const m = String(time.getMinutes()).padStart(2, "0");
  const ampm = time.getHours() >= 12 ? "PM" : "AM";
  return <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: "#f0f6fc", letterSpacing: 1 }}>{h}:{m} {ampm}</span>;
}

export default function App() {
  const engMoM  = Math.round(((591 - 543) / 543) * 100);
  const imprMoM = Math.round(((46576 - 52925) / 52925) * 100);
  const follMoM = Math.round(((163 - 138) / 138) * 100);
  const aprEng  = 316;
  const aprGoal = 750;
  const aprPct  = Math.round((aprEng / aprGoal) * 100);
  const maxFmtEng = Math.max(...formatMix.map(f => f.avgEng));

  return (
    <div style={{ background: "#0a0f1e", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", color: "#f0f6fc" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0a0f1e; }
        ::-webkit-scrollbar-thumb { background: #2a3445; border-radius: 3px; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.85)} }
      `}</style>

      {/* HEADER */}
      <div style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 60, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 36, height: 36, background: GOLD, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, color: "#0a0f1e" }}>E</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Elite Partners Group — Marketing Performance</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: MUTED, letterSpacing: 1, textTransform: "uppercase" }}>Frank LaRosa · LinkedIn · Jan – Apr 20, 2026</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", background: GOLD_DIM, color: GOLD, padding: "5px 12px", borderRadius: 6, border: `1px solid rgba(201,168,76,0.2)` }}>Jan – Apr 20, 2026</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MUTED }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, animation: "pulse 2s infinite" }} />
            Live Dashboard
          </div>
          <Clock />
        </div>
      </div>

      <div style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>

        {/* Q2 GOAL BANNER */}
        <div style={{ background: "linear-gradient(135deg, #1a1600 0%, #0f1208 100%)", border: `1px solid rgba(201,168,76,0.25)`, borderRadius: 12, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 13, color: GOLD, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Q2 Goal — Frank LinkedIn Engagements</div>
            <div style={{ fontSize: 13, color: MUTED }}>
              Target: <span style={{ color: "#f0f6fc", fontWeight: 600 }}>2,250</span> total · Weekly: <span style={{ color: "#f0f6fc", fontWeight: 600 }}>187</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>April Progress</div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: aprPct >= 50 ? GREEN : RED }}>{aprEng} / 750</div>
              <div style={{ fontSize: 10, color: MUTED }}>{aprPct}% of goal · Apr 20</div>
            </div>
            {[{ label: "May Goal", val: "700" }, { label: "June Goal", val: "800" }].map((g) => (
              <div key={g.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>{g.label}</div>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: GOLD }}>{g.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ROW 1: KPI CARDS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
          <KpiCard source="LinkedIn · Frank LaRosa" label="Total Engagements (Mar)" value="591" delta={engMoM} deltaLabel="vs Feb (543)" accent={GOLD} large />
          <KpiCard source="LinkedIn · Frank LaRosa" label="Total Impressions (Mar)" value="46.6K" delta={imprMoM} deltaLabel="vs Feb (52.9K)" accent={BLUE} />
          <KpiCard source="LinkedIn · Frank LaRosa" label="New Followers (Mar)" value="163" delta={follMoM} deltaLabel="vs Feb (138)" accent={GREEN} />
          <KpiCard source="LinkedIn · Frank LaRosa" label="Total Followers" value="12,780" accent={PURPLE} sub="As of April 20, 2026" />
        </div>

        {/* ROW 2: CHARTS */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Weekly Engagements & Impressions — Frank LaRosa LinkedIn</div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 12 }}>Jan–Apr 2026 · Green dashed = 187 weekly engagement goal</div>
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart data={weeklyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="engGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={GOLD} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="imprGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BLUE} stopOpacity={0.1} />
                    <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis dataKey="week" tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: MUTED }} />
                <ReferenceLine yAxisId="left" y={187} stroke={GREEN} strokeDasharray="4 4" label={{ value: "Weekly Goal", fill: GREEN, fontSize: 10, position: "insideTopRight" }} />
                <Area yAxisId="left" type="monotone" dataKey="engagements" name="Engagements" stroke={GOLD} strokeWidth={2.5} fill="url(#engGrad)" dot={false} activeDot={{ r: 5, fill: GOLD }} />
                <Area yAxisId="right" type="monotone" dataKey="impressions" name="Impressions" stroke={BLUE} strokeWidth={1.5} fill="url(#imprGrad)" strokeDasharray="5 4" dot={false} />
              </AreaChart>
            </ResponsiveContainer>

            <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 16, paddingTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 8 }}>
                Posts Published Per Week
                <span style={{ fontWeight: 400, fontSize: 10, marginLeft: 8 }}>quality vs. quantity context</span>
              </div>
              <ResponsiveContainer width="100%" height={95}>
                <BarChart data={weeklyData} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="posts" name="Posts" fill={GOLD} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 4, fontStyle: "italic" }}>
                * Counts estimated from monthly totals (Feb 46, Mar 100). Apr weeks confirmed via LinkedIn Analytics export.
              </div>
            </div>
          </div>

          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Monthly Engagements vs Goal</div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>Q1 actuals + Apr partial · Apr=750 · May=700 · Jun=800</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis dataKey="month" tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={750} stroke={GOLD} strokeDasharray="4 4" label={{ value: "Q2 Target", fill: GOLD, fontSize: 10 }} />
                <Bar dataKey="engagements" name="Engagements" fill={GOLD} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 14, padding: "12px 14px", background: "rgba(201,168,76,0.06)", border: `1px solid rgba(201,168,76,0.15)`, borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: GOLD }}>April Progress (20 days)</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: GOLD }}>{aprEng} / 750</span>
              </div>
              <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(aprPct, 100)}%`, background: aprPct >= 50 ? GREEN : GOLD, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>{aprPct}% of monthly goal · 10 days remaining</div>
            </div>
          </div>
        </div>

        {/* ROW 3: YOY SCORECARD */}
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Year-over-Year — March 2025 vs March 2026</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 20 }}>Earliest comparable month available · LinkedIn Analytics Export · Jan–Feb 2025 unavailable (13-month export limit)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

            <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "18px 22px" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: 2, color: MUTED, textTransform: "uppercase", marginBottom: 14 }}>Engagements</div>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: BLUE, marginBottom: 3 }}>Mar 2025</div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 40, fontWeight: 700, color: MUTED, lineHeight: 1 }}>229</div>
                </div>
                <div style={{ fontSize: 24, color: "#2a3445", paddingTop: 16 }}>→</div>
                <div>
                  <div style={{ fontSize: 10, color: GOLD, marginBottom: 3 }}>Mar 2026</div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 40, fontWeight: 700, color: "#f0f6fc", lineHeight: 1 }}>591</div>
                </div>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: GREEN_DIM, color: GREEN, fontSize: 14, fontWeight: 600, padding: "5px 14px", borderRadius: 20 }}>↑ +158%</div>
            </div>

            <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "18px 22px" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: 2, color: MUTED, textTransform: "uppercase", marginBottom: 14 }}>Impressions</div>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: BLUE, marginBottom: 3 }}>Mar 2025</div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 40, fontWeight: 700, color: MUTED, lineHeight: 1 }}>25K</div>
                </div>
                <div style={{ fontSize: 24, color: "#2a3445", paddingTop: 16 }}>→</div>
                <div>
                  <div style={{ fontSize: 10, color: GOLD, marginBottom: 3 }}>Mar 2026</div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 40, fontWeight: 700, color: "#f0f6fc", lineHeight: 1 }}>46K</div>
                </div>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: GREEN_DIM, color: GREEN, fontSize: 14, fontWeight: 600, padding: "5px 14px", borderRadius: 20 }}>↑ +84%</div>
            </div>

          </div>
        </div>

        {/* ROW 4: BOTTOM */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>

          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Q1 2026 Summary</div>
            {[
              { label: "Total Engagements",  val: "1,745",   color: GOLD   },
              { label: "Total Impressions",   val: "149,474", color: BLUE   },
              { label: "New Followers",        val: "459",    color: GREEN  },
              { label: "Total Followers",      val: "12,780", color: PURPLE },
              { label: "Avg Eng / Month",      val: "582",    color: MUTED  },
              { label: "Posts Published",      val: "~181",   color: MUTED  },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
                <span style={{ fontSize: 13, color: MUTED }}>{item.label}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 600, color: item.color }}>{item.val}</span>
              </div>
            ))}
          </div>

          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Top Posts by Engagements</div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>Jan–Apr 2026 · Top 5 · LinkedIn export</div>
            {topPosts.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", borderRadius: 8, background: i === 0 ? GOLD_DIM : "transparent", marginBottom: 6, border: i === 0 ? `1px solid rgba(201,168,76,0.2)` : "1px solid transparent" }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: i === 0 ? GOLD : MUTED, width: 16, flexShrink: 0, paddingTop: 1 }}>#{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#f0f6fc", lineHeight: 1.4, marginBottom: 3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.preview}</div>
                  <div style={{ fontSize: 10, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{p.date} · {p.impressions.toLocaleString()} impr</span>
                    <span style={{ background: formatColors[p.format] + "22", color: formatColors[p.format], padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600 }}>{p.format}</span>
                  </div>
                </div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600, color: i === 0 ? GOLD : GREEN, flexShrink: 0 }}>{p.engagements}</div>
              </div>
            ))}
          </div>

          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>LinkedIn Format Mix</div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>Avg & total engagements + impressions by content type · Q1 2026</div>
            {formatMix.map((f, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: "#f0f6fc", fontWeight: 500 }}>{f.name}</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: MUTED }}>
                    {f.avgEng} eng avg · {f.avgImpr.toLocaleString()} impr avg
                  </span>
                </div>
                <div style={{ height: 7, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", marginBottom: 3 }}>
                  <div style={{ height: "100%", width: `${(f.avgEng / maxFmtEng) * 100}%`, background: f.color, borderRadius: 3 }} />
                </div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: MUTED }}>
                  Total: {f.totalEng} eng · {f.totalImpr.toLocaleString()} impr
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, padding: "10px 14px", background: BLUE_DIM, border: `1px solid rgba(88,166,255,0.15)`, borderRadius: 8, fontSize: 11, color: BLUE, lineHeight: 1.5 }}>
              💡 Photo is Frank's highest-performing format — nearly abandoned in March in favor of video.
            </div>
          </div>

        </div>
      </div>

      {/* FOOTER */}
      <div style={{ borderTop: `1px solid ${BORDER}`, padding: "12px 32px", display: "flex", justifyContent: "space-between", fontFamily: "'DM Mono', monospace", fontSize: 10, color: MUTED, marginTop: 24 }}>
        <span>Elite Partners Group · Marketing Dashboard · Frank LaRosa LinkedIn</span>
        <span>Source: LinkedIn Analytics Export · Jan 11 – Apr 20, 2026</span>
        <span>Q2 Goals: Apr 750 · May 700 · Jun 800 · Weekly: 187</span>
      </div>
    </div>
  );
}
