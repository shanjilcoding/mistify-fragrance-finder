import { useCallback, useRef, type ReactNode } from 'react'

type GalleryShelfRowProps = {
  children: ReactNode
}

function GalleryShelfRow({ children }: GalleryShelfRowProps) {
  const ref = useRef<HTMLDivElement>(null)

  const scrollBy = useCallback((direction: 'left' | 'right') => {
    const el = ref.current

    if (!el) return

    const card = el.querySelector('.catalog-card--gallery')
    const cardWidth = card?.getBoundingClientRect().width ?? 220
    const gap = 14
    const amount = cardWidth + gap

    el.scrollBy({
      left: direction === 'right' ? amount : -amount,
      behavior: 'smooth',
    })
  }, [])

  return (
    <div className="catalog-gallery-shelf__row" ref={ref}>
      <button
        type="button"
        className="catalog-gallery-shelf__arrow catalog-gallery-shelf__arrow--left"
        aria-label="Scroll left"
        onClick={() => scrollBy('left')}
      >
        ‹
      </button>

      {children}

      <button
        type="button"
        className="catalog-gallery-shelf__arrow catalog-gallery-shelf__arrow--right"
        aria-label="Scroll right"
        onClick={() => scrollBy('right')}
      >
        ›
      </button>
    </div>
  )
}

export default GalleryShelfRow
