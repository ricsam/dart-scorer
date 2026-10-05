import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

type RouterValue = { path: string; search: string; navigate: (to: string, options?: { replace?: boolean }) => void }

const RouterContext = createContext<RouterValue | null>(null)

function currentLocation() {
  return { path: window.location.pathname, search: window.location.search }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation)

  useEffect(() => {
    const onPopState = () => setLocation(currentLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    if (options.replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    setLocation(currentLocation())
    if (!options.replace) window.scrollTo(0, 0)
  }, [])

  const value = useMemo(() => ({ ...location, navigate }), [location, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter() {
  const value = useContext(RouterContext)
  if (!value) throw new Error('useRouter must be used inside RouterProvider')
  return value
}

/** Matches `/leagues/:leagueId` style patterns against a path. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < patternParts.length; index++) {
    const part = patternParts[index]
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(pathParts[index])
    else if (part !== pathParts[index]) return null
  }
  return params
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter()
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handleClick} {...rest}>{children}</a>
}
