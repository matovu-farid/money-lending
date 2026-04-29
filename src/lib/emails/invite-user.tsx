import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components"

type InviteUserProps = {
  url: string
  inviterName: string
  role: string
  inviteeName: string
}

const ROLE_LABELS: Record<string, string> = {
  loanOfficer: "Loan Officer",
  supervisor: "Supervisor",
  admin: "Admin",
  superAdmin: "Super Admin",
}

export function InviteUserTemplate({ url, inviterName, role, inviteeName }: InviteUserProps) {
  const roleLabel = ROLE_LABELS[role] ?? role

  return (
    <Html>
      <Head />
      <Preview>{inviterName} invited you to join Kaks Credit</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={headerText}>Kaks Credit</Text>
          </Section>
          <Section style={content}>
            <Heading style={heading}>You&apos;re invited!</Heading>
            <Text style={paragraph}>
              Hi {inviteeName}, {inviterName} has invited you to join Kaks Credit
              as a <strong>{roleLabel}</strong>.
            </Text>
            <Text style={paragraph}>
              Click the button below to set your password and get started.
            </Text>
            <Section style={buttonSection}>
              <Button style={button} href={url}>
                Join Now
              </Button>
            </Section>
            <Text style={smallText}>
              This invitation expires in 7 days.
            </Text>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            If you were not expecting this invitation, you can safely ignore this email.
          </Text>
          <Text style={copyright}>
            &copy; {new Date().getFullYear()} Kaks Credit
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default InviteUserTemplate

const body: React.CSSProperties = {
  backgroundColor: "#f4f4f7",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  margin: "0",
  padding: "0",
}

const container: React.CSSProperties = {
  maxWidth: "560px",
  margin: "0 auto",
  padding: "20px 0 48px",
}

const header: React.CSSProperties = {
  backgroundColor: "#1e293b",
  borderRadius: "8px 8px 0 0",
  padding: "24px 32px",
  textAlign: "center" as const,
}

const headerText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: "700",
  margin: "0",
  letterSpacing: "-0.3px",
}

const content: React.CSSProperties = {
  backgroundColor: "#ffffff",
  padding: "32px 32px 24px",
}

const heading: React.CSSProperties = {
  color: "#1e293b",
  fontSize: "24px",
  fontWeight: "700",
  margin: "0 0 16px",
  letterSpacing: "-0.3px",
}

const paragraph: React.CSSProperties = {
  color: "#475569",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 24px",
}

const buttonSection: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "0 0 24px",
}

const button: React.CSSProperties = {
  backgroundColor: "#4f46e5",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: "600",
  lineHeight: "1",
  padding: "14px 32px",
  textDecoration: "none",
  textAlign: "center" as const,
}

const smallText: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "12px",
  lineHeight: "20px",
  margin: "0",
}

const hr: React.CSSProperties = {
  borderColor: "#e2e8f0",
  margin: "0",
}

const footer: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "12px",
  lineHeight: "20px",
  textAlign: "center" as const,
  padding: "16px 32px 0",
}

const copyright: React.CSSProperties = {
  color: "#cbd5e1",
  fontSize: "11px",
  textAlign: "center" as const,
  padding: "8px 32px 0",
}
