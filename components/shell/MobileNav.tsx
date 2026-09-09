"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { usePins } from "@/components/models/pins-store.ts";
import { Close, Gear, Menu, Plus, Star } from "./icons.tsx";

/**
 * The navigation below `md`.
 *
 * The desktop rail put four labelled links, a pinned-models dropdown, a settings
 * button and a primary action on one 48px line. That works at 1200px. At 360px
 * the links became a horizontally scrolling strip of half-visible words — a
 * control most people never realise is scrollable, so the app looked like it had
 * two sections and had lost the rest.
 *
 * So on small screens the sections move into a sheet behind one button. What
 * stays on the bar is only what is worth permanent space: identity, the primary
 * action, and the way in.
 *
 * The sheet is a real one, not a dropdown stretched to fit:
 *
 *   - Full-height, right-anchored, with rows at 44px rather than 30px. A menu
 *     you open with a thumb is not a menu you read with a mouse.
 *   - Closes on navigation, on Escape, and on a backdrop tap. All three, because
 *     people reach for all three and a menu that ignores one feels stuck.
 *   - Locks background scroll while open — otherwise the page behind slides
 *     under your finger and you lose your place in the gallery.
 *   - Returns focus to the button that opened it, and traps Tab inside while
 *     open, so it is operable without a pointer at all.
 *
 * **Rendered through a portal, and it has to be.** The nav sits inside a
 * `<header>` carrying `backdrop-blur-xl`, and `backdrop-filter` makes an element
 * the containing block for its `position: fixed` descendants. Rendered in place,
 * `fixed inset-0` therefore resolved against the 48px header rather than the
 * viewport: the sheet was clipped to a strip at the top of the screen with every
 * link scrolled out of sight, and the backdrop covered the header alone. The
 * portal moves it to `document.body`, outside that containing block.
 */

interface NavLink {
  href: string;
  label: string;
  Icon: (props: { size?: number; className?: string }) => React.ReactElement;
}

export function MobileNav({ links }: { links: readonly NavLink[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "/";
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { pins, ready } = usePins();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  // A navigation is an answer to the menu, so the menu closes.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    // The page behind must not scroll under the sheet.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      // Keep Tab inside the sheet: behind it the whole page is still focusable,
      // and tabbing into content you cannot see is worse than no focus at all.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled])",
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // Focus the panel itself rather than its first link, so a screen reader
    // announces the dialog before reading out a menu item.
    panel.current?.focus();

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="btn btn-sm btn-icon btn-quiet shrink-0 md:hidden"
      >
        <Menu size={17} />
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 md:hidden">
            {/* Tapping away is how most people close a sheet. */}
            <button
              type="button"
              aria-label="Close menu"
              onClick={close}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            <div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              tabIndex={-1}
              className="absolute inset-y-0 right-0 flex w-[min(20rem,85vw)] flex-col border-l border-(--color-border) bg-(--color-bg) shadow-[var(--shadow-lg)] outline-none"
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-(--color-border) px-4">
                <span className="text-[13px] font-semibold tracking-[-0.02em] text-(--color-ink)">
                  Kie Studio
                </span>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close menu"
                  className="btn btn-sm btn-icon btn-quiet"
                >
                  <Close size={16} />
                </button>
              </div>

              {/* Scrolls on its own, so a long pin list cannot push the primary
                action off the bottom of the screen. */}
              <nav className="min-h-0 flex-1 overflow-y-auto p-2">
                {links.map(({ href, label, Icon }) => (
                  <Row
                    key={href}
                    href={href}
                    active={isActive(href)}
                    Icon={Icon}
                  >
                    {label}
                  </Row>
                ))}

                <Row
                  href="/settings"
                  active={isActive("/settings")}
                  Icon={Gear}
                >
                  Settings
                </Row>

                {ready && pins && pins.length > 0 && (
                  <>
                    <p className="mt-4 mb-1 px-3 text-[11px] font-medium tracking-wide text-(--color-ink-faint) uppercase">
                      Pinned
                    </p>
                    {pins.map((pin) => (
                      <Row
                        key={pin.slug}
                        href={`/generate/${pin.slug}`}
                        active={pathname === `/generate/${pin.slug}`}
                        Icon={Star}
                      >
                        <span className="truncate">{pin.label}</span>
                      </Row>
                    ))}
                  </>
                )}
              </nav>

              <div className="shrink-0 border-t border-(--color-border) p-3">
                <Link
                  href="/generate"
                  className="btn btn-primary w-full justify-center"
                >
                  <Plus size={14} />
                  New generation
                </Link>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** One row. 44px tall, which is the point of the whole component. */
function Row({
  href,
  active,
  Icon,
  children,
}: {
  href: string;
  active: boolean;
  Icon: NavLink["Icon"];
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-[14px] transition-colors duration-(--dur-fast) ${
        active
          ? "bg-(--color-surface-hover) text-(--color-ink)"
          : "text-(--color-ink-muted) active:bg-(--color-surface-raised)"
      }`}
    >
      <Icon
        size={16}
        className={active ? "text-(--color-accent)" : undefined}
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  );
}
