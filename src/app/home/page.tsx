import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  CalendarCheck2,
  ChartNoAxesCombined,
  UsersRound,
} from "lucide-react"

import { Logo } from "@/components/brand/logo"
import { DashboardPreview } from "./dashboard-preview"
import "./home.css"

export const metadata: Metadata = {
  title: "Lending, with clarity",
  description: "A clear, connected workspace for growing money-lending operations.",
}

const capabilities = [
  {
    icon: ChartNoAxesCombined,
    title: "Portfolio visibility",
    description: "Review outstanding balances and spot overdue loans before following up.",
  },
  {
    icon: CalendarCheck2,
    title: "Daily collections",
    description: "Record repayments and review the amounts collected each day.",
  },
  {
    icon: UsersRound,
    title: "Customer context",
    description: "Open customer details and loan history before the next conversation.",
  },
]

const workflow = [
  { title: "Record the loan", description: "Bring the customer, agreement, and loan terms into the same record." },
  { title: "Record each repayment", description: "Keep a payment history as collections come in." },
  { title: "Review the position", description: "Check outstanding balances and customer history before the next decision." },
]

export default function HomePage() {
  return (
    <div className="home-page">
      <a className="home-skip-link" href="#main-content">Skip to content</a>
      <header className="home-masthead">
        <div className="home-shell home-nav">
          <Link href="/home" aria-label="Kaks Credit home"><Logo size={30} /></Link>
          <nav className="home-nav-actions" aria-label="Public navigation">
            <div className="home-nav-sections">
              <a href="#workspace">The workspace</a>
              <a href="#workflow">How it works</a>
            </div>
            <Link className="home-nav-sign-in" href="/login">Sign in</Link>
            <Link className="home-button home-button-primary" href="/request-access">Request access <ArrowRight size={16} aria-hidden="true" /></Link>
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="home-masthead" aria-labelledby="home-hero-title">
          <div className="home-shell home-hero">
            <div className="home-hero-content">
              <h1 id="home-hero-title"><span>Every loan.</span><span>Every payment.</span><em>One clear view.</em></h1>
              <p className="home-hero-copy"><strong>For lending teams.</strong> Bring your loan balances, repayments, and customer history together in one focused workspace.</p>
              <div className="home-hero-actions">
                <Link className="home-button home-button-primary home-pill-ink" href="/request-access">Request access <ArrowRight size={17} aria-hidden="true" /></Link>
                <a className="home-text-link" href="#workspace">Explore the workspace <ArrowRight size={17} aria-hidden="true" /></a>
                <p className="home-hero-note"><span>Already have access?</span> <Link href="/login">Sign in</Link></p>
              </div>
            </div>
            <div className="home-preview-wrap">
              <DashboardPreview />
            </div>
          </div>
        </section>

        <section id="capabilities" className="home-section home-capabilities" aria-labelledby="home-capabilities-title">
          <div className="home-shell home-capabilities-layout">
            <div className="home-section-heading">
              <h2 id="home-capabilities-title">Know what’s due.<br />Know where you stand.</h2>
              <p className="home-section-intro">From the first loan record to the latest repayment, keep the details your team needs close at hand.</p>
              <a className="home-text-link" href="#workflow">Follow the daily workflow <ArrowRight size={17} aria-hidden="true" /></a>
            </div>
            <div className="home-capability-list">
              {capabilities.map(({ icon: Icon, title, description }) => (
                <article className="home-capability" key={title}>
                  <Icon size={23} strokeWidth={1.5} aria-hidden="true" />
                  <div><h3>{title}</h3><p>{description}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <div className="home-workflow-band">
          <section id="workflow" className="home-shell home-section home-workflow" aria-labelledby="home-workflow-title">
            <div className="home-workflow-heading">
              <h2 id="home-workflow-title">A clear record,<br />from loan to repayment.</h2>
              <p className="home-section-intro">Three connected steps keep your team working from the same picture.</p>
            </div>
            <ol className="home-workflow-list">
              {workflow.map(({ title, description }, index) => (
                <li className="home-workflow-item" key={title}>
                  <div className="home-workflow-step"><span className="home-workflow-number">0{index + 1}</span>{index < workflow.length - 1 && <ArrowRight size={20} aria-hidden="true" />}</div>
                  <h3>{title}</h3><p>{description}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section className="home-cta-band" aria-labelledby="home-cta-title">
          <div className="home-shell home-cta">
            <div>
              <h2 id="home-cta-title">Bring your loans and collections together.</h2>
              <p>Tell us about your team and leave an email address or phone number. We’ll get in touch using the contact details you provide.</p>
            </div>
            <Link className="home-button home-button-inverse" href="/request-access">Request access <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>

      <footer className="home-shell home-footer">
        <div><Logo size={24} /><p>© 2026 Kaks Credit. Lending, with clarity.</p></div>
        <p>Already have an account? <Link href="/login">Sign in <ArrowRight size={14} aria-hidden="true" /></Link></p>
      </footer>
    </div>
  )
}
