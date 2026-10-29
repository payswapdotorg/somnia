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
  },
  twitter: { card: 'summary_large_image' },
}

export default function CreatePage() {
  return <CreateScreen />
}
