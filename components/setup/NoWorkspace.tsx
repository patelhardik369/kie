import Link from 'next/link'

/**
 * What a page shows before this browser has a workspace.
 *
 * Reached exactly once per browser — on the very first render, before
 * `StudioBoot` has written the cookie. It is not an error state and does not
 * read like one: there is genuinely nothing to show yet, because nothing has
 * been generated yet.
 *
 * It is also what someone sees who has cleared their site data, which is the
 * case that actually needs the words. Their generations still exist; what is
 * gone is the id that finds them. So the link to Settings is the recovery path,
 * not an afterthought.
 */
export function NoWorkspace({ what = 'anything' }: { what?: string }) {
  return (
    <div className="mt-8 rounded-lg border border-dashed border-(--color-border) px-6 py-10 text-center">
      <p className="text-[15px] font-medium text-(--color-ink)">
        Nothing here yet
      </p>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-(--color-ink-muted)">
        This browser has no workspace yet, so there is no {what} to show. Make
        something and it will appear here.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          href="/welcome"
          className="rounded-md bg-(--color-accent) px-4 py-2 text-[13px] font-medium text-(--color-accent-ink)"
        >
          Get started
        </Link>
        <Link
          href="/settings"
          className="rounded-md border border-(--color-border) px-4 py-2 text-[13px] text-(--color-ink-muted) hover:text-(--color-ink)"
        >
          I had a workspace before
        </Link>
      </div>
    </div>
  )
}
