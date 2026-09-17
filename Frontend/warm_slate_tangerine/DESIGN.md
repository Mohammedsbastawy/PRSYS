---
name: Warm Slate & Tangerine
colors:
  surface: '#f8f9ff'
  surface-dim: '#d5dae6'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e9eefb'
  surface-container-high: '#e3e8f5'
  surface-container-highest: '#dde3ef'
  on-surface: '#161c25'
  on-surface-variant: '#5a4138'
  inverse-surface: '#2b313a'
  inverse-on-surface: '#ebf1fd'
  outline: '#8e7166'
  outline-variant: '#e2bfb2'
  surface-tint: '#a73a00'
  primary: '#a33900'
  on-primary: '#ffffff'
  primary-container: '#cc4900'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb599'
  secondary: '#904d00'
  on-secondary: '#ffffff'
  secondary-container: '#fe932c'
  on-secondary-container: '#663500'
  tertiary: '#3f661e'
  on-tertiary: '#ffffff'
  tertiary-container: '#578034'
  on-tertiary-container: '#f9ffec'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbce'
  primary-fixed-dim: '#ffb599'
  on-primary-fixed: '#370e00'
  on-primary-fixed-variant: '#7f2b00'
  secondary-fixed: '#ffdcc3'
  secondary-fixed-dim: '#ffb77d'
  on-secondary-fixed: '#2f1500'
  on-secondary-fixed-variant: '#6e3900'
  tertiary-fixed: '#c2f198'
  tertiary-fixed-dim: '#a6d47e'
  on-tertiary-fixed: '#0c2000'
  on-tertiary-fixed-variant: '#2b5008'
  background: '#f8f9ff'
  on-background: '#161c25'
  surface-variant: '#dde3ef'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  gutter-mobile: 0.75rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system targets high-velocity enterprise platforms, analytics dashboards, and professional workflows requiring prolonged focus without cognitive fatigue. Moving away from stark, sterile enterprise grays and high-glare white backdrops, the aesthetic balances functional utility with human warmth. 

The design combines **Modern Corporate** structure with **Warm Tactile Minimalism**:
- **Personality:** Authoritative, hospitable, energetic, methodical.
- **Target Audience:** Enterprise knowledge workers, operations managers, and data analysts who spend 8+ hours a day inside dense tooling.
- **Emotional Response:** Immediate visual comfort, clarity under data-density, and a sense of forward momentum driven by targeted tangerine accents.

## Colors

The palette grounds high-density productivity environments with comfortable stone neutrals and an energizing, purposeful tangerine accent system.

### Color Roles & Implementation
- **Canvas Base:** Muted slate/stone `#edf0f2` provides a low-strain foundation that softens screen luminescence.
- **Surface & Cards:** Crisp off-white `#f8f9fa` and clean `#ffffff` layered directly above the base canvas, framed with warm slate hairline strokes (`#d8dce2`).
- **Primary (`#ea580c`, `#f97316`):** Vibrant tangerine reserved strictly for high-impact actions, primary workflows, active navigation indicators, and key operational states.
- **Secondary (`#d97706`):** Warm amber for contextual warnings, intermediate metrics, and secondary analytical points.
- **Tertiary (`#4f772d` / `#588157`):** Earthy sage green for operational health, confirmed states, and positive variance without jarring neon intensity.
- **Text & Neutral (`#1e242d`):** Deep charcoal slate yielding optimal contrast ratios against stone surfaces without the harshness of pure `#000000`. Secondary body and captions map to slate neutral `#475569`.

## Typography

The typography leverages **Hanken Grotesk** across displays, headlines, and primary prose for its precise geometry, open counters, and high legibility at micro-scale. 

To reinforce enterprise rigor and data authenticity, **JetBrains Mono** is introduced for all structural labels, status tags, numerical readouts, table headers, and timestamp tokens.

### Rules of Usage
- **Numerics & Tabular Figures:** Enable `tnum` (tabular lining numbers) on all numerical tables and dashboards to ensure column alignment.
- **Letter Spacing:** Headlines utilize subtle negative tracking (`-0.01em` to `-0.02em`) to maintain tightness, while monospace metadata uses positive tracking for clarity at glanceable sizes.

## Layout & Spacing

The layout is built upon a standard 12-column fluid responsive grid anchored by an 8pt structural rhythm.

### Grid & Breakpoints
- **Desktop (>= 1280px):** 12 columns, `margin: 2rem` (32px), `gutter: 1.25rem` (20px). Supports persistent left-hand command rails (240px) and multi-panel analytic canvases.
- **Tablet (768px - 1279px):** 8 columns, `margin: 1.5rem` (24px), `gutter: 1rem` (16px). Command rail collapses to icon navigation or contextual sheet.
- **Mobile (< 768px):** 4 columns, `margin-mobile: 1rem` (16px), `gutter-mobile: 0.75rem` (12px). Multi-column dashboard widgets reflow into single-column vertical stacks.

### Density Tiers
Dense operational views (e.g., transaction ledgers, inventory logs) step component padding down using `space-xs` and `space-sm`, while analytical overviews and onboarding modules utilize `space-md` through `space-xl` to frame discrete content groupings.

## Elevation & Depth

Visual hierarchy relies on warm tonal layering, precise ghost outlines, and subtle ambient shadows tinted with charcoal slate rather than achromatic black.

### Surface Tiers
- **Tier 0 (Canvas Base):** Ground background (`#edf0f2`).
- **Tier 1 (Resting Cards & Worksurfaces):** Solid `#ffffff` or `#f8f9fa` surfaced with a crisp 1px perimeter border in `#d8dce2`. Elevation is flat or supported by a soft resting shadow: `0 1px 3px rgba(30, 36, 45, 0.05), 0 1px 2px rgba(30, 36, 45, 0.03)`.
- **Tier 2 (Floating Panels, Toolbars, Popovers):** Raised `#ffffff` surface, 1px border `#d8dce2`, casting a diffused slate shadow: `0 8px 20px -4px rgba(30, 36, 45, 0.08), 0 4px 6px -2px rgba(30, 36, 45, 0.04)`.
- **Tier 3 (Modals & Command Palettes):** `#ffffff` elevated over a tinted stone backdrop overlay (`rgba(30, 36, 45, 0.45)` with `4px` blur), cast shadow: `0 20px 32px -8px rgba(30, 36, 45, 0.16)`.

Borders are mandatory across light surfaces to maintain visual boundaries against the warm stone background.

## Shapes

The interface balances precision and warmth through consistent, controlled rounding:

- **Base Radius (0.5rem / 8px):** Applied to inputs, buttons, chips, nested control groups, and table action rows.
- **Large Radius (`rounded-lg`, 1rem / 16px):** Applied to primary cards, modal dialogues, analytical panels, and drawer shells.
- **Extra Large Radius (`rounded-xl`, 1.5rem / 24px):** Reserved for empty-state containers, promotional system banners, and detached floating navigation bars.
- **Pills (`full-rounded`):** Exclusively utilized for status chips, badges, and toggle switches.

## Components

### Buttons
- **Primary:** Solid `#ea580c` fill, crisp `#ffffff` text, 0.5rem corner radius. Hover shifts to vibrant tangerine `#f97316` with a subtle warm glow (`box-shadow: 0 2px 8px rgba(234, 88, 12, 0.25)`). Active state scales to `0.98`.
- **Secondary:** Surface `#ffffff`, border 1px solid `#d8dce2`, text `#1e242d`. Hover transitions background to `#f1f3f5` and border to `#c4cbd4`.
- **Ghost:** Transparent background, text `#475569`. Hover reveals `#f1f3f5` background with `#1e242d` text.

### Form Inputs
- **Base State:** Background `#ffffff`, border 1px solid `#d8dce2`, text `#1e242d`, placeholder `#94a3b8`, border radius 0.5rem. Height standard: 40px (desktop), 36px (dense data grids).
- **Focus State:** Border shifts directly to `#ea580c`, accompanied by a 3px soft focus ring: `rgba(234, 88, 12, 0.15)`.

### Cards & Panels
- **Structure:** `#ffffff` surface, 1px border `#d8dce2`, border-radius 1rem, internal padding `space-lg`.
- **Card Headers:** Feature clear section typography (`headline-sm`) accompanied by right-aligned monospace chips or secondary ghost actions.

### Chips & Badges
- **Status Indicators:** JetBrains Mono font (`label-md`), fully rounded.
  - *Active / Tangerine:* Background `#ffedd5`, text `#c2410c`.
  - *Success / Sage:* Background `#e9f0e8`, text `#3d5c23`.
  - *Warning / Amber:* Background `#fef3c7`, text `#92400e`.
  - *Neutral / Slate:* Background `#e2e8f0`, text `#334155`.

### Checkboxes & Radios
- **Unchecked:** 1.5px border `#cbd5e1`, background `#ffffff`.
- **Checked:** Background `#ea580c` with crisp white checkmark or center pip. Focus ring mirrors inputs with `rgba(234, 88, 12, 0.2)`.

### Data Tables
- **Header:** Background `#f1f3f5`, text `#475569`, typography `label-md`, 1px bottom border `#d8dce2`.
- **Rows:** Zebra striping avoided; alternating states rely on white base with hover state changing row background to `#f8fafc`. Row borders are hairline `#edf0f2`. Numerical columns align right using tabular figures.