import { MODERATION_REFUSAL_MESSAGE } from '@/lib/moderation'

/**
 * Shared domain errors for the job/image/agent services. All API handlers
 * map these onto HTTP responses via @/lib/api#errorResponse (instanceof
 * checks) — services must reuse THESE classes, never redeclare them.
 */

export class ModerationRefusalError extends Error {
  constructor() {
    super(MODERATION_REFUSAL_MESSAGE)
    this.name = 'ModerationRefusalError'
  }
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRequestError'
  }
}

export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public balance: number
  ) {
    super(
      `Not enough credits: this render needs ${required} but only ${balance} are available.`
    )
    this.name = 'InsufficientCreditsError'
  }
}
