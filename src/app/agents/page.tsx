import type { Metadata } from 'next'
import { AgentsScreen } from '@/components/somnia/screens'
import { BRAND } from '@/lib/brand'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `${BRAND.name} — Agents`,
  description: 'Describe a goal; the agent plans the shots and dispatches the variations.',
  robots: { index: false }, // an in-app tool surface, not marketing
}

export default function AgentsPage() {
  return <AgentsScreen />
}
