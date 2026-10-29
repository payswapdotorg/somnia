import {
  InsufficientCreditsError,
  InvalidRequestError,
  ModerationRefusalError,
} from '@/lib/jobs'
import { TransformRenderError } from '@/lib/transforms'
import { NextResponse } from 'next/server'

/** Map domain errors from the job/transform services onto clean HTTP responses. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ModerationRefusalError) {
    return NextResponse.json(
      { error: 'moderation_refused', message: error.message },
      { status: 400 }
    )
  }
  if (error instanceof InvalidRequestError) {
    return NextResponse.json({ error: 'invalid_request', message: error.message }, { status: 400 })
  }
  if (error instanceof InsufficientCreditsError) {
    return NextResponse.json(
      {
        error: 'insufficient_credits',
        message: error.message,
        required: error.required,
        balance: error.balance,
      },
      { status: 402 }
    )
  }
  // Phase 3: a transform whose ffmpeg render failed — nothing was charged.
  if (error instanceof TransformRenderError) {
    return NextResponse.json({ error: 'render_failed', message: error.message }, { status: 500 })
  }
  console.error('[api] unexpected error:', error)
  return NextResponse.json(
    { error: 'internal_error', message: 'Something went wrong on our side. Please try again.' },
    { status: 500 }
  )
}
