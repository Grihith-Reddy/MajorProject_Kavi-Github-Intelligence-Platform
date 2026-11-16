/**
 * The KAVI mark: the Audiowide "K" with a dot resting on the baseline in its lower opening.
 * The stem reads as I, the chevron as a V on its side, and with the dot the K carries all four
 * letters. One colour (currentColor): black on light surfaces, white on dark ones.
 *
 * Geometry is the Audiowide K in 1000-unit space, cropped to the glyph (x 125-856, y 250-949).
 * Small sizes get a larger dot so it survives at tab-icon scale.
 */
export function KaviMark({ size = 24, title, className }: { size?: number; title?: string; className?: string }) {
  const r = size <= 18 ? 80 : size <= 32 ? 70 : 58
  const label = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const }
  return (
    <svg
      className={className}
      width={Math.round((size * 731) / 699)}
      height={size}
      viewBox="125 250 731 699"
      fill="currentColor"
      {...label}
    >
      <path d="M139 250H237Q251 250 251 264V935Q251 949 237 949H139Q125 949 125 935V264Q125 250 139 250Z" />
      <path d="M677 250H856L497 600L856 949H677L372 644H303V556H372Z" />
      <circle cx="415" cy={949 - r} r={r} />
    </svg>
  )
}
