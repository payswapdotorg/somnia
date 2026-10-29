import type { Metadata } from 'next'
import { KeysScreen } from '@/components/somnia/screens'

export const metadata: Metadata = {
  title: 'API Keys — Somnia',
  description:
    'Mint sk_somnia API keys to drive Somnia from your own scripts — hashed at rest, plaintext shown once, revocable any time.',
}

export default function KeysPage() {
  return <KeysScreen />
}
