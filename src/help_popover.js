// ============================================================================
// Help popover
// One non-modal help panel per trigger. Native Popover API when available,
// with a DOM fallback for the test harness and older engines.
// ============================================================================

const openPopovers = new Set();

export function createHelpPopover({ document: doc, trigger, panel } = {}) {
  if (!doc || !trigger || !panel) return null;

  const win = doc.defaultView || (typeof window !== "undefined" ? window : null);
  const MOBILE_MAX_WIDTH = 560;
  const VIEWPORT_MARGIN = 8;
  const native = typeof panel.showPopover === "function" && typeof panel.hidePopover === "function";
  let open = false;
  let destroyed = false;

  const closeSelf = () => close({ focus: false });

  function clearPosition() {
    panel.style.left = "";
    panel.style.top = "";
    panel.style.transform = "";
  }

  function positionPanel() {
    if (!open || !win) return;
    const width = win.innerWidth || 0;
    if (width <= MOBILE_MAX_WIDTH) {
      clearPosition();
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const gap = 8;
    let left = triggerRect.left + triggerRect.width / 2 - panelRect.width / 2;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, width - panelRect.width - VIEWPORT_MARGIN));
    let top = triggerRect.bottom + gap;
    if (top + panelRect.height > (win.innerHeight || 0) - VIEWPORT_MARGIN) {
      top = triggerRect.top - panelRect.height - gap;
    }
    top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(top, (win.innerHeight || 0) - panelRect.height - VIEWPORT_MARGIN),
    );
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.transform = "none";
  }

  function setOpen(next, { focus = true } = {}) {
    if (destroyed || open === next) return;
    open = next;
    trigger.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("is-open", open);
    if (open) {
      openPopovers.add(closeSelf);
      positionPanel();
      if (focus) {
        const focusTarget = panel.querySelector?.("[data-help-focus]") || panel;
        focusTarget.focus?.();
      }
    } else {
      openPopovers.delete(closeSelf);
      clearPosition();
      if (focus) trigger.focus?.();
    }
  }

  function openPanel() {
    if (open || destroyed) return;
    for (const closePeer of openPopovers) closePeer();
    if (native) {
      panel.showPopover();
      if (!open) setOpen(true);
    } else {
      panel.hidden = false;
      setOpen(true);
    }
  }

  function close({ focus = true } = {}) {
    if (!open || destroyed) return;
    if (native) {
      panel.hidePopover();
      if (open) setOpen(false, { focus });
    } else {
      panel.hidden = true;
      setOpen(false, { focus });
    }
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  function onToggle(event) {
    setOpen(event.newState === "open");
  }

  function onPointerDown(event) {
    if (!open) return;
    const target = event.target;
    if (panel.contains?.(target) || trigger.contains?.(target)) return;
    close();
  }

  function onKeyDown(event) {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    close();
  }

  function onTriggerClick(event) {
    event.preventDefault();
    toggle();
  }

  trigger.setAttribute("aria-expanded", String(open));
  panel.classList.toggle("is-open", open);

  if (native) {
    panel.addEventListener("toggle", onToggle);
  } else {
    panel.hidden = true;
    trigger.addEventListener("click", onTriggerClick);
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
  }
  win?.addEventListener?.("resize", positionPanel);
  win?.addEventListener?.("scroll", positionPanel, true);

  return {
    open: openPanel,
    close,
    toggle,
    destroy() {
      if (destroyed) return;
      close({ focus: false });
      destroyed = true;
      openPopovers.delete(closeSelf);
      if (native) panel.removeEventListener("toggle", onToggle);
      else {
        trigger.removeEventListener("click", onTriggerClick);
        doc.removeEventListener("pointerdown", onPointerDown, true);
        doc.removeEventListener("keydown", onKeyDown, true);
      }
      win?.removeEventListener?.("resize", positionPanel);
      win?.removeEventListener?.("scroll", positionPanel, true);
    },
  };
}
