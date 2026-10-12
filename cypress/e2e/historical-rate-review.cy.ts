describe("Historical rate repair review", () => {
  it("does not expose the review screen to an unsigned visitor", () => {
    cy.clearCookies();
    cy.visit("/admin/historical-rate-repair?loanId=10b5f8b9-42eb-44bd-aac3-d9d6e6657022&asOf=2026-10-10T15%3A44%3A00.000Z", {
      failOnStatusCode: false,
    });
    cy.contains("Approve exact correction").should("not.exist");
  });

  it("requires an exact loan, date, and hash and never offers human approval", () => {
    cy.task("db:reset");
    cy.createTestUser({ name: "Repair Admin", role: "superAdmin" });
    cy.visit("/admin/historical-rate-repair");
    cy.contains("Exact reviewed plan required").should("be.visible");
    cy.contains("Approve exact correction").should("not.exist");
  });
});
