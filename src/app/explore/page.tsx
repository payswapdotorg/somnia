import type { Metadata } from 'next'
import { ExploreApp } from '@/components/reelforge/explore-app'

export const metadata: Metadata = {
  title: 'Explore — Reelforge Community Gallery',
  description:
    'Clips and stills forged inside Reelforge. Hover to play, remix to load the exact recipe into the composer and make it yours.',
}

export default function ExplorePage() {
  return <ExploreApp />
}
