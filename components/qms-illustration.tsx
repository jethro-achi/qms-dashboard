// components/qms-illustration.tsx
// Self-contained SVG depicting a queue-management / analytics scene (a service
// counter, a queue of people, and a live metrics panel). Uses theme tokens so
// it follows the configured primary colour and dark mode. No external image =
// CSP-safe and offline-friendly.
export function QmsIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 300" className={className} role="img" aria-label="Queue management analytics" preserveAspectRatio="xMidYMid meet">
      {/* analytics panel */}
      <rect x="40" y="34" width="200" height="120" rx="10" fill="var(--card)" opacity="0.9" />
      <rect x="40" y="34" width="200" height="120" rx="10" fill="none" stroke="var(--border)" />
      {/* bars */}
      <rect x="60" y="110" width="18" height="28" rx="3" fill="var(--primary)" opacity="0.55" />
      <rect x="86" y="88" width="18" height="50" rx="3" fill="var(--primary)" opacity="0.7" />
      <rect x="112" y="70" width="18" height="68" rx="3" fill="var(--primary)" />
      <rect x="138" y="98" width="18" height="40" rx="3" fill="var(--primary)" opacity="0.7" />
      {/* trend line */}
      <polyline points="60,70 90,58 120,64 150,48 175,52 215,40" fill="none" stroke="var(--chart-2)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="215" cy="40" r="4" fill="var(--chart-2)" />
      {/* KPI chips */}
      <rect x="170" y="64" width="52" height="16" rx="8" fill="var(--primary)" opacity="0.12" />
      <rect x="170" y="86" width="40" height="12" rx="6" fill="var(--muted)" />

      {/* service counter */}
      <rect x="250" y="150" width="110" height="70" rx="8" fill="var(--primary)" opacity="0.14" />
      <rect x="250" y="150" width="110" height="16" rx="6" fill="var(--primary)" />
      <rect x="286" y="120" width="40" height="34" rx="6" fill="var(--card)" stroke="var(--border)" />
      <text x="306" y="142" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--primary)">A12</text>
      {/* agent */}
      <circle cx="306" cy="186" r="12" fill="var(--primary)" opacity="0.8" />
      <rect x="292" y="200" width="28" height="20" rx="8" fill="var(--primary)" opacity="0.5" />

      {/* queue of people */}
      {[70, 110, 150, 190].map((x, i) => (
        <g key={x} opacity={1 - i * 0.16}>
          <circle cx={x} cy="212" r="12" fill="var(--muted-foreground)" />
          <rect x={x - 14} y="226" width="28" height="26" rx="9" fill="var(--muted-foreground)" opacity="0.6" />
        </g>
      ))}
      {/* floor line */}
      <line x1="40" y1="262" x2="360" y2="262" stroke="var(--border)" strokeWidth="2" />
    </svg>
  )
}
