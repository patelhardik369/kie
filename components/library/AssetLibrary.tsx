'use client'

import { useState } from 'react'

import { formatBytes, formatTimestamp } from '@/lib/gallery/display.ts'

/**
 * Input assets, with their upload status.
 *
 * The distinction this surface exists to make: an **expired** asset is not a
 * broken one. The local copy is kept, so asking to use it re-uploads
 * transparently and hands back a fresh URL. Only a missing local copy is
 * unrecoverable.
 */

export interface LibraryAssetItem {
  id: string
  kind: string
  label: string | null
  bytes: number | null
  localPath: string
  createdAt: number
  live: boolean
  expiresAt: number | null
}

export function AssetLibrary({ initialAssets }: { initialAssets: LibraryAssetItem[] }) {
  const [assets, setAssets] = useState(initialAssets)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = async (id: string) => {
    setBusy(id)
    setMessage(null)
    try {
      const response = await fetch(`/api/input-assets/${id}`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Could not renew this upload.')

      setAssets((prev) =>
        prev.map((a) => (a.id === id ? { ...a, live: true, expiresAt: data.expiresAt } : a)),
      )
      setMessage(
        data.reused
          ? 'Still live — the cached upload was reused, with no round trip.'
          : 'Re-uploaded from the local copy. The new URL is good for another day.',
      )
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string) => {
    const previous = assets
    setAssets((prev) => prev.filter((a) => a.id !== id))
    const response = await fetch(`/api/input-assets/${id}`, { method: 'DELETE' })
    if (!response.ok) setAssets(previous)
  }

  if (assets.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-(--color-border) px-4 py-8 text-center text-sm text-(--color-ink-muted)">
        No input assets yet. Uploading a file in any asset field adds it here.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {message && (
        <p className="rounded border-l-2 border-(--color-accent) bg-(--color-accent)/10 px-3 py-2 text-xs text-(--color-ink-muted)">
          {message}
        </p>
      )}

      <ul className="divide-y divide-(--color-border) overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
        {assets.map((asset) => (
          <li key={asset.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] ${
                asset.live
                  ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300'
                  : 'border-amber-400/50 bg-amber-400/10 text-amber-300'
              }`}
              title={
                asset.live
                  ? 'The cached Kie URL is still valid — reuse costs no upload.'
                  : 'The Kie URL has expired. The local copy is kept, so using it re-uploads transparently.'
              }
            >
              {asset.live ? 'live' : 'expired'}
            </span>

            <span className="min-w-0 flex-1 truncate text-sm" title={asset.localPath}>
              {asset.label ?? asset.localPath}
            </span>

            <span className="shrink-0 font-mono text-[11px] text-(--color-ink-muted)">
              {asset.kind} · {formatBytes(asset.bytes)} · {formatTimestamp(asset.createdAt)}
            </span>

            <button
              type="button"
              onClick={() => void refresh(asset.id)}
              disabled={busy === asset.id}
              className="shrink-0 rounded-md border border-(--color-border) px-2 py-1 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted) disabled:opacity-40"
            >
              {busy === asset.id ? 'Checking…' : asset.live ? 'Get URL' : 'Renew'}
            </button>
            <button
              type="button"
              onClick={() => void remove(asset.id)}
              className="shrink-0 rounded-md border border-(--color-border) px-2 py-1 text-xs text-(--color-ink-muted) transition hover:border-red-400 hover:text-red-400"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
