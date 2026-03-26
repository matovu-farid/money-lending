import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// Usage in tests:
//   beforeAll(() => server.listen())
//   afterEach(() => server.resetHandlers())
//   afterAll(() => server.close())
export const server = setupServer(...handlers)
