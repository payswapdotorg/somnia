import type { Metadata } from 'next'
import { PlansScreen } from '@/components/somnia/screens'

export const metadata: Metadata = {
  title: 'Plans — Somnia',
  description:
    'The Somnia credit ladder: Trial, Spark, Studio and Infinite. Every render charges the same credits whatever plan you are on — plans change how much dreaming you can afford.',
}

export default function PlansPage() {
  return <PlansScreen />
}
