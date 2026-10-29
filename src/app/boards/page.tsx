import type { Metadata } from 'next'
import { BoardsScreen } from '@/components/somnia/screens'

export const metadata: Metadata = {
  title: 'Boards — Somnia',
  description:
    'File finished dreams into boards and share a whole board with one unlisted link. Deleting a board never deletes the dreams.',
}

export default function BoardsPage() {
  return <BoardsScreen />
}
