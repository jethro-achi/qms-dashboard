"use client"

import * as React from "react"

/**
 * Per-visual category selection. Keyed by the label set so a new dataset (e.g.
 * after a global filter changes) resets the selection to "all" — without an
 * effect. Returns the current selection and a setter.
 */
export function useCategorySelection(labels: string[]) {
  const key = labels.join("|")
  const [state, setState] = React.useState<{ key: string; selected: Set<string> }>({
    key,
    selected: new Set(labels),
  })
  const selected = state.key === key ? state.selected : new Set(labels)
  const setSelected = (next: Set<string>) => setState({ key, selected: next })
  return { selected, setSelected }
}
