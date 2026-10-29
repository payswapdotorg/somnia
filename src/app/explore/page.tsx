import type { Metadata } from 'next'
import { ExploreScreen } from '@/components/somnia/screens'

export const metadata: Metadata = {
  title: 'Explore — Somnia Ideas Feed',
  description:
    'Shared dreams from the Somnia community — hover to play, like what moves you, remix anything into your own recipe.',
}

export default function ExplorePage() {
  return <ExploreScreen />
}
