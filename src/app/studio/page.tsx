import type { Metadata } from 'next'
import { StudioApp } from '@/components/reelforge/studio-app'

export const metadata: Metadata = {
  title: 'Studio — Reelforge',
  description:
    'The Reelforge studio workspace: compose a shot, watch it forge, remix history, browse the gallery, and read the economics.',
}

export default function StudioPage() {
  return <StudioApp />
}
