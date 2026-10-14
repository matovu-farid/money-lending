describe('Sanitized local demo: existing records only',()=>{
  before(()=>{
    cy.env(['demoEmail','demoPassword']).then(({demoEmail,demoPassword})=>cy.request({method:'POST',url:'/api/auth/sign-in/email',body:{email:demoEmail,password:demoPassword},log:false}).its('status').should('eq',200));
  });
  for(const [route,heading] of [['/dashboard','Dashboard'],['/customers','Customers'],['/loans','Loans'],['/payments','Payments'],['/approvals','Approvals'],['/expenses','Expenses'],['/fund-transfers','Fund Transfers'],['/creditors','Creditors'],['/reports','Reports'],['/activities','Activity'],['/admin','Admin']]){
    it('renders '+route+' without changing business records',()=>{
      cy.visit(route);
      cy.get('h1',{timeout:30000}).should('contain.text',heading);
      cy.location('pathname').should('eq',route);
      cy.contains('Demo Administrator',{timeout:30000}).should('be.visible');
      cy.get('body').should('not.contain.text','Application error');
      if(route==='/customers')cy.get('[data-testid="data-row"]',{timeout:30000}).should('have.length.greaterThan',0);
      if(route==='/loans')cy.get('[data-testid="data-row"]',{timeout:30000}).should('have.length.greaterThan',0);
    });
  }
  it('opens an existing customer and loan for richer demo footage',()=>{
    cy.visit('/customers');
    cy.get('[data-testid="data-row"]',{timeout:30000}).first().click();
    cy.location('pathname').should('match',/^\/customers\/[0-9a-f-]+$/);
    cy.contains('Customer profile',{timeout:30000}).should('be.visible');
    cy.contains('button','Basic Information').click();
    cy.contains('DEMO',{timeout:30000}).should('be.visible');
    cy.contains('Demo District').should('be.visible');
    cy.visit('/loans');
    cy.get('[data-testid="data-row"]',{timeout:30000}).first().click();
    cy.location('pathname').should('match',/^\/loans\/[0-9a-f-]+$/);
    cy.get('body').should('contain.text','UGX').and('not.contain.text','Application error');
  });
});
