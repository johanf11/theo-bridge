# Theo Design System

Reference for AI coding agents building new pages and components. All design decisions here are authoritative — do not deviate without a deliberate reason.

---

## Core principles

1. **Flat color only.** No gradients, no blurs, no glassmorphism.
2. **Inline styles for content.** Tailwind classes for layout utilities only (grid, flex, spacing helpers, responsive breakpoints). Never use Tailwind for colors, fonts, or borders on new page content.
3. **No emoji.** Use Lucide icons exclusively.
4. **No crypto jargon** in customer-facing labels. See [language rules](#language-rules).
5. **Plain font everywhere.** Inter as fallback only. Never reach for system-ui or Georgia for UI text.
6. **8px base unit.** Spacing in multiples of 4 or 8: 4, 8, 12, 16, 20, 24, 32, 40, 48.

---

## Color tokens

All colors live in `src/index.css` as CSS custom properties. Always reference via `hsl(var(--token-name))`. Never hardcode hex except in `const` declarations at the top of a file.

### Brand primitives

| Token | HSL | Hex | Use |
|---|---|---|---|
| `--theo-blue` | `239 51% 40%` | `#33359A` | Sidebar bg, headings, primary buttons, data values |
| `--theo-gold` | `49 100% 50%` | `#FDCF00` | Hero stat cards, CTAs, gold rule accent |
| `--theo-cyan` | `192 92% 47%` | `#08B5E5` | Links, eyebrows, active icon strokes, taglines |
| `--theo-cream` | `48 20% 97%` | `#F9F8F5` | Page background |
| `--theo-ink` | `240 27% 14%` | `#1A1A2E` | Body text, primary content |
| `--theo-mid` | `240 13% 48%` | `#6B6B8A` | Secondary/muted text, labels |
| `--theo-light` | `240 19% 93%` | `#EAEAF2` | Hairlines, borders, dividers |

### Soft tints (panels, soft backgrounds)

| Token | Hex | Use |
|---|---|---|
| `--theo-blue-soft` | `#EEF0FB` | Panel backgrounds, soft containers, table row hovers |
| `--theo-blue-chip` | `#D6D8F7` | Chips, secondary badges |
| `--theo-gold-soft` | `#FFF3CD` | Warning banners |
| `--theo-cyan-soft` | `#D0F0FB` | Info tints |

### Semantic

| Token | Use |
|---|---|
| `--success` | Green indicators, completed states (`138 65% 30%`) |
| `--destructive` | Errors, failed states (`0 75% 52%`) |
| `--warning` | Warning states (`38 95% 50%`) |

### Sidebar surface (blue background)

The sidebar is `#33359A` (`hsl(var(--theo-blue))`). On this surface:
- Text: `rgba(255,255,255,0.65)` inactive, `#ffffff` active
- Active item bg: `rgba(255,255,255,0.14)`
- Hover item bg: `rgba(255,255,255,0.07)`
- Active icon stroke: `#FDCF00` (gold)
- Section labels: `hsl(var(--theo-mid))`

---

## Typography

### Font stack

```
'Plain', 'Inter', system-ui, -apple-system, sans-serif
```

`Plain` is a custom OTF family loaded via `@font-face` in `src/index.css`. Available weights: 100 (Hairline) through 900 (Black). Always specify weight numerically, not by keyword.

`Playfair Display` is loaded via Google Fonts but used only for `.tagline` and `.font-display` — the italic serif accent. Never use it for UI text.

### Type scale (inline style values)

| Role | `fontSize` | `fontWeight` | `color` | Notes |
|---|---|---|---|---|
| Page title | `28–32px` | `800` | `hsl(var(--theo-blue))` | `letterSpacing: "-0.02em"` |
| Section heading | `20–24px` | `700` | `hsl(var(--theo-blue))` | `letterSpacing: "-0.02em"` |
| Card heading | `16–18px` | `700` | `hsl(var(--theo-blue))` | |
| Hero stat | `24–32px` | `800` | contextual (blue/white/gold) | `letterSpacing: "-1px"`, `lineHeight: 1` |
| Body | `14px` | `400–500` | `hsl(var(--theo-ink))` | |
| Secondary / label | `12–13px` | `500–600` | `hsl(var(--theo-mid))` | |
| Eyebrow | `10–11px` | `700` | `hsl(var(--theo-cyan))` | `textTransform: "uppercase"`, `letterSpacing: "0.12em"` |
| Table cell | `13px` | `500` | `hsl(var(--theo-ink))` | |
| Badge / chip | `11px` | `700` | contextual | `borderRadius: 99`, `padding: "3px 8px"` |

### CSS component classes (use via `className`)

```
.eyebrow          — 11px, 700, uppercase, cyan, letterSpacing 0.18em
.eyebrow-on-dark  — same but gold (on blue surface)
.eyebrow-muted    — same but theo-mid
.tagline          — Playfair italic, cyan, 700
.gold-rule        — 40px × 3px gold bar (the signature accent line)
.wordmark         — Plain 800, -0.02em, theo-blue
.font-display     — Playfair Display
```

---

## Spacing and layout

### Page structure

```tsx
<AppLayout>           {/* provides sidebar + topbar shell */}
  <div style={{
    padding: "32px 40px",    // desktop page inset
    maxWidth: 1200,
    margin: "0 auto",
  }}>
    {/* page title row */}
    {/* gold rule: width 28px, height 3px, background gold, borderRadius 2, marginTop 8, marginBottom 16 */}
    {/* content grid */}
  </div>
</AppLayout>
```

### Card

```tsx
<div style={{
  background: "#fff",
  border: "1px solid hsl(var(--theo-light))",
  borderRadius: 16,              // --radius = 1rem
  padding: "24px",
  boxShadow: "var(--shadow-sm)", // 0 2px 12px rgba(26,26,46,0.06)
}}>
```

### Stat card (hero — on gold or cyan bg)

```tsx
<div className="rounded-xl p-4 shadow-xs" style={{ background: "hsl(var(--theo-gold))" }}>
  <div className="font-bold uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(51,53,154,0.55)", marginBottom: 8 }}>
    USDC Balance
  </div>
  <div className="font-extrabold leading-none" style={{ fontSize: 24, letterSpacing: "-1px", color: "hsl(var(--theo-blue))" }}>
    $1,234.56
  </div>
  <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))", marginTop: 6, opacity: 0.6 }}>
    Sub-label
  </div>
</div>
```

### Stat card (secondary — on white bg)

```tsx
<div className="rounded-xl p-4 shadow-xs" style={{ background: "hsl(var(--theo-blue-soft))" }}>
  {/* eyebrow label, large number in theo-blue, sub-label in theo-mid */}
</div>
```

### Grid layouts

```tsx
// 5-column stat grid (dashboard)
<div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }} />

// 2-column card split
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }} />

// Table-like detail rows (label / value)
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid hsl(var(--theo-light))" }}>
  <span style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>Label</span>
  <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-ink))" }}>Value</span>
</div>
```

---

## Buttons

### Primary (blue)

```tsx
<button style={{
  background: "hsl(var(--theo-blue))",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
  letterSpacing: "-0.01em",
}}>
  Label
</button>
```

### CTA / action (gold)

```tsx
<button style={{
  background: "hsl(var(--theo-gold))",
  color: "hsl(var(--theo-blue))",
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
}}>
  Label
</button>
```

### Outline / secondary

```tsx
<button style={{
  background: "transparent",
  color: "hsl(var(--theo-blue))",
  border: "1px solid hsl(var(--theo-light))",
  borderRadius: 10,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
}}>
  Label
</button>
```

### Destructive

```tsx
<button style={{
  background: "hsl(var(--destructive))",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
}}>
  Label
</button>
```

> Always pass `fontFamily: "inherit"` on buttons — browser defaults override Plain otherwise.

---

## Status badges

Use `<StatusBadge status={order.status} />` from `src/components/theo/StatusBadge.tsx` for order/payout statuses.

| DB status | Label shown | Color |
|---|---|---|
| `CREATED` | Created | Muted grey |
| `QUOTED` | Awaiting payment | Cyan tint |
| `FUNDED` | Payment received | Warning/amber tint |
| `RELEASING` | Releasing USDC | Blue tint |
| `COMPLETED` | Complete | Green tint |
| `FAILED` | Failed | Red tint |
| `EXPIRED` | Expired | Red tint (lighter) |
| `REFUNDED` | Refunded | Muted grey |

For custom inline badges (not order status):

```tsx
<span style={{
  background: "hsl(var(--theo-blue-soft))",
  color: "hsl(var(--theo-blue))",
  fontSize: 11,
  fontWeight: 700,
  borderRadius: 99,
  padding: "3px 8px",
}}>
  Label
</span>
```

---

## Icons

Use Lucide icons exclusively. Import from `lucide-react`.

### Standard icon props (inline in content)

```tsx
<Icon style={{
  width: 16,
  height: 16,
  stroke: "hsl(var(--theo-blue))",
  fill: "none",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  flexShrink: 0,
}} />
```

### Icon sizes by context

| Context | Size |
|---|---|
| Nav sidebar | 14 × 14 |
| Inline with body text | 14–16 × 14–16 |
| Card / section header | 18–20 × 18–20 |
| Empty state illustration | 32–48 × 32–48 |

### Active state (sidebar nav)

Active nav icon stroke is `#FDCF00` (gold). Inactive is `currentColor` at `opacity: 0.72`.

---

## Form inputs

```tsx
<input
  type="text"
  style={{
    width: "100%",
    border: "1px solid hsl(var(--theo-light))",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 14,
    fontFamily: "inherit",
    color: "hsl(var(--theo-ink))",
    background: "#fff",
    outline: "none",
  }}
  onFocus={(e) => (e.target.style.borderColor = "hsl(var(--theo-cyan))")}
  onBlur={(e)  => (e.target.style.borderColor = "hsl(var(--theo-light))")}
/>
```

### Labels

```tsx
<label style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--theo-mid))", marginBottom: 6, display: "block" }}>
  Field label
</label>
```

### Select / dropdown

Same border and padding as input. Use native `<select>` styled to match or shadcn `<Select>` from `src/components/ui/select.tsx`.

---

## Tables

```tsx
<table style={{ width: "100%", borderCollapse: "collapse" }}>
  <thead>
    <tr style={{ borderBottom: "1px solid hsl(var(--theo-light))" }}>
      <th style={{
        textAlign: "left",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "hsl(var(--theo-mid))",
        padding: "8px 12px",
      }}>
        Column
      </th>
    </tr>
  </thead>
  <tbody>
    <tr style={{ borderBottom: "1px solid hsl(var(--theo-light))" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(var(--theo-blue-soft))")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <td style={{ padding: "12px 12px", fontSize: 13, color: "hsl(var(--theo-ink))" }}>
        Value
      </td>
    </tr>
  </tbody>
</table>
```

---

## Charts

Use `recharts`. **Never use PieChart or DonutChart.** Volume breakdowns always use stacked bar charts.

```tsx
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// Colors for series
const CHART_COLORS = {
  conversions: "hsl(var(--theo-blue))",
  payouts:     "hsl(var(--theo-cyan))",
  yield:       "hsl(150 70% 25%)",       // green
};

// Custom tooltip
function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#fff",
      border: "1px solid hsl(var(--theo-light))",
      borderRadius: 8,
      padding: "8px 12px",
      fontSize: 12,
      boxShadow: "0 4px 12px rgba(51,53,154,0.10)",
    }}>
      <div style={{ fontWeight: 700, color: "hsl(var(--theo-blue))", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
          <span style={{ color: "hsl(var(--theo-mid))" }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}
```

Grid lines: `stroke="hsl(var(--theo-light))"`, `strokeDasharray="3 3"`.
Axes: `fontSize={11}`, `fill="hsl(var(--theo-mid))"`.
Bar `radius`: `[4, 4, 0, 0]` on the topmost bar in a stack, `[0, 0, 0, 0]` on lower bars.

---

## Modals and dialogs

Use shadcn `<Dialog>` from `src/components/ui/dialog.tsx`. Inner content follows card styling:

```tsx
<DialogContent style={{ borderRadius: 16, maxWidth: 480 }}>
  <DialogHeader>
    <DialogTitle style={{ fontSize: 18, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
      Title
    </DialogTitle>
  </DialogHeader>
  {/* content */}
  <DialogFooter style={{ gap: 8, marginTop: 8 }}>
    <DialogClose asChild>
      <button style={/* outline style */}>Cancel</button>
    </DialogClose>
    <button style={/* primary style */}>Confirm</button>
  </DialogFooter>
</DialogContent>
```

---

## Empty states

```tsx
<div style={{
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "64px 24px",
  color: "hsl(var(--theo-mid))",
  gap: 12,
}}>
  <IconName style={{ width: 40, height: 40, stroke: "hsl(var(--theo-light))", fill: "none", strokeWidth: 1.2 }} />
  <div style={{ fontSize: 15, fontWeight: 600, color: "hsl(var(--theo-mid))" }}>Nothing here yet</div>
  <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", opacity: 0.7, textAlign: "center", maxWidth: 280 }}>
    Descriptive sub-text.
  </div>
</div>
```

---

## Toast notifications

Use `toast` from `sonner` (already imported globally via `<Toaster />` in `App.tsx`):

```ts
import { toast } from "sonner";

toast.success("Action completed");
toast.error("Something went wrong");
toast.info("FYI message");
```

No custom toast styling needed — the global Toaster is already themed.

---

## Loading states

```tsx
// Spinner inline
<Loader2
  style={{ width: 16, height: 16, animation: "spin 1s linear infinite", stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2 }}
/>

// Full page / card skeleton
<div style={{ padding: "32px 40px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
  <Loader2 style={{ width: 24, height: 24, animation: "spin 1s linear infinite", stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2 }} />
</div>
```

---

## Shadows

| Variable | Value | Use |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(26,26,46,0.04)` | Stat cards, tight surfaces |
| `--shadow-sm` | `0 2px 12px rgba(26,26,46,0.06)` | Cards, panels |
| `--shadow-md` | `0 2px 16px rgba(26,26,46,0.08)` | Elevated overlays |
| `--shadow-lg` | `0 8px 32px rgba(26,26,46,0.10)` | Modals, dropdowns |

Reference in inline styles: `boxShadow: "var(--shadow-sm)"`.

---

## Border radius

| Context | `borderRadius` |
|---|---|
| Main cards | `16` (matches `--radius: 1rem`) |
| Inputs, buttons | `10` |
| Small badges / chips | `99` (pill) |
| Stat chip / mini card | `8` |
| Tooltip / dropdown | `8` |
| Table rows | `0` (no radius on rows) |

---

## Motion

Transitions are minimal and fast. Standard values:

```ts
transition: "all 130ms"           // nav item hover
transition: "background 80ms"    // table row hover
transition: "opacity 150ms"      // show/hide
```

Page-level entry animation (optional, use sparingly):

```tsx
className="animate-in-fade"
// keyframes: opacity 0→1, translateY 4px→0, 220ms ease-out
```

---

## Page anatomy (standard layout)

```
┌─────────────────────────────────────────┐
│  Page title (28px, 800, blue, -0.02em)  │
│  ▬▬▬  (gold-rule: 28×3px, mt-2 mb-4)   │
│                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │  ← stat row (grid)
│  │ gold │ │ cyan │ │ soft │ │ soft │   │
│  └──────┘ └──────┘ └──────┘ └──────┘   │
│                                         │
│  ┌──────────────────────────────────┐   │  ← main card
│  │ Section heading (18px, 700, blu) │   │
│  │ ─────────────────────────────── │   │
│  │ content                         │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## Number formatting rules

| Data type | Format | Example |
|---|---|---|
| USDC | `.toLocaleString("en-US", { minimumFractionDigits: 2 })` | `1,234.56` |
| HTG | `Math.round(n).toLocaleString("en-US")` | `2,662,846` (no cents ever) |
| Fee bps | `(bps / 100).toFixed(2) + "%"` | `1.30%` |
| Exchange rate | `rate.toFixed(2)` | `145.25` |
| Large USDC (abbreviated) | `$${(n / 1000).toFixed(1)}K` | `$1.2K` |

HTG has no cents. Never display fractional HTG anywhere in the UI, inputs, or receipts.

---

## Language rules (customer-facing)

| Say | Never say |
|---|---|
| "Exchange Rate" or "Rate" | "spot rate", "forward premium" |
| "On / Off Ramp" or "Convert" | "swap" |
| "HTG Balance" | "HTG-C balance" |
| "Processing" | "RELEASING" (DB enum) |
| "Complete" | "COMPLETED" (DB enum) |
| USDC (fine to use) | "stablecoin", "token" |
| — | "blockchain", "on-chain", "ledger", "mint", "burn" |

Admin / internal pages may use technical terms freely.

---

## Component file structure

New page skeleton:

```tsx
import { AppLayout } from "@/components/theo/Layout";

export default function MyPage() {
  return (
    <AppLayout>
      <div style={{ padding: "32px 40px", maxWidth: 1200, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em", margin: 0 }}>
            Page Title
          </h1>
          {/* optional action button */}
        </div>
        <div style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginBottom: 24 }} />

        {/* Content */}

      </div>
    </AppLayout>
  );
}
```

---

## shadcn/ui primitives

Pre-built components live in `src/components/ui/`. Use these rather than re-implementing:

| Component | Import |
|---|---|
| `Button` | `@/components/ui/button` |
| `Dialog / DialogContent` | `@/components/ui/dialog` |
| `Select` | `@/components/ui/select` |
| `Badge` | `@/components/ui/badge` |
| `Accordion` | `@/components/ui/accordion` |
| `Tabs` | `@/components/ui/tabs` |
| `Tooltip` | `@/components/ui/tooltip` |
| `Popover` | `@/components/ui/popover` |
| `Input` | `@/components/ui/input` — but prefer inline-styled native inputs for new pages |

Style overrides go via inline `style` prop, not Tailwind classes on shadcn internals.

---

## Anti-patterns (do not do these)

- ❌ `background: "linear-gradient(...)"` — flat color only
- ❌ Hardcoded hex like `color: "#33359A"` inside JSX — use `hsl(var(--theo-blue))`
- ❌ `fontSize: "1rem"` — use px values explicitly
- ❌ Tailwind color classes like `text-blue-600` — use CSS variables
- ❌ `<PieChart>` or `<DonutChart>` — use stacked `<BarChart>`
- ❌ Unicode subscript/superscript characters in PDF output — use ReportLab `<sub>` / `<super>` tags
- ❌ Emoji in UI
- ❌ Non-Lucide icon libraries
- ❌ `fontFamily` omitted from `<button>` — browser default overrides Plain
- ❌ Fractional HTG display (`2,662,846.94`) — always `Math.round()`
