import { useEffect, useRef } from 'react'

export function useAutoScroll(enabled = true) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current

    if (!el || !enabled) return

    let frame: number
    let paused = false
    let cooldownTimer: ReturnType<typeof setTimeout> | null = null

    const pause = () => {
      paused = true
      // Clear any pending cooldown — new interaction restarts it
      if (cooldownTimer) clearTimeout(cooldownTimer)
    }

    const resume = () => {
      // Don't resume immediately — give the smooth scroll time to finish
      if (cooldownTimer) clearTimeout(cooldownTimer)
      cooldownTimer = setTimeout(() => {
        paused = false
        cooldownTimer = null
      }, 1200)
    }

    const tick = () => {
      const canScroll = el.scrollWidth > el.clientWidth + 4
      const hasRoom = el.scrollLeft < el.scrollWidth - el.clientWidth - 4

      if (!paused && canScroll && hasRoom) {
        el.scrollLeft += 1.8
      }

      frame = requestAnimationFrame(tick)
    }

    el.addEventListener('pointerdown', pause)
    el.addEventListener('pointerup', resume)
    el.addEventListener('pointercancel', resume)
    el.addEventListener('pointerleave', resume)
    el.addEventListener('touchstart', pause, { passive: true })
    el.addEventListener('touchend', resume)
    el.addEventListener('touchcancel', resume)

    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      if (cooldownTimer) clearTimeout(cooldownTimer)
      el.removeEventListener('pointerdown', pause)
      el.removeEventListener('pointerup', resume)
      el.removeEventListener('pointercancel', resume)
      el.removeEventListener('pointerleave', resume)
      el.removeEventListener('touchstart', pause)
      el.removeEventListener('touchend', resume)
      el.removeEventListener('touchcancel', resume)
    }
  }, [enabled])

  return ref
}
