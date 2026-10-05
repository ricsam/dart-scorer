import { useDocumentTitle } from '../hooks'
import { Link } from '../router'
import { EmptyState } from '../ui'

export function NotFoundPage() {
  useDocumentTitle('Not found — Oche')
  return (
    <div className="page">
      <EmptyState title="Bounced out">
        That page doesn’t exist. <Link to="/" className="text-link">Back to the home page →</Link>
      </EmptyState>
    </div>
  )
}
