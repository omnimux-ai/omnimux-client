import { heroMarkPresentation, parseLogoSvg, resolveHeroLogoSvg } from './hero-brand.js'

/**
 * OmniMux brand mark for the blank-session hero.
 * Eats the official owner props (`size`, `className`) so the host keeps
 * headline color and hover motion.
 * @param {{ size: number, className?: string }} props
 */
export function HeroBrandMark({ size, className }) {
  const { width, height, className: cls } = heroMarkPresentation(size, className)
  const { viewBox, inner } = parseLogoSvg(resolveHeroLogoSvg())
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={width}
      height={height}
      className={cls}
      aria-hidden="true"
      focusable="false"
      data-omnimux-hero-mark=""
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}
