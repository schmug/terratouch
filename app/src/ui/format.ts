// format.ts — tiny display formatters for the UI layer.

/** "6 h 12 min" / "4 min" / "38 s" from milliseconds. */
export function prettyDuration(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec} s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rem = min % 60
  return rem > 0 ? `${h} h ${rem} min` : `${h} h`
}

/** Whole-number display for resources. */
export function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString('en-US')
}

/** Signed delta chip text: "+7" / "−4". */
export function fmtDelta(n: number): string {
  const rounded = Math.round(n * 10) / 10
  const text = Number.isInteger(rounded) ? `${Math.abs(rounded)}` : `${Math.abs(rounded)}`
  return rounded >= 0 ? `+${text}` : `−${text}`
}
