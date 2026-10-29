import type { Metadata } from 'next'
import { HistoryApp } from '@/components/reelforge/history-app'

export const metadata: Metadata = {
  title: 'History — My Forges',
  description:
    'Everything this Reelforge studio has forged — clips, stills and edits with their recipes. Remix any entry to reload its settings in the composer.',
}

export default function HistoryPage() {
  return <HistoryApp />
}
