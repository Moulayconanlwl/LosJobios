import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnswerEntry, Application, Profile, RunState, SavedJob, Settings } from '@/lib/schema'
import {
  STORAGE_KEYS,
  getAnswers,
  getApplications,
  getProfile,
  getRunState,
  getSavedJobs,
  getSettings,
  onStorageChanged,
} from '@/lib/storage'

/**
 * React bindings over chrome.storage.
 *
 * Every surface reads the same storage, and a run mutates it from the
 * background, so these subscribe to change events rather than polling — the
 * popup's counters update as the run progresses without any timer.
 */

type Loadable<T> = { data: T; loading: boolean; reload: () => void }

function useStored<T>(read: () => Promise<T>, keys: string[], initial: T): Loadable<T> {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    let cancelled = false
    void read().then((value) => {
      if (cancelled) return
      setData(value)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // `read` is recreated per render by callers; the key list is the real
    // dependency, and it's stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, keys)

  useEffect(() => {
    const cancel = reload()
    const unsubscribe = onStorageChanged(keys, () => {
      void read().then(setData)
    })
    return () => {
      cancel()
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  return { data, loading, reload }
}

export function useRunState(): Loadable<RunState | null> {
  return useStored(getRunState, [STORAGE_KEYS.runState], null)
}

export function useProfile(): Loadable<Profile | null> {
  return useStored(getProfile, [STORAGE_KEYS.profile], null)
}

export function useSettings(): Loadable<Settings | null> {
  return useStored(getSettings, [STORAGE_KEYS.settings], null)
}

export function useApplications(): Loadable<Application[]> {
  return useStored(getApplications, [STORAGE_KEYS.applications], [])
}

export function useAnswers(): Loadable<AnswerEntry[]> {
  return useStored(getAnswers, [STORAGE_KEYS.answers], [])
}

export function useSavedJobs(): Loadable<SavedJob[]> {
  return useStored(getSavedJobs, [STORAGE_KEYS.savedJobs], [])
}

export type Draft<T> = {
  value: T | null
  /** Merge a partial update and schedule a save. */
  update: (patch: Partial<T>) => void
  saving: boolean
}

/**
 * Edit-in-place with debounced autosave.
 *
 * The subtlety is the feedback loop: saving writes to storage, storage fires a
 * change event, and the reloaded value would clobber whatever you've typed
 * since. So incoming values are only adopted while the draft is clean.
 */
export function useDraft<T extends object>(
  source: T | null,
  save: (value: T) => Promise<unknown>,
  delayMs = 500,
): Draft<T> {
  const [value, setValue] = useState<T | null>(source)
  const [saving, setSaving] = useState(false)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The edit waiting out the debounce, so it can be written immediately instead. */
  const pending = useRef<T | null>(null)
  const alive = useRef(true)

  // Held in a ref so flushing never calls a stale `save` closure.
  const saveRef = useRef(save)
  saveRef.current = save

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }

    const next = pending.current
    if (!next) return
    pending.current = null

    void saveRef.current(next).finally(() => {
      dirty.current = false
      if (alive.current) setSaving(false)
    })
  }, [])

  useEffect(() => {
    if (!dirty.current) setValue(source)
  }, [source])

  const update = useCallback(
    (patch: Partial<T>) => {
      setValue((current) => {
        if (!current) return current
        const next = { ...current, ...patch }

        dirty.current = true
        pending.current = next
        setSaving(true)

        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(flush, delayMs)

        return next
      })
    },
    [flush, delayMs],
  )

  /**
   * Write a pending edit out rather than dropping it.
   *
   * The debounce window is half a second, and closing the tab or switching
   * away inside it used to discard whatever was typed last — the timer was
   * cleared on unmount and nothing ever wrote the value. `pagehide` covers
   * the tab actually closing, which is the case React never gets to see.
   */
  useEffect(() => {
    alive.current = true
    const onHide = () => flush()
    window.addEventListener('pagehide', onHide)

    return () => {
      window.removeEventListener('pagehide', onHide)
      flush()
      alive.current = false
    }
  }, [flush])

  return { value, update, saving }
}
