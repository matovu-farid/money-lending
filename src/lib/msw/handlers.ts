import { http, HttpResponse } from 'msw'
import type { RequestHandler } from 'msw'

// Add mock API handlers here for tests
export const handlers: RequestHandler[] = []

export { http, HttpResponse }
