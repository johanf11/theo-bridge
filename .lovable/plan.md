# Redesign Landing page

## Problem

The Landing page references stale design tokens (`bg-gradient-hero`, `bg-gradient-card`, `text-theo-blue-deep`, `shadow-elegant`, `shadow-card`) that no longer exist after the brand cleanup. Result: white text rendering on cream background (unreadable hero), washed-out feature cards, and a fallback yellow CTA with no contrast.

## Direction

Apply the Theo brand rules already in memory: flat color, blue + gold + cyan accents, cream page bg, white card surfaces, eyebrow + tagline patterns. Make the hero readable by inverting the surface (flat `bg-primary` blue with white text) instead of relying on a missing gradient.

## Layout

```
┌─────────────────────────────────────────────────┐
│  [T Theo]                  Sign in   Get started│  cream header
├─────────────────────────────────────────────────┤
│                                                 │
│  ● BUILT FOR HAITIAN BUSINESSES   ┌───────────┐ │
│                                   │ LIVE QUOTE│ │
│  HTG to USDC.                     │           │ │
│  Effortless. Compliant.           │ $10,000   │ │  flat blue
│  ───  (gold rule)                 │ 1,350,000 │ │  surface
│                                   │           │ │
│  Convert Haitian Gourdes …        │ Rate ...  │ │
│                                   └───────────┘ │
│  [Open a business account] Sign in              │
│                                                 │
├─────────────────────────────────────────────────┤
│  FEATURES (eyebrow)                             │
│  Built for the way you move money               │  cream
│                                                 │
│  ┌────────┐  ┌────────┐  ┌────────┐             │  white cards
│  │ icon   │  │ icon   │  │ icon   │             │  16px radius
│  │ title  │  │ title  │  │ title  │             │
│  │ body   │  │ body   │  │ body   │             │
│  └────────┘  └────────┘  └────────┘             │
└─────────────────────────────────────────────────┘
```

## Changes

**Hero section**
- Replace `bg-gradient-hero` with flat `bg-primary` (Theo blue). White text now has full contrast.
- Eyebrow chip: replace translucent pill with the standard `eyebrow eyebrow-on-dark` pattern (gold, 11px, tracked) above the headline.
- Headline: keep "Effortless." in gold (`text-secondary`), rest in white. Add 40×3 gold rule beneath per brand pattern.
- Body copy: white at 85% opacity for hierarchy.
- Primary CTA: `bg-secondary text-secondary-foreground` (gold pill, blue text — matches memory rule "text on gold = blue").
- Secondary CTA: ghost outline with white border at low opacity.
- Quote card: white surface, blue numerals, cyan eyebrow "LIVE QUOTE", remove the cyan blur halo (no gradients/glows).

**Features section**
- Move from gradient cards to flat white cards with `border` and `shadow-sm-soft`.
- Add a proper section header: cyan eyebrow "WHY THEO" + Playfair italic tagline "Money that moves at business speed" + gold rule.
- Icon tiles: `bg-theo-blue-soft text-primary`, rounded 22% (icon-tile pattern).
- Titles in primary blue, body in `text-muted-foreground`.

**Header & footer**
- Header stays cream/transparent over the page bg; "Get started" CTA becomes the gold pill for consistency.
- Footer: small muted text on cream, hairline `border-t border-border`.

## Technical notes

- Single file edit: `src/pages/Landing.tsx`.
- Only semantic tokens (`bg-primary`, `text-secondary`, `bg-card`, `text-muted-foreground`) and brand utility classes already defined in `index.css` (`eyebrow`, `eyebrow-on-dark`, `tagline`, `gold-rule`, `shadow-sm-soft`).
- Remove all references to deleted tokens: `bg-gradient-hero`, `bg-gradient-card`, `text-theo-blue-deep`, `shadow-elegant`, `shadow-card`, `bg-white/95`, `bg-white/10`, etc.
- No new dependencies, no DB or backend changes.
- Keep existing `animate-fade-in` entrance.

## Out of scope

- Adding new sections (testimonials, pricing, FAQ).
- Imagery — brand rule forbids stock photos; keep illustration-free.
- Mobile-only redesign — current responsive grid stays.
