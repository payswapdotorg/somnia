import type { Metadata } from 'next'
import { CreateScreen } from '@/components/somnia/screens'
import { BRAND } from '@/lib/brand'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `${BRAND.name} — What will you dream today?`,
  description: BRAND.description,
  keywords: [...BRAND.keywords],
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    title: `${BRAND.name} — What will you dream today?`,
    description: BRAND.description,
    // the branded night card — scripts/make-og-image.ts regenerates it
    images: [{ url: '/og.png', width: 1200, height: 630, alt: `${BRAND.name} — ${BRAND.tagline}` }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og.png'],
  },
}

export default function CreatePage() {
  return <CreateScreen />
}
