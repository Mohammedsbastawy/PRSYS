---
name: Systematic Utility
colors:
  surface: '#f8f9fb'
  surface-dim: '#d9dadc'
  surface-bright: '#f8f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f6'
  surface-container: '#edeef0'
  surface-container-high: '#e7e8ea'
  surface-container-highest: '#e1e2e4'
  on-surface: '#191c1e'
  on-surface-variant: '#434655'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f3'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#515659'
  on-tertiary: '#ffffff'
  tertiary-container: '#696e71'
  on-tertiary-container: '#edf1f5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#dfe3e7'
  tertiary-fixed-dim: '#c3c7cb'
  on-tertiary-fixed: '#171c1f'
  on-tertiary-fixed-variant: '#43474b'
  background: '#f8f9fb'
  on-background: '#191c1e'
  surface-variant: '#e1e2e4'
typography:
  display:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style
The design system is engineered for high-density enterprise environments where data clarity and cognitive efficiency are paramount. The aesthetic follows a **Modern Corporate** approach, leaning heavily into a utilitarian, functionalist philosophy. It prioritizes a "quiet" interface that recedes to allow user data and workflows to take center stage. 

The emotional response is one of reliability, order, and precision. It avoids visual "noise"—such as heavy shadows or vibrant gradients—in favor of a structured, grid-based layout and a restrained color palette. This is a workspace designed for long-term focus and professional rigor.

## Colors
The color strategy employs a "Neutral-First" architecture. The background uses a soft off-white (`#F5F6F8`) to reduce screen glare during extended use. White is reserved strictly for interactive surfaces, cards, and panels to create a clear "layering" effect without needing heavy shadows.

- **Primary Blue:** Used exclusively for "intent" (Primary actions, active navigation, and links).
- **Surface & Borders:** Elements are defined by 1px solid borders in `#E2E8F0`. 
- **Status:** Standard semantic colors are applied to labels and indicators to ensure immediate recognition of system states.
- **Grays:** A scale of cool grays provides hierarchy for secondary text and disabled states.

## Typography
This design system utilizes **Inter** for its exceptional legibility in data-dense environments. The type scale is compact to maximize information density. 

- **Weight Usage:** Bold weights (700) are used sparingly for page titles. Semibold (600) is the standard for sub-headers and button text. Regular (400) is used for all body and input text.
- **Information Density:** The 14px `body-md` is the primary size for table data and form fields. The 13px `body-sm` is utilized for secondary metadata and sidebars.
- **Alignment:** Numbers in tables should use tabular lining (if available in the font feature settings) to ensure vertical alignment of decimal points.

## Layout & Spacing
The layout follows a **Rigid Grid** philosophy. A 4px baseline shift ensures all components—from buttons to input heights—align vertically.

- **Desktop:** 12-column grid with a 16px gutter. Content containers are typically restricted to a maximum width of 1440px to maintain line-length readability.
- **Side Navigation:** A fixed left-hand sidebar (240px) is the primary navigation pattern. 
- **Density:** Spacing between related form elements is 16px (`md`), while spacing between unrelated sections is 32px (`xl`).
- **Tables:** Data tables use a "Compact" vertical padding of 8px to maximize rows-per-screen.

## Elevation & Depth
Depth is communicated through **Tonal Separation** and **Low-Contrast Outlines** rather than traditional shadows.

- **Level 0 (Background):** `#F5F6F8` (Off-white).
- **Level 1 (Surface):** White (`#FFFFFF`) with a 1px solid `#E2E8F0` border. This is used for cards, tables, and panels.
- **Level 2 (Interaction):** A very soft, subtle shadow (`0 1px 3px rgba(0,0,0,0.05)`) is used only for floating elements like dropdown menus or tooltips to provide a functional separation from the surface.
- **Active State:** Active navigation items or selected cards use a 2px vertical border-left in the primary blue to indicate focus.

## Shapes
The shape language is "Soft-Square." It uses a minimal 4px radius (`0.25rem`) to take the sharp edge off the interface while maintaining a professional, structured appearance. 

- **Buttons & Inputs:** 4px radius.
- **Cards & Modals:** 8px radius (`rounded-lg`).
- **Status Pills:** Fully rounded (pill-shaped) to distinguish them clearly from interactive buttons.
- **Avoidance:** No circular or highly rounded "bubbly" buttons. Every shape must feel intentional and architectural.

## Components
- **Buttons:**
  - *Primary:* Solid `#2563EB` with white text. No gradients.
  - *Secondary:* White background with `#E2E8F0` border and `#1E293B` text.
  - *Ghost:* No border or background; text-only until hover.
- **Input Fields:** 1px solid `#E2E8F0` border. On focus, the border changes to the primary blue with a subtle 2px glow of the same color at 10% opacity.
- **Data Tables:** Header row has a light gray background (`#F8FAFC`) and semibold text. Row dividers are 1px solid `#F1F5F9`.
- **Navigation:** Vertical sidebars use `#F8FAFC` for the background. Active states use a subtle gray background change and a 2px blue "accent bar" on the left edge.
- **Chips/Status:** Small text, 4px radius or pill-shaped, using low-saturation versions of the semantic palette (e.g., light green background with dark green text for "Success").
- **Cards:** White background, 1px border, no shadow unless the card is interactive/clickable on hover.