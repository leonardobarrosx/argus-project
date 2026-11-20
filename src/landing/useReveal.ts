import { useEffect } from 'react'

/**
 * Adds `is-in` to every `[data-reveal]` element inside the page once it enters
 * the viewport. With reduced motion (or without IntersectionObserver) every
 * element is shown right away, so content never depends on the animation.
 */
export function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'))
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach(i => i.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    )
    items.forEach(i => io.observe(i))
    return () => io.disconnect()
  }, [root])
}
