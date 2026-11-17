# MaintainableCSS implementation patterns

Concrete before-and-after HTML and CSS reference patterns from Adam Silver's [MaintainableCSS](https://maintainablecss.com/).

## 1. Module vs component and preventing nested cascade bleed

When a parent module styles raw HTML tags (`.header a` or `.panel p`), any child module placed inside it inherits those styles by mistake. Scope parent parts with `.module-component` classes and extract reusable children as standalone modules.

**Before (cascade bleed and ambiguous hyphens):**

```html
<div class="site-header">
  <a href="/">Brand</a>
  <div class="user-menu">
    <a href="/profile">Profile</a> <!-- Bleeds .site-header a styles -->
  </div>
</div>
```

```css
.site-header a { font-size: 2rem; font-weight: bold; }
.user-menu a { font-size: 1rem; /* Forced to override parent font-weight */ }
```

**After (explicit component hook + independent child module):**

```html
<div class="siteHeader">
  <a class="siteHeader-logo" href="/">Brand</a>
  <div class="userMenu">
    <a class="userMenu-link" href="/profile">Profile</a>
  </div>
</div>
```

```css
.siteHeader-logo { font-size: 2rem; font-weight: bold; }
.userMenu-link { font-size: 1rem; }
```

*Exception for leaf prose containers:* A rich-text container that holds only CMS or Markdown prose and never wraps child UI modules (`.prose p`, `.prose ul`) may style descendant tags directly.

---

## 2. State classes and ARIA pairing

Never chain an unprefixed state class (`.basket.isEmpty`) or style `[aria-*]` attributes in isolation when visual transitions differ per module. Apply both the base class and the module-prefixed state class on the element, and keep ARIA attributes for semantics.

**Before (chained state and global collision):**

```html
<div class="basket is-empty">...</div>
```

```css
.basket.is-empty { background: #fef2f2; }
.is-empty { display: none; } /* Collides with .basket */
```

**After (flat module-prefixed state + ARIA):**

```html
<div class="basket basket-isEmpty" aria-live="polite">
  <p class="basket-emptyMessage">Your basket is empty.</p>
</div>
```

```css
.basket { background: #fff; }
.basket-isEmpty { background: #fef2f2; }
```

---

## 3. Modifiers vs standalone modules

Use a `--modifier` only for minor visual tweaks on the same structure. When layout, markup structure or responsive behaviour diverges, extract a dedicated module instead of piling overrides onto a modifier.

**Valid modifier (small visual delta):**

```html
<button class="button button--primary" type="button">Checkout</button>
<button class="button button--secondary" type="button">Cancel</button>
```

```css
.button { padding: 0.5rem 1rem; border-radius: 4px; }
.button--primary { background: #1d4ed8; color: #fff; }
.button--secondary { background: #e5e7eb; color: #111827; }
```

**When to split into a new module:** If a "compact basket" in the header drops product thumbnails, uses a popover layout and has different typography from the checkout `.basket`, name it `.miniBasket` rather than `.basket--mini`.

---

## 4. Decoupling JavaScript behaviour from module CSS

Two modules often share interactive behaviour (such as toggling visibility or collapsible panels) while needing different visual transitions (for example, one slides down on mobile only, while another hides immediately at all viewports).

```html
<div class="searchFilter" data-module="collapsible" data-state-class="searchFilter-isCollapsed">
  <button class="searchFilter-toggle" type="button" aria-expanded="true">Filters</button>
  <div class="searchFilter-body">...</div>
</div>
```

```css
.searchFilter-isCollapsed .searchFilter-body {
  display: none;
}

@media (min-width: 48em) {
  .searchFilter-isCollapsed .searchFilter-body {
    display: block; /* Always visible on desktop despite collapsed mobile state */
  }
}
```

A global state class (`.isHidden { display: none; }`) is appropriate only when both behaviour and visual rendering are identical across every module in the application.

---

## 5. Parallel versioning for A/B tests and migrations

Never interleave `.basket-v2` override selectors inside `.basket`. Duplicate the module into `.basket2` so both versions remain isolated and deleting the retired version is a single-block deletion.

```html
<!-- Variant A -->
<div class="basket">
  <h2 class="basket-title">Your basket</h2>
</div>

<!-- Variant B -->
<div class="basket2">
  <h2 class="basket2-title">Bag summary</h2>
</div>
```

Once Variant B wins, delete `.basket` rules and either keep `.basket2` or rename it to `.basket` in one pass.

---

## 6. Co-located `@media` queries

Keep responsive rules inside the module section rather than scattering module styles across viewport-named stylesheets (`mobile.css`, `desktop.css`).

```css
.productGrid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

@media (min-width: 48em) {
  .productGrid {
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
  }
}
```
