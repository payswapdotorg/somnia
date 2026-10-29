// tests/auth-ui.test.tsx — Somnia auth surface (T4a).
//
// jsdom component tests for the sign-in / sign-up screen: the form must
// speak the exact /api/auth/* contract (endpoints, JSON payloads, cookie
// session flow) and surface server error states honestly.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AuthApp } from '@/components/somnia/auth-app'

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response
}

const USER = {
  id: 'u_123',
  email: 'maker@somnia.test',
  name: 'Maker',
  avatarSeed: 'aurora',
  plan: 'trial',
  credits: 1000,
  createdAt: '2026-10-29T00:00:00.000Z',
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'unauthorized' })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function field(label: RegExp): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

describe('AuthApp', () => {
  it('signs up: POST /api/auth/signup with email, password and name', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/auth/signup') {
        expect(init?.method).toBe('POST')
        expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
        expect(JSON.parse(String(init?.body))).toEqual({
          email: 'maker@somnia.test',
          password: 'password123',
          name: 'Maker',
        })
        return jsonResponse(201, { user: USER })
      }
      return jsonResponse(401, { error: 'unauthorized' })
    })
    const onAuthenticated = vi.fn()
    render(<AuthApp onAuthenticated={onAuthenticated} />)

    // starts in sign-in mode; switch to sign-up
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    expect(screen.getByText(/create your account/i)).toBeInTheDocument()

    fireEvent.change(field(/email/i), { target: { value: 'maker@somnia.test' } })
    fireEvent.change(field(/password/i), { target: { value: 'password123' } })
    fireEvent.change(field(/name/i), { target: { value: 'Maker' } })
    fireEvent.click(screen.getByRole('button', { name: /^create account$|^sign up$/i }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(USER))
  })

  it('signs in: POST /api/auth/login with email and password only', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/auth/login') {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({
          email: 'maker@somnia.test',
          password: 'password123',
        })
        return jsonResponse(200, { user: USER })
      }
      return jsonResponse(401, { error: 'unauthorized' })
    })
    const onAuthenticated = vi.fn()
    render(<AuthApp onAuthenticated={onAuthenticated} />)

    expect(screen.getByText(/welcome back/i)).toBeInTheDocument()
    fireEvent.change(field(/email/i), { target: { value: 'maker@somnia.test' } })
    fireEvent.change(field(/password/i), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(USER))
  })

  it('surfaces server errors (409 email taken) without calling onAuthenticated', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input) === '/api/auth/signup'
        ? jsonResponse(409, { error: 'email_taken', message: 'account already exists for this email' })
        : jsonResponse(401, { error: 'unauthorized' })
    )
    const onAuthenticated = vi.fn()
    render(<AuthApp onAuthenticated={onAuthenticated} />)

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(field(/email/i), { target: { value: 'taken@somnia.test' } })
    fireEvent.change(field(/password/i), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /^create account$|^sign up$/i }))

    await waitFor(() =>
      expect(screen.getByText(/account already exists/i)).toBeInTheDocument()
    )
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('validates client-side before hitting the API', async () => {
    const onAuthenticated = vi.fn()
    render(<AuthApp onAuthenticated={onAuthenticated} />)

    fireEvent.change(field(/email/i), { target: { value: 'not-an-email' } })
    fireEvent.change(field(/password/i), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(screen.getByText(/valid email/i)).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledTimes(0)
    expect(onAuthenticated).not.toHaveBeenCalled()
  })
})
