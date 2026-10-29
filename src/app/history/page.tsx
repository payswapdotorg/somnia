import type { Metadata } from 'next'
import { HistoryScreen } from '@/components/somnia/screens'

export const metadata: Metadata = {
  title: 'History — My Dreams',
  description:
    'Everything you have dreamed in Somnia — clips, stills and edits with their recipes. Extend, modify, reframe, upscale, share unlisted or remix.',
}

export default function HistoryPage() {
  return <HistoryScreen />
}
