import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

// ── REAL DATA FROM LINKEDIN ANALYTICS Q1 2026 ──────────────────────────
const weeklyData = [
  { week: "Jan 05", engagements: 49,  impressions: 3648  },
  { week: "Jan 12", engagements: 359, impressions: 21385 },
  { week: "Jan 19", engagements: 104, impressions: 9534  },
  { week: "Jan 26", engagements: 154, impressions: 15452 },
  { week: "Feb 02", engagements: 96,  impressions: 9714  },
  { week: "Feb 09", engagements: 229, impressions: 20769 },
  { week: "Feb 16", engagements: 85,  impressions: 12127 },
  { week: "Feb 23", engagements: 138, impressions: 9501  },
  { week: "Mar 02", engagements: 198, impressions: 12040 },
  { week: "Mar 09", engagements: 130, impressions: 12579 },
  { week: "Mar 16", engagements: 190, impressions: 9776  },
  { week: "Mar 23", engagements: 44,  impressions: 8379  },
  { week: "Mar 30", engagements: 20,  impressions: 3546  },
];

const monthlyData = [
  { month: "Jan", engagements: 662, impressions: 49446, followers: 187, goal: 750 },
  { month: "Feb", engagements: 543, impressions: 52925, followers: 138, goal: 750 },
  { month: "Mar", engagements: 591, impressions: 46576, followers: 163, goal: 750 },
];

const topPosts = [
  { date: "Jan 12", engagements: 253, impressions: 12682 },
  { date: "Feb 09", engagements: 98,  impressions: 9727  },
  { date: "Mar 20", engagements: 94,  impressions: 4105  },
  { date: "Jan 15", engagements: 69,  impressions: 3949  },
  { date: "Feb 14", engagements: 65,  impressions: 5021  },
];

const demographics = [
  { label: "Financial Advisor", pct: 6.9 },
  { label: "Founder",           pct: 5.5 },
  { label: "CEO",               pct: 3.6 },
  { label: "Managing Director", pct: 3.0 },
  { label: "President",         pct: 2.9 },
];

const GOLD       = "#c9a84c";
const GOLD_DIM   = "rgba(201,168,76,0.15)";
const GREEN      = "#3fb950";
const GREEN_DIM  = "rgba(63,185,80,0.12)";
const RED        = "#f85149";
const RED_DIM    = "rgba(248,81,73,0.12)";
const BLUE       = "#58a6ff";
const MUTED      = "#8892a4";
const BORDER     = "rgba(255,255,255,0.07)";
const SURFACE    = "#111827";
const SURFACE2   = "#1a2235";

// ── KPI CARD ────────────────────────────────────────────────────────────
function KpiCard({ source, label, value, delta, deltaLabel, accent, large }) {
  const isUp = delta > 0;
  const accentColor = accent || GOLD;
  return (
    <div style={{
      background: SURFACE,
      border: `1px solid ${BORDER}`,
      borderRadius: 12,
      padding: "20px 24px",
      display: "flex",
      flexDirection: "column",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        height: 3, background: accentColor, borderRadius: "12px 12px 0 0",
      }} />
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: 2, color: MUTED, textTransform: "uppercase", marginBottom: 8 }}>
        {source}
      </div>
      <div style={{ fontSize: 13, color: "#a0aab4", marginBottom: 6 }}>{label}</div>
      <div style={{
        fontFamily: "'Playfair Display', serif",
        fontSize: large ? 52 : 40,
        fontWeight: 700,
        color: "#f0f6fc",
        lineHeight: 1,
        marginBottom: 10,
      }}>
        {value}
      </div>
      {delta !== undefined && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          background: isUp ? GREEN_DIM : RED_DIM,
          color: isUp ? GREEN : RED,
          fontSize: 12, fontWeight: 600,
          padding: "4px 10px", borderRadius: 20,
          width: "fit-content",
        }}>
          {isUp ? "↑" : "↓"} {Math.abs(delta)}%
        </div>
      )}
      {deltaLabel && (
        <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>{deltaLabel}</div>
      )}
    </div>
  );
}

// ── CUSTOM TOOLTIP ───────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1a2235", border: `1px solid ${BORDER}`,
      borderRadius: 8, padding: "10px 14px",
    }}>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 13, color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{p.value.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

// ── CLOCK ────────────────────────────────────────────────────────────────
function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const h = time.getHours() % 12 || 12;
  const m = String(time.getMinutes()).padStart(2, "0");
  const ampm = time.getHours() >= 12 ? "PM" : "AM";
  return (
    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: "#f0f6fc", letterSpacing: 1 }}>
      {h}:{m} {ampm}
    </span>
  );
}

// ── MAIN APP ─────────────────────────────────────────────────────────────
export default function App() {
  // Q2 goal tracking
  const q2Goal = 2250;
  const aprilGoal = 750;
  const weeklyGoal = 187;
  const q1Total = 662 + 543 + 591; // 1796

  // Month over month
  const engMoM = Math.round(((591 - 543) / 543) * 100);  // +9%
  const imprMoM = Math.round(((46576 - 52925) / 52925) * 100); // -12%
  const follMoM = Math.round(((163 - 138) / 138) * 100); // +18%

  return (
    <div style={{
      background: "#0a0f1e",
      minHeight: "100vh",
      fontFamily: "'DM Sans', sans-serif",
      color: "#f0f6fc",
    }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0a0f1e; }
        ::-webkit-scrollbar-thumb { background: #2a3445; border-radius: 3px; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.85)} }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{
        background: SURFACE,
        borderBottom: `1px solid ${BORDER}`,
        display: "flex", alignItems: "center",
        justifyContent: "space-between",
        padding: "0 32px", height: 60,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 36, height: 36, background: GOLD, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, color: "#0a0f1e",
          }}>E</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
              Elite Partners Group — Marketing Performance
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: MUTED, letterSpacing: 1, textTransform: "uppercase" }}>
              Frank LaRosa · LinkedIn · Q1 2026
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{
            fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: 2,
            textTransform: "uppercase", background: GOLD_DIM, color: GOLD,
            padding: "5px 12px", borderRadius: 6, border: `1px solid rgba(201,168,76,0.2)`,
          }}>
            Jan – Apr 2026
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MUTED }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, animation: "pulse 2s infinite" }} />
            Live Dashboard
          </div>
          <Clock />
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>

        {/* ── Q2 GOAL BANNER ── */}
        <div style={{
          background: "linear-gradient(135deg, #1a1600 0%, #0f1208 100%)",
          border: `1px solid rgba(201,168,76,0.25)`,
          borderRadius: 12, padding: "16px 24px",
          display: "flex", alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 13, color: GOLD, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
              Q2 Goal — Frank LinkedIn Engagements
            </div>
            <div style={{ fontSize: 13, color: MUTED }}>
              Target: <span style={{ color: "#f0f6fc", fontWeight: 600 }}>2,250</span> total · Monthly: <span style={{ color: "#f0f6fc", fontWeight: 600 }}>750</span> · Weekly: <span style={{ color: "#f0f6fc", fontWeight: 600 }}>187</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            {[
              { label: "April Goal", val: "750" },
              { label: "May Goal",   val: "750" },
              { label: "June Goal",  val: "750" },
            ].map((g) => (
              <div key={g.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>{g.label}</div>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: GOLD }}>{g.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── ROW 1: KPI CARDS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
          <KpiCard
            source="LinkedIn · Frank LaRosa"
            label="Total Engagements (Mar)"
            value="591"
            delta={engMoM}
            deltaLabel="vs Feb (543)"
            accent={GOLD}
            large
          />
          <KpiCard
            source="LinkedIn · Frank LaRosa"
            label="Total Impressions (Mar)"
            value="46.6K"
            delta={imprMoM}
            deltaLabel="vs Feb (52.9K)"
            accent={BLUE}
          />
          <KpiCard
            source="LinkedIn · Frank LaRosa"
            label="New Followers (Mar)"
            value="163"
            delta={follMoM}
            deltaLabel="vs Feb (138)"
            accent={GREEN}
          />
          <KpiCard
            source="LinkedIn · Frank LaRosa"
            label="Total Followers"
            value="12,745"
            accent="#a855f7"
          />
        </div>

        {/* ── ROW 2: CHARTS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 20 }}>

          {/* Weekly Engagements Chart */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ position: "relative", overflow: "hidden", marginBottom: 4 }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: GOLD, borderRadius: "12px 12px 0 0" }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Weekly Engagements — Frank LaRosa LinkedIn</div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>Q1 2026 · Weekly goal reference line at 187</div>
            <ResponsiveContainer width="100%" height={220}>
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
                <ReferenceLine yAxisId="left" y={187} stroke={GREEN} strokeDasharray="4 4" label={{ value: "Weekly Goal", fill: GREEN, fontSize: 10, position: "right" }} />
                <Area yAxisId="left" type="monotone" dataKey="engagements" name="Engagements" stroke={GOLD} strokeWidth={2.5} fill="url(#engGrad)" dot={false} activeDot={{ r: 5, fill: GOLD }} />
                <Area yAxisId="right" type="monotone" dataKey="impressions" name="Impressions" stroke={BLUE} strokeWidth={1.5} fill="url(#imprGrad)" strokeDasharray="5 4" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly Comparison */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Monthly Engagements vs Goal</div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>Q1 actuals · Q2 monthly target: 750</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis dataKey="month" tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={750} stroke={GOLD} strokeDasharray="4 4" label={{ value: "Q2 Target", fill: GOLD, fontSize: 10 }} />
                <Bar dataKey="engagements" name="Engagements" fill={GOLD} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── ROW 3: BOTTOM CARDS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>

          {/* Q1 Summary */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Q1 2026 Summary</div>
            {[
              { label: "Total Engagements", val: "1,801", color: GOLD },
              { label: "Total Impressions",  val: "149,474", color: BLUE },
              { label: "New Followers",       val: "489", color: GREEN },
              { label: "Total Followers",     val: "12,745", color: "#a855f7" },
              { label: "Avg Eng / Month",     val: "600", color: MUTED },
            ].map((item) => (
              <div key={item.label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderBottom: `1px solid ${BORDER}`,
              }}>
                <span style={{ fontSize: 13, color: MUTED }}>{item.label}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 600, color: item.color }}>
                  {item.val}
                </span>
              </div>
            ))}
          </div>

          {/* Top Posts */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Top Posts by Engagements</div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>Q1 2026 · Top 5</div>
            {topPosts.map((p, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "8px 10px", borderRadius: 8,
                background: i === 0 ? GOLD_DIM : "transparent",
                marginBottom: 6,
              }}>
                <div style={{
                  fontFamily: "'DM Mono', monospace", fontSize: 11,
                  color: i === 0 ? GOLD : MUTED, width: 16,
                }}>#{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#f0f6fc" }}>{p.date}</div>
                  <div style={{ fontSize: 11, color: MUTED }}>{p.impressions.toLocaleString()} impressions</div>
                </div>
                <div style={{
                  fontFamily: "'DM Mono', monospace", fontSize: 13,
                  fontWeight: 600, color: i === 0 ? GOLD : GREEN,
                }}>
                  {p.engagements} eng
                </div>
              </div>
            ))}
          </div>

          {/* Audience Demographics */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Audience — Top Job Titles</div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>
              50% Financial Services · 12,745 followers
            </div>
            {demographics.map((d, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: MUTED }}>{d.label}</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#f0f6fc" }}>{d.pct}%</span>
                </div>
                <div style={{ height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    width: `${(d.pct / 7) * 100}%`,
                    background: GOLD,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── FOOTER ── */}
      <div style={{
        borderTop: `1px solid ${BORDER}`,
        padding: "12px 32px",
        display: "flex", justifyContent: "space-between",
        fontFamily: "'DM Mono', monospace", fontSize: 10, color: MUTED,
        marginTop: 24,
      }}>
        <span>Elite Partners Group · Marketing Dashboard · Frank LaRosa LinkedIn</span>
        <span>Source: LinkedIn Analytics Export · Q1 2026 · Jan 2 – Apr 1</span>
        <span>Q2 Engagement Goal: 2,250 · Monthly: 750 · Weekly: 187</span>
      </div>
    </div>
  );
}
