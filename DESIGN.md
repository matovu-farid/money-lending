# Design System Strategy: The Quantitative Minimalist

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Sovereign Ledger."** 

In high-end fintech, luxury is not expressed through gold foils or heavy shadows, but through **extreme precision, mathematical clarity, and the luxury of space.** We are moving away from the "SaaS-template" look by treating the dashboard as a high-density financial instrument. 

While the layout is "sparse," the information density is high. We achieve this paradox through **Intentional Asymmetry**: using large `16` (5.5rem) or `20` (7rem) gutters to isolate critical data clusters, creating a layout that feels like a bespoke editorial piece rather than a rigid bootstrap grid. We prioritize the "Geist" typeface’s Swiss-inspired neutrality to let the data become the primary visual ornament.

---

## 2. Colors & Tonal Architecture
This system utilizes a monochromatic foundation to ensure that the single accent color—**Tertiary (Electric Blue)**—acts as a surgical strike for user attention.

### The "No-Line" Rule
Traditional 1px solid borders are strictly prohibited for sectioning. They clutter the visual field. Instead:
- **Spatial Separation:** Use the Spacing Scale (e.g., `8` or `10`) to create "voids" between modules.
- **Tonal Transitions:** Define boundaries by placing a `surface_container_lowest` (#ffffff) card against a `surface` (#f9f9fb) background.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of premium cardstock:
- **Base Layer:** `surface` (#f9f9fb) – The desk.
- **Section Layer:** `surface_container_low` (#f3f3f5) – To group related modules.
- **Interaction Layer:** `surface_container_lowest` (#ffffff) – Reserved for the most important data cards or active input areas.

### The "Glass & Ghost" Rule
For floating elements (modals, dropdowns), use `surface_container_lowest` with an 85% opacity and a `24px` backdrop-blur. This "Glassmorphism" ensures the data beneath isn't severed from context, maintaining the high-density feel.

---

## 3. Typography: The Precision Pair
We use **Geist** for its industrial clarity and **Geist Mono** for its tabular alignment, ensuring numbers never "jump" when updating.

*   **Display & Headlines (Geist):** Set with tight tracking (-2% or -3%) to create a "locked" architectural feel. Use `headline-lg` (2rem) for total portfolio balances.
*   **Data & Numbers (Geist Mono):** Every numerical value, from percentage changes to timestamps, must use Geist Mono. This ensures columns of numbers align perfectly (tabular figures), facilitating rapid scanning.
*   **Labels (Geist):** Use `label-sm` (0.6875rem) in `on_surface_variant` (#474747) for metadata. All caps with +5% letter spacing for a "Technical Blueprint" aesthetic.

---

## 4. Elevation & Depth
We eschew traditional drop shadows for **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by "stacking." A `surface_container_highest` (#e2e2e4) element should only be used for small utility components (like search bars) to make them recede or advance against the `surface`.
*   **Ambient Shadows:** If a floating state is required, use a `24px` blur with 4% opacity of the `on_surface` (#1a1c1d) color. It should feel like a soft glow, not a shadow.
*   **The Ghost Border Fallback:** If high-density data requires a container, use a `px` border of `outline_variant` (#c6c6c6) at **15% opacity**. It should be felt, not seen.

---

## 5. Components & Primitive Styling

### Buttons
*   **Primary:** `primary` (#000000) background with `on_primary` (#e2e2e2) text. Corner radius: `sm` (0.125rem) for a sharp, professional edge.
*   **Secondary:** `surface_container_high` (#e8e8ea) with `on_surface`. No border.
*   **Tertiary (Accent):** `tertiary` (#002f9c) text only. Used exclusively for "Execute" or "Confirm" actions.

### Cards & Data Modules
*   **Constraint:** No dividers. 
*   **Layout:** Use `padding: 4` (1.4rem). Group content using the `surface_container` tiers. For example, a "Transaction List" sits on `surface_container_low`, while the individual "Transaction Item" on hover shifts to `surface_container_lowest`.

### Input Fields
*   **Style:** Minimalist underline or "Ghost" box.
*   **Focus State:** The `outline` (#777777) shifts to `tertiary` (#002f9c) with a `px` stroke. No "glow" effects—just a sharp color change.

### The "Data-Density" List
*   **Leading Element:** Small 4x4px square of `tertiary` to denote "Active" or `error` for "Alert."
*   **Typography:** Label-md (Geist) for the category, followed immediately by Title-sm (Geist Mono) for the value.

---

## 6. Do’s and Don’ts

### Do
*   **Use Mono for alignment:** Ensure all currency values are right-aligned using Geist Mono.
*   **Embrace "The Void":** If a dashboard feels "empty," do not add decorative icons. Increase the spacing scale from `6` to `10`.
*   **Subtle Tonal Shifts:** Use `surface_dim` (#d9dadc) for disabled states rather than simple opacity lowers.

### Don’t
*   **No Rounded Corners > 8px:** The `lg` (0.5rem) radius is the absolute maximum. Prefer `sm` (0.125rem) for a more "Financial Terminal" feel.
*   **No Multi-Color Graphs:** Use shades of the monochromatic base (Secondary tokens) for data visualization. Use the `tertiary` accent only for the "Current" or "Highlighted" data point.
*   **No 100% Black Text on White:** Use `on_surface` (#1a1c1d) on `surface` (#f9f9fb) to reduce eye strain in high-density environments.