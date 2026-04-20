import { useState } from 'react'
import { Stethoscope } from 'lucide-react'

export function ArgusLogo({ size = 28 }: { size?: number }) {
  const [err, setErr] = useState(false)
  if (err) return <Stethoscope style={{ width: size, height: size }} className="text-brand-500" />
  return <img src="/argus-logo.svg" alt="ARGUS" style={{ width: size, height: size }} className="object-contain" onError={() => setErr(true)} />
}
