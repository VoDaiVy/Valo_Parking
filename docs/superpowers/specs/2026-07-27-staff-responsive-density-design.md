# Staff Responsive Density Design

## Goal

Keep the current Staff dashboard density unchanged on a 1920x1080 desktop while automatically reducing oversized typography, spacing, navigation, and controls on laptop-sized CSS viewports such as common MacBook display modes.

## Root Cause

The application already declares a correct responsive viewport. The Staff shell, however, is built mostly from a fixed desktop density: a 240px sidebar, a 70px top bar, fixed icon sizes, and Tailwind `rem` typography and spacing. A MacBook scaled display or 125% browser zoom exposes a smaller CSS viewport, so those values occupy substantially more of the visible area. This is a layout-density issue rather than a Montserrat font-loading issue.

## Scope

- Apply automatic density changes only while `DashboardLayout` renders a Staff session.
- Preserve the existing 1920x1080 appearance.
- Do not change Admin, Customer, Kiosk, backend behavior, routing, or business logic.
- Preserve normal mobile responsiveness below the desktop breakpoint.
- Do not use `transform: scale()` or whole-page CSS `zoom`, which can distort scrolling, fixed overlays, pointer coordinates, and text rendering.

## Design

### Staff-scoped activation

`DashboardLayout` will expose a Staff-only marker class while the active role is `staff`. The marker will be removed when the layout unmounts or the role changes so the density rules cannot leak to another application area.

### Density tiers

The normal tier remains the current 16px root scale.

- Compact desktop: at least 1024px wide and either at most 1600px wide or at most 900px high, use a 14px root scale for the active Staff dashboard.
- Dense laptop: at least 1024px wide and either at most 1400px wide or at most 780px high, use a 13px root scale.
- Mobile/tablet below 1024px keeps the existing root scale and existing responsive behavior.

Tailwind spacing and typography are predominantly expressed in `rem`, so these tiers reduce the UI proportionally without rewriting each Staff page. Fixed shell measurements will be converted from pixel-based arbitrary utilities to equivalent `rem` values so the sidebar, collapsed rail, top bar, and collapse control participate in the same density system.

### Accessibility and stability

- Maintain readable minimum sizes: 14px in compact desktop and 13px only in the short/dense laptop tier.
- Keep focus rings, semantic colors, and interaction states unchanged.
- Keep browser zoom available; no JavaScript will force or reset zoom.
- Use CSS media queries so resizing and display-mode changes update immediately without event listeners.

## Verification

- A unit test will assert the density tier contract and Staff-only class naming.
- ESLint will verify the modified layout and test/helper files.
- The production frontend build must pass.
- A source audit will confirm that the density class is conditional on the Staff role and removed during cleanup.
- If an interactive browser is available, verify at 1920x1080, 1512x982, 1440x900, and a short 1536x768 viewport.

## Success Criteria

- 1920x1080 Staff UI retains its current sizing.
- MacBook/laptop viewports show visibly denser content without clipped navigation or oversized headings.
- Admin, Customer, and Kiosk sizing remains unchanged.
- Modals, scrolling, and click targets remain correctly positioned.
