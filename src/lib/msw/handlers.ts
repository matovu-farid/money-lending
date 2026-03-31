import { http, HttpResponse } from 'msw'
import type { RequestHandler } from 'msw'

export const handlers: RequestHandler[] = []

export { http, HttpResponse }
