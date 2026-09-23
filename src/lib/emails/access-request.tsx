import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components"

type AccessRequestTemplateProps = {
  name: string
  email?: string
  phone?: string
  organization?: string
  message?: string
  submittedAt: Date
}

export function AccessRequestTemplate({
  name,
  email,
  phone,
  organization,
  message,
  submittedAt,
}: AccessRequestTemplateProps) {
  const timestamp = submittedAt.toLocaleString("en-UG", {
    timeZone: process.env.BUSINESS_TIMEZONE || "Africa/Kampala",
    dateStyle: "full",
    timeStyle: "short",
  })

  return (
    <Html>
      <Head />
      <Preview>New request for access from {name}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={headerText}>Kaks Credit</Text>
          </Section>
          <Section style={content}>
            <Heading style={heading}>New request for access</Heading>
            <Text style={subheading}>
              A prospective customer would like to learn more about Kaks Credit.
            </Text>

            <Section style={dataCard}>
              <Text style={label}>Full name</Text>
              <Text style={value}>{name}</Text>
              {email && (
                <>
                  <Text style={label}>Email</Text>
                  <Text style={value}>{email}</Text>
                </>
              )}
              {phone && (
                <>
                  <Text style={label}>Phone / WhatsApp</Text>
                  <Text style={value}>{phone}</Text>
                </>
              )}
              {organization && (
                <>
                  <Text style={label}>Business or organization</Text>
                  <Text style={value}>{organization}</Text>
                </>
              )}
              {message && (
                <>
                  <Text style={label}>Message</Text>
                  <Text style={value}>{message}</Text>
                </>
              )}
              <Text style={label}>Submitted</Text>
              <Text style={value}>{timestamp}</Text>
            </Section>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            This is an automated lead notification from Kaks Credit.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default AccessRequestTemplate

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
  textAlign: "center",
}

const headerText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: "700",
  margin: "0",
}

const content: React.CSSProperties = {
  backgroundColor: "#ffffff",
  padding: "32px",
}

const heading: React.CSSProperties = {
  color: "#1e293b",
  fontSize: "24px",
  fontWeight: "700",
  margin: "0 0 8px",
}

const subheading: React.CSSProperties = {
  color: "#64748b",
  fontSize: "14px",
  margin: "0 0 24px",
}

const dataCard: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  padding: "16px",
}

const label: React.CSSProperties = {
  color: "#64748b",
  fontSize: "12px",
  fontWeight: "600",
  margin: "0 0 4px",
  textTransform: "uppercase",
}

const value: React.CSSProperties = {
  color: "#1e293b",
  fontSize: "15px",
  margin: "0 0 16px",
  whiteSpace: "pre-wrap",
}

const hr: React.CSSProperties = {
  borderColor: "#e2e8f0",
  margin: "0",
}

const footer: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "12px",
  margin: "16px 0 0",
  textAlign: "center",
}
