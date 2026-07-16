// components/powered-by.tsx
// "Powered by OcTech" footer branding, shown at the bottom of the pages.
//
// The mark is a self-contained inline SVG (no external image = CSP-safe and
// offline-friendly, matching qms-illustration.tsx). It is theme-aware WITHOUT
// needing two files: the blue "OcTech" wordmark and the green squares are fixed
// brand colours in BOTH modes, and the "COUNTLESS POSSIBILITIES" tagline is
// painted with `currentColor`, so it renders dark-grey in light mode and white
// in dark mode — exactly how the client's light/dark logo variants differ.
import { cn } from "@/lib/utils"

// OcTech brand colours (constant across light/dark).
const OCTECH_BLUE = "#1E5AA0"
const OCTECH_GREEN_LIGHT = "#9BCB6C"
const OCTECH_GREEN_DARK = "#64B140"

/**
 * The OcTech logo as inline SVG. The wordmark + squares are fixed brand colours;
 * the tagline inherits `currentColor` so callers control its light/dark shade.
 * `textLength` locks the wordmark/tagline widths so layout is font-independent.
 */
export function OcTechLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 156 50"
      className={className}
      role="img"
      aria-label="OcTech — Countless Possibilities"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Wordmark */}
      <text
        x="2"
        y="31"
        textLength="112"
        lengthAdjust="spacingAndGlyphs"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
        fontWeight="800"
        fontSize="31"
        letterSpacing="-1"
        fill={OCTECH_BLUE}
      >
        OcTech
      </text>

      {/* Two squares, top-right (light green in front, darker green behind/right) */}
      <rect x="121" y="12" width="13" height="13" rx="1.5" fill={OCTECH_GREEN_LIGHT} />
      <rect x="135" y="2" width="13" height="21" rx="1.5" fill={OCTECH_GREEN_DARK} />

      {/* Tagline — inherits currentColor so it flips with the theme */}
      <text
        x="3"
        y="46"
        textLength="150"
        lengthAdjust="spacingAndGlyphs"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
        fontWeight="600"
        fontSize="7.5"
        fill="currentColor"
      >
        COUNTLESS POSSIBILITIES
      </text>
    </svg>
  )
}

/**
 * "Powered by OcTech" strip for the bottom of pages. Muted "Powered by" label
 * with the theme-aware mark. The wrapping span sets the tagline colour
 * (dark-grey in light mode, near-white in dark mode) via `currentColor`.
 *
 * The branding is intentionally NOT a link and NOT selectable/copyable:
 *  - `select-none`      — the "Powered by" text and the SVG glyphs can't be
 *                         highlighted or copied.
 *  - `pointer-events-none` on the mark — no click, no right-click "save image",
 *                         no drag.
 */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "mt-2 flex select-none items-center justify-center gap-2 py-4 text-muted-foreground",
        className,
      )}
    >
      <span className="text-[11px] tracking-wide">Powered by</span>
      <span
        aria-label="OcTech — Countless Possibilities"
        className="pointer-events-none text-neutral-700 dark:text-neutral-100"
      >
        <OcTechLogo className="h-6 w-auto" />
      </span>
    </footer>
  )
}
