# Request Access Lead Form Design

## Goal

Replace the public landing page's account-registration CTA with a lightweight request-access lead form. The form collects enough information for a personal follow-up without asking a potential customer to create an account or choose a password.

## User experience

- Every public “Request access” link navigates to `/request-access`.
- The form requires a full name and at least one contact method: email or phone/WhatsApp number.
- Business/organization and a short message are optional.
- The form does not collect a password, call Better Auth, create a user, or send the visitor to `/register`.
- A successful submission displays a confirmation state explaining that someone will follow up.
- Invalid submissions remain on the form and explain that email or phone/WhatsApp is required.

## Architecture and data flow

The new page lives under the existing `(auth)` route group so it inherits the public authentication layout. Its client form invokes a colocated server action. The action trims and validates the fields, then calls a server-only email helper. The helper sends a React Email template through the existing Resend client to `process.env.REQUEST_ACCESS_EMAIL`.

`REQUEST_ACCESS_EMAIL` is the stable, purpose-specific environment variable. It is set to `matovu90@gmail.com` in the local `.env` file and in the Vercel production environment. It is never exposed to client code. The email includes the submitted name, available contact methods, optional business/organization, optional message, and submission timestamp; it must not include a password because none is collected.

## Error handling

- Server-side validation is authoritative even if the client-side form is bypassed.
- Missing or malformed contact data returns a field-level/action error without sending email.
- Missing recipient configuration or a Resend failure returns a generic submission error and logs the technical failure server-side without leaking secrets to the visitor.
- Successful email delivery returns success and clears/replaces the form with the confirmation state.

## Testing

- Unit tests cover the server action's required-name and at-least-one-contact validation, normalization, success path, and email failure path.
- Component tests cover rendering, optional fields, client validation, submission success, and error display.
- Existing unit/type/lint checks are run after implementation. The public CTA destinations are verified by source-level assertions or the relevant page test.

## Scope boundaries

This change does not alter the existing `/register` flow, user roles, Better Auth, database schema, or admin notification behavior. It adds only the public lead-capture path and its notification email.
