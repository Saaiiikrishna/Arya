# Design System: High-End Editorial

## 1. Overview & Creative North Star
**Creative North Star: The Architectural Monograph**

This design system moves away from the "app-like" feel of standard SaaS products and into the realm of high-end, story-driven editorial design. The aesthetic is inspired by premium physical print—think *Cereal* magazine or *Architectural Digest*. It rejects the "softness" of modern web design (rounded corners, blurred shadows) in favor of **Organic Brutalism**: a style defined by razor-sharp 0px corners, structural 1px hairlines, and a rhythmic use of whitespace.

To break the "template" look, designers should lean into **Intentional Asymmetry**. Do not center-align everything. Use the grid to create unexpected "pockets" of negative space. Treat every screen as a composition where typography is the primary visual anchor, and the background is a physical substrate (parchment) rather than a digital void.

---

## 2. Colors & Surface Philosophy

The palette is rooted in a heritage-inspired spectrum, utilizing high-contrast tones to establish authority.

### Palette Highlights
*   **Primary (#133022):** Deep Forest Green. Used for core branding and high-importance interactions.
*   **Background (#FEF9F0):** A warm Parchment. This is the "paper" on which all content sits.
*   **Surface (#FDFBF7):** Alabaster. A subtle, bright shift for high-level content containers.
*   **Tertiary (#5B0902):** Terracotta. Used sparingly as a "red pen" accent for highlights, alerts, or unique callouts.

### The "No-Shadow" Mandate
Traditional depth (box-shadows) is strictly prohibited. Depth is achieved through **Tonal Layering**.
*   **Nesting:** Place a `surface_container_lowest` card on a `surface_container_low` section to create a soft, natural distinction.
*   **Structural Lines:** Unlike many modern systems, we embrace the **1px Hairline**. Use the `outline_variant` (#C2C8C2) at 100% opacity for internal structural divisions. These are not "borders" in the traditional sense; they are architectural "joints."

### Signature Textures
For Hero sections or high-impact CTAs, do not use flat colors. Apply a subtle gradient from `primary` (#133022) to `primary_container` (#2A4737) at a 135-degree angle. This mimics the slight sheen of heavy, ink-saturated cardstock.

---

## 3. Typography

The typographic system is a dialogue between the classical authority of **Newsreader** (Serif) and the precision of **Satoshi/Public Sans** (Sans-serif).

*   **Display & Headline (Newsreader):** Use for storytelling. These should be set with tight letter-spacing and generous line-height. `display-lg` (3.5rem) should be used for hero statements that "bleed" into the margins.
*   **Title & Body (Public Sans/Satoshi):** Use for utility and long-form reading. Satoshi provides a "Swiss" neutrality that balances the expressive serif.
*   **Labels (Public Sans):** Set in `label-md` (0.75rem), always uppercase with 0.05rem letter-spacing. These function like captions in a gallery.

---

## 4. Elevation & Depth: Structural Integrity

Since we have eliminated shadows and rounded corners, we rely on **Linear Logic** to convey hierarchy.

*   **The Layering Principle:** Stacking is vertical and literal. 
    *   Base: `surface`
    *   Navigation/Top Bar: `surface_container_low` + 1px bottom border (`outline`).
    *   Floating Elements: To create a "floating" feel without shadows, use **Glassmorphism**. Apply `surface_variant` at 80% opacity with a 20px backdrop-blur. This creates a "frosted glass" overlay that feels premium and integrated.
*   **The Ghost Border:** For secondary elements, use the `outline_variant` at 20% opacity. This creates a "suggestion" of a boundary without cluttering the editorial flow.

---

## 5. Components

### Buttons
*   **Primary:** Sharp 0px corners, `primary` background, `on_primary` text. No hover shadow; instead, hover state shifts background to `primary_container`.
*   **Secondary:** 1px solid `outline` border, transparent background, `on_surface` text.
*   **Tertiary (Editorial Link):** `Newsreader` italicized text with a 1px underline that sits 4px below the baseline.

### Cards & Lists
*   **Editorial Cards:** Forbid the use of divider lines within a card. Use vertical white space (from the `8` or `12` spacing tokens) to separate titles from body text. 
*   **The "Frame" Rule:** All cards must have a 0px radius and a 1px `outline_variant` border. They should look like framed photographs.

### Inputs & Fields
*   **Style:** Minimalist. Only a 1px bottom border (`outline`) in the resting state. 
*   **Focus State:** The bottom border thickens to 2px using the `primary` color. Labels shift to `label-sm` and use the `tertiary` (Terracotta) color to draw the eye.

### Signature Component: The "Pull Quote"
A specific component for this design system. It uses `headline-lg` in Newsreader, set in `tertiary` (Terracotta), with a 1px vertical line on the left. It breaks the grid to draw attention to founder insights.

---

## 6. Do’s and Don’ts

### Do:
*   **Embrace the Grid:** Use the 1px hairlines to create a literal "table" structure for data.
*   **High Contrast:** Use `on_background` (#1D1C16) text against `background` (#FEF9F0) for maximum readability.
*   **Asymmetric Layouts:** Allow images to take up 7 columns of a 12-column grid, leaving 5 columns of "dead" space for a caption.

### Don’t:
*   **Don’t round any corners:** Not for buttons, not for inputs, not for images. 0px is the law.
*   **Don’t use shadows:** If an element needs to stand out, use a background color shift or a high-contrast border.
*   **Don’t use standard "Blue" for links:** Use `primary` (Forest Green) or `tertiary` (Terracotta).
*   **Don’t crowd the content:** If in doubt, increase the spacing. The system relies on the `16` (5.5rem) and `20` (7rem) tokens to create an expensive, airy feel.

---

## 7. Public Marketing Layer (Scoped Exception)

> **Scope:** This section applies **only** to the public, top-of-funnel marketing surfaces:
> the home landing (`/`), the programme landing (`/startup`), the storefront (`/store`,
> `/store/[slug]`, `/store/[slug]/build`), and the journal (`/articles`, `/articles/[slug]`).
> **The application (`/hub/*`), all `/admin/*`
> dashboards, `/apply`, `/investors`, and every authenticated/operational screen remain governed by
> Sections 1–6 above — 0px corners, no shadows, matte CTAs. No exceptions there.**

The marketing layer's job is conversion: it must feel premium, modern, and tactile to a first-time
visitor. To do that it is permitted a small, **deliberately bounded** set of departures from Organic
Brutalism. These are implemented as `mkt-*` utility classes in `globals.css` and are only ever used
inside a `.mkt` wrapper, which guarantees they cannot leak into the app/admin design.

### What the marketing layer MAY do
*   **Rounded geometry:** Pills (`rounded-full`) and softly-rounded cards/containers (12–24px radius)
    are allowed for hero badges, CTAs, feature cards, and media frames. The hero pill on the
    (moved) Manifesto at `/startup` is in-scope here.
    *   **Note:** Circular dots and pills (status dots, avatars, the `rounded-full` on a true circle)
        already fall under the global *rounded-full-for-circles* allowance and are permitted on every
        surface — they are not a marketing-only exception.
*   **Glossy, not matte, CTAs:** Primary actions use a saffron→marigold gradient with an inner top
    highlight, a soft saffron glow, and a **subtle animated sheen** that sweeps across on hover
    (`.mkt-btn`). A secondary glass variant (`.mkt-btn-ghost`) is available.
*   **Premium glass:** Frosted, rounded glass cards (`.mkt-card`, `.mkt-glass`) with brand-tinted
    translucency and `backdrop-blur`.
*   **Soft depth & glow:** Bounded `box-shadow`/glow is allowed **only** on `mkt-*` elements to sell
    the glossy effect. Keep it tasteful (low alpha, brand-tinted).
*   **Ambient motion:** Slow floating accents (`.mkt-float`), gradient orbs, and `motion` scroll
    reveals. Keep every animation ≤ 700ms and **honor `prefers-reduced-motion`**.

### What stays the same (even here)
*   **Palette is unchanged:** forest / parchment / alabaster / terracotta / saffron / marigold / ink.
    No new brand hues.
*   **Type system is unchanged:** Newsreader / Fraunces (display) + Public Sans; labels uppercase
    with letter-spacing.
*   **Restraint:** Glossy/rounded is for *marketing emphasis*, not everywhere. Body surfaces still lean
    on parchment, hairlines, and editorial typography. Don't gamify.

### Rule of thumb
If a screen requires login or is operational (admin, hub, apply, investor portal) → **Sections 1–6,
strictly**. If a screen's job is to convince a stranger to join, buy, or read → **`.mkt` layer allowed**.