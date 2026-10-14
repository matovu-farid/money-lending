import { defineConfig } from "cypress"

// Public-page checks need no database tasks, credentials, or test auth bypass.
export default defineConfig({
  allowCypressEnv: false,
  video: false,
  e2e: {
    baseUrl: "http://127.0.0.1:3483",
    supportFile: false,
    specPattern: "cypress/e2e/homepage-design.cy.ts",
    setupNodeEvents(on) {
      on("before:browser:launch", (browser, launchOptions) => {
        if (browser.name === "electron") {
          launchOptions.preferences.width = 1600
          launchOptions.preferences.height = 1100
        }
        return launchOptions
      })
    },
  },
})
