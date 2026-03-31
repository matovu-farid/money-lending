import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components"

type AdminNotificationProps = {
  eventLabel: string
  actorName: string
  actorEmail: string
  loanRef: string
  amount: string
  formattedTimestamp: string
}

export function AdminNotificationTemplate({
  eventLabel,
  actorName,
  actorEmail,
  loanRef,
  amount,
  formattedTimestamp,
}: AdminNotificationProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {eventLabel} — {loanRef} — UGX {amount}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={headerText}>Lending Manager</Text>
          </Section>
          <Section style={content}>
            <Heading style={heading}>{eventLabel}</Heading>
            <Text style={subheading}>
              A transaction event was recorded in the system.
            </Text>

            <Section style={dataCard}>
              <Row style={dataRow}>
                <Column style={labelCol}>Event</Column>
                <Column style={valueCol}>{eventLabel}</Column>
              </Row>
              <Row style={dataRowAlt}>
                <Column style={labelCol}>Actor</Column>
                <Column style={valueCol}>
                  {actorName} ({actorEmail})
                </Column>
              </Row>
              <Row style={dataRow}>
                <Column style={labelCol}>Loan Ref</Column>
                <Column style={valueColMono}>{loanRef}</Column>
              </Row>
              <Row style={dataRowAlt}>
                <Column style={labelCol}>Amount</Column>
                <Column style={valueColAmount}>UGX {amount}</Column>
              </Row>
              <Row style={dataRow}>
                <Column style={labelCol}>Timestamp</Column>
                <Column style={valueCol}>{formattedTimestamp}</Column>
              </Row>
            </Section>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            This is an automated notification from the lending system.
          </Text>
          <Text style={copyright}>
            &copy; {new Date().getFullYear()} Lending Manager
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default AdminNotificationTemplate

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
  margin: "0 0 8px",
  letterSpacing: "-0.3px",
}

const subheading: React.CSSProperties = {
  color: "#64748b",
  fontSize: "14px",
  margin: "0 0 24px",
}

const dataCard: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  overflow: "hidden",
}

const dataRow: React.CSSProperties = {
  backgroundColor: "#ffffff",
}

const dataRowAlt: React.CSSProperties = {
  backgroundColor: "#f8fafc",
}

const labelCol: React.CSSProperties = {
  color: "#64748b",
  fontSize: "13px",
  fontWeight: "600",
  padding: "12px 16px",
  width: "120px",
  verticalAlign: "top",
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
}

const valueCol: React.CSSProperties = {
  color: "#1e293b",
  fontSize: "14px",
  padding: "12px 16px",
}

const valueColMono: React.CSSProperties = {
  ...valueCol,
  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
  color: "#4f46e5",
  fontWeight: "600",
}

const valueColAmount: React.CSSProperties = {
  ...valueCol,
  fontWeight: "700",
  color: "#1e293b",
  fontSize: "15px",
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
