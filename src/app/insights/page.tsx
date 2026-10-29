import type { Metadata } from 'next'
import { InsightsScreen } from '@/components/somnia/screens'

export const metadata: Metadata = {
  title: 'Insights — Somnia',
  description:
    'Your usage and the margin lens — job totals, credit ledger, revenue, provider cost and gross margin in one honest snapshot.',
}

export default function InsightsPage() {
  return <InsightsScreen />
}
