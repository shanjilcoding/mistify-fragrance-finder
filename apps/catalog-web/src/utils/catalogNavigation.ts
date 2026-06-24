import type { CatalogFragrance } from '../api/catalogApi'
import { hasUsableProductName } from './catalogFormat'

const FINDER_URL = import.meta.env.VITE_FINDER_URL?.trim() || '/'

// Client-side navigation that matches the app's manual routing pattern
// (pushState + popstate) so catalog links stay within the SPA.
export function navigateTo(path: string) {
  if (window.location.pathname === path) {
    return
  }

  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// Builds an onClick handler for in-app anchor links. Left-clicks navigate via
// the SPA router; modified clicks (new tab, etc.) fall through to the browser.
export function handleInternalLinkClick(path: string) {
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    event.preventDefault()
    navigateTo(path)
  }
}

function getFragranceSubject(fragrance: CatalogFragrance): string {
  const inspiredBy = fragrance.publicInspiredByLabel?.trim()
  const productName = hasUsableProductName(fragrance)
    ? fragrance.mistifyProductName?.trim()
    : ''
  const productPart = productName ? ` / Mistify ${productName}` : ''

  return `${inspiredBy || productName || 'this Mistify fragrance'}${productPart}`
}

export function buildAskChatbotPrompt(fragrance: CatalogFragrance): string {
  return `I'm interested in ${getFragranceSubject(fragrance)}. Tell me what it smells like and suggest similar Mistify fragrances.`
}

export function buildOrderContactPrompt(fragrance: CatalogFragrance): string {
  return `I'm interested in ordering ${getFragranceSubject(fragrance)}, but I don't see a shop link. How can I contact the Mistify team to order it?`
}

function handOffToChatbot(prompt: string) {
  const finderUrl = new URL(FINDER_URL, window.location.origin)
  finderUrl.searchParams.set('prompt', prompt)
  window.location.href = finderUrl.toString()
}

// Sends the user to the finder/chat app with an explicit prompt in the URL.
// This works even when catalog and finder are deployed as separate apps/domains.
export function askChatbotAbout(fragrance: CatalogFragrance) {
  handOffToChatbot(buildAskChatbotPrompt(fragrance))
}

export function contactMistifyToOrder(fragrance: CatalogFragrance) {
  handOffToChatbot(buildOrderContactPrompt(fragrance))
}
