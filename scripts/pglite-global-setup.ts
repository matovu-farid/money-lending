import { startServer, stopServer } from "./pglite-server"

export async function setup() {
  await startServer()
}

export async function teardown() {
  await stopServer()
}
