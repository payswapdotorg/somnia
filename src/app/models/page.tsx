import type { Metadata } from 'next'
import { ModelsApp } from '@/components/reelforge/models-app'

export const metadata: Metadata = {
  title: 'Models — Reelforge Engine Catalogue',
  description:
    'The Reelforge engine lineup: video and image engines, the Forge Agent and flat-credit editing tools — real credit rates, live in this build.',
}

export default function ModelsPage() {
  return <ModelsApp />
}
