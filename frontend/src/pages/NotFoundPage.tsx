import { Link } from 'react-router-dom'
import { ArrowLeft, Home } from 'lucide-react'

import { StatusPage } from '../components/StatusPage'

export function NotFoundPage() {
  return (
    <StatusPage
      code="404"
      title="Lost in the clouds"
      message="This page doesn't exist, or it moved. Head back home and pick up from there."
      actions={
        <>
          <Link to="/" className="kv-btn kv-btn-dark"><Home size={15} /> Home</Link>
          <button type="button" className="kv-btn kv-btn-soft" onClick={() => window.history.back()}><ArrowLeft size={15} /> Go back</button>
        </>
      }
    />
  )
}
