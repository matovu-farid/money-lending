module.exports={
  allowCypressEnv:false,video:false,screenshotOnRunFailure:false,trashAssetsBeforeRuns:false,
  defaultCommandTimeout:30000,
  e2e:{baseUrl:'http://127.0.0.1:3483',supportFile:false,specPattern:'scripts/local-demo/demo.cy.cjs',testIsolation:false},
};
