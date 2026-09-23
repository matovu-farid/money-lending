import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowUpRight,
  CalendarCheck2,
  ChartNoAxesCombined,
  Check,
  Sparkles,
  UsersRound,
} from "lucide-react"

import { Logo } from "@/components/brand/logo"

export const metadata: Metadata = {
  title: "Lending, with clarity",
  description: "A clear, connected workspace for growing money-lending operations.",
}

const pageStyles = `
  .home-page {
    --home-ink: var(--foreground);
    --home-ink-soft: var(--muted-foreground);
    --home-cream: var(--background);
    --home-paper: var(--card);
    --home-sage: var(--accent);
    --home-copper: #f59e0b;
    --home-copper-dark: #b45309;
    --home-line: var(--border);
    min-height: 100vh;
    overflow: hidden;
    background: var(--home-cream);
    color: var(--home-ink);
    font-family: var(--font-geist-sans), sans-serif;
  }

  .home-page *, .home-page *::before, .home-page *::after {
    box-sizing: border-box;
  }

  .home-page a {
    color: inherit;
    text-decoration: none;
  }

  .home-page a:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--home-copper) 55%, white);
    outline-offset: 4px;
  }

  .home-shell {
    width: min(1180px, calc(100% - 48px));
    margin: 0 auto;
  }

  .home-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 82px;
    border-bottom: 1px solid color-mix(in srgb, var(--home-line) 75%, transparent);
  }

  .home-nav-actions {
    display: flex;
    align-items: center;
    gap: 22px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .home-nav-sign-in {
    color: var(--home-ink-soft) !important;
    transition: color 160ms ease;
  }

  .home-nav-sign-in:hover { color: var(--home-ink) !important; }

  .home-pill {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 999px;
    padding: 0 18px;
    font-size: 0.86rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    transition: transform 160ms ease, background 160ms ease, box-shadow 160ms ease;
  }

  .home-pill:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 18px rgba(54, 45, 35, 0.12);
  }

  .home-pill-copper {
    background: var(--home-copper);
    color: white !important;
  }

  .home-pill-copper:hover { background: var(--home-copper-dark); }

  .home-pill-ink {
    background: var(--primary);
    color: var(--primary-foreground) !important;
    box-shadow: 0 12px 24px rgba(31, 45, 39, 0.14);
  }

  .home-pill-ink:hover { background: color-mix(in srgb, var(--primary) 86%, white); }

  .home-hero {
    display: grid;
    grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
    align-items: center;
    gap: clamp(42px, 7vw, 96px);
    padding: clamp(72px, 10vw, 128px) 0 116px;
  }

  .home-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 22px;
    color: var(--home-copper-dark);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .home-eyebrow-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--home-copper);
    box-shadow: 0 0 0 5px rgba(189, 110, 63, 0.12);
  }

  .home-hero h1 {
    max-width: 590px;
    margin: 0;
    color: var(--home-ink);
    font-size: clamp(3.3rem, 6.2vw, 6.25rem);
    font-weight: 700;
    letter-spacing: -0.075em;
    line-height: 0.94;
  }

  .home-hero h1 em {
    color: var(--home-copper);
    font-style: normal;
  }

  .home-hero-copy {
    max-width: 470px;
    margin: 27px 0 0;
    color: var(--home-ink-soft);
    font-size: 1.08rem;
    line-height: 1.7;
  }

  .home-hero-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    margin-top: 34px;
  }

  .home-hero-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 28px;
    color: var(--home-ink-soft);
    font-size: 0.78rem;
  }

  .home-hero-note svg { color: var(--home-copper); }

  .home-preview-wrap {
    position: relative;
    min-width: 0;
  }

  .home-preview-wrap::before {
    position: absolute;
    z-index: 0;
    top: -52px;
    right: -35px;
    width: 240px;
    height: 240px;
    border-radius: 50%;
    background: var(--accent);
    content: "";
    opacity: 0.7;
  }

  .home-preview-wrap::after {
    position: absolute;
    z-index: 0;
    bottom: -50px;
    left: -38px;
    width: 190px;
    height: 190px;
    border: 1px solid var(--home-line);
    border-radius: 50%;
    content: "";
  }

  .home-preview {
    position: relative;
    z-index: 1;
    overflow: hidden;
    border: 1px solid var(--home-line);
    border-radius: 24px;
    background: var(--home-paper);
    box-shadow: 0 28px 70px rgba(67, 57, 44, 0.16), 0 5px 12px rgba(67, 57, 44, 0.06);
    transform: rotate(1.5deg);
  }

  .home-preview-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--home-line);
    padding: 16px 20px;
    color: var(--home-ink-soft);
    font-size: 0.68rem;
  }

  .home-preview-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--home-ink);
    font-size: 0.76rem;
    font-weight: 800;
  }

  .home-preview-brand-mark {
    display: inline-flex;
    width: 22px;
    height: 22px;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: var(--primary);
    color: var(--primary-foreground);
    font-size: 0.62rem;
  }

  .home-preview-body { padding: 26px; }

  .home-preview-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
  }

  .home-preview-heading p, .home-preview-heading strong { margin: 0; }

  .home-preview-heading p {
    color: var(--home-ink-soft);
    font-size: 0.72rem;
  }

  .home-preview-heading strong {
    color: var(--home-ink);
    font-size: 1.25rem;
    letter-spacing: -0.04em;
  }

  .home-preview-trend {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 999px;
    background: var(--secondary);
    padding: 5px 8px;
    color: var(--home-ink);
    font-size: 0.67rem;
    font-weight: 700;
  }

  .home-chart {
    display: flex;
    height: 142px;
    align-items: end;
    gap: 10px;
    margin-top: 24px;
    border-bottom: 1px solid var(--home-line);
    padding: 0 5px 12px;
  }

  .home-chart-bar {
    flex: 1;
    min-width: 10px;
    border-radius: 6px 6px 2px 2px;
    background: var(--chart-2);
  }

  .home-chart-bar:nth-child(1) { height: 34%; }
  .home-chart-bar:nth-child(2) { height: 48%; }
  .home-chart-bar:nth-child(3) { height: 40%; }
  .home-chart-bar:nth-child(4) { height: 66%; }
  .home-chart-bar:nth-child(5) { height: 56%; }
  .home-chart-bar:nth-child(6) { height: 82%; background: var(--home-copper); }
  .home-chart-bar:nth-child(7) { height: 72%; background: var(--home-ink); }

  .home-preview-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 18px;
  }

  .home-preview-stat {
    min-width: 0;
    border-radius: 13px;
    background: var(--muted);
    padding: 12px;
  }

  .home-preview-stat:nth-child(2) { background: var(--secondary); }
  .home-preview-stat:nth-child(3) { background: color-mix(in srgb, var(--chart-4) 12%, var(--card)); }

  .home-preview-stat span, .home-preview-stat strong { display: block; }
  .home-preview-stat span { color: var(--home-ink-soft); font-size: 0.62rem; }
  .home-preview-stat strong { margin-top: 7px; color: var(--home-ink); font-size: 0.88rem; letter-spacing: -0.03em; }

  .home-section { padding: 102px 0; }

  .home-section-soft {
    background: var(--muted);
    box-shadow: 50vw 0 0 var(--muted), -50vw 0 0 var(--muted);
  }

  .home-section-heading { max-width: 580px; }

  .home-section-kicker {
    margin: 0 0 15px;
    color: var(--home-copper-dark);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .home-section h2 {
    margin: 0;
    color: var(--home-ink);
    font-size: clamp(2.1rem, 4vw, 3.7rem);
    font-weight: 700;
    letter-spacing: -0.06em;
    line-height: 1;
  }

  .home-section-intro {
    margin: 18px 0 0;
    color: var(--home-ink-soft);
    font-size: 1rem;
    line-height: 1.65;
  }

  .home-capability-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-top: 48px;
  }

  .home-capability-card {
    min-height: 260px;
    border: 1px solid var(--home-line);
    border-radius: 20px;
    background: var(--home-paper);
    padding: 26px;
    transition: transform 180ms ease, box-shadow 180ms ease;
  }

  .home-capability-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 18px 35px rgba(67, 57, 44, 0.1);
  }

  .home-capability-icon {
    display: inline-flex;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    border-radius: 13px;
    background: var(--home-sage);
    color: var(--home-ink);
  }

  .home-capability-card:nth-child(2) .home-capability-icon { background: color-mix(in srgb, var(--home-copper) 15%, var(--card)); color: var(--home-copper-dark); }
  .home-capability-card:nth-child(3) .home-capability-icon { background: var(--secondary); color: var(--ring); }

  .home-capability-card h3 {
    margin: 30px 0 10px;
    color: var(--home-ink);
    font-size: 1.15rem;
    letter-spacing: -0.035em;
  }

  .home-capability-card p {
    margin: 0;
    color: var(--home-ink-soft);
    font-size: 0.9rem;
    line-height: 1.65;
  }

  .home-workflow {
    display: grid;
    grid-template-columns: 0.72fr 1.28fr;
    gap: clamp(48px, 10vw, 140px);
    align-items: start;
  }

  .home-workflow-list { display: grid; gap: 0; }

  .home-workflow-item {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 20px;
    position: relative;
    padding: 0 0 38px;
  }

  .home-workflow-item:not(:last-child)::after {
    position: absolute;
    top: 47px;
    bottom: 12px;
    left: 27px;
    border-left: 1px dashed var(--home-line);
    content: "";
  }

  .home-workflow-number {
    position: relative;
    z-index: 1;
    display: inline-flex;
    width: 56px;
    height: 56px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--home-line);
    border-radius: 50%;
    background: var(--home-cream);
    color: var(--home-copper-dark);
    font-family: var(--font-geist-mono), monospace;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .home-workflow-item h3 { margin: 3px 0 8px; font-size: 1.18rem; letter-spacing: -0.035em; }
  .home-workflow-item p { margin: 0; color: var(--home-ink-soft); font-size: 0.92rem; line-height: 1.65; }

  .home-cta {
    position: relative;
    overflow: hidden;
    border-radius: 26px;
    background: var(--primary);
    padding: clamp(42px, 7vw, 78px);
    color: var(--primary-foreground);
  }

  .home-cta::after {
    position: absolute;
    right: -110px;
    bottom: -150px;
    width: 390px;
    height: 390px;
    border: 1px solid rgba(255,255,255,.14);
    border-radius: 50%;
    box-shadow: 0 0 0 45px rgba(255,255,255,.035), 0 0 0 90px rgba(255,255,255,.025);
    content: "";
  }

  .home-cta-content { position: relative; z-index: 1; max-width: 625px; }
  .home-cta .home-section-kicker { color: var(--home-copper); }
  .home-cta h2 { color: var(--primary-foreground); }
  .home-cta p { max-width: 510px; color: color-mix(in srgb, var(--primary-foreground) 76%, transparent); }
  .home-cta .home-pill-copper { margin-top: 30px; }

  .home-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 42px 0;
    color: var(--home-ink-soft);
    font-size: 0.76rem;
  }

  .home-footer p { margin: 0; }
  .home-footer a { color: var(--home-ink-soft); font-weight: 700; }

  @media (max-width: 900px) {
    .home-hero { grid-template-columns: 1fr; gap: 62px; }
    .home-hero h1 { max-width: 680px; }
    .home-preview-wrap { max-width: 680px; }
    .home-workflow { grid-template-columns: 1fr; gap: 54px; }
  }

  @media (max-width: 760px) {
    .home-shell { width: min(100% - 32px, 590px); }
    .home-nav { min-height: 72px; }
    .home-nav-actions { gap: 12px; font-size: 0.82rem; }
    .home-nav .home-pill { padding: 0 13px; }
    .home-hero { padding: 62px 0 80px; }
    .home-hero h1 { font-size: clamp(3rem, 14vw, 5rem); }
    .home-hero-copy { font-size: 1rem; }
    .home-preview-body { padding: 18px; }
    .home-preview-wrap::before { top: -25px; right: -50px; width: 150px; height: 150px; }
    .home-preview-wrap::after { bottom: -35px; left: -55px; width: 130px; height: 130px; }
    .home-section { padding: 76px 0; }
    .home-capability-grid { grid-template-columns: 1fr; margin-top: 32px; }
    .home-capability-card { min-height: 0; }
    .home-workflow { gap: 38px; }
    .home-footer { align-items: flex-start; flex-direction: column; padding: 32px 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .home-page *, .home-page *::before, .home-page *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
    .home-preview { transform: none; }
  }
`

export default function HomePage() {
  return (
    <div className="home-page">
      <style>{pageStyles}</style>

      <header className="home-shell home-nav">
        <Link href="/home" aria-label="Kaks Credit home">
          <Logo size={30} />
        </Link>
        <nav className="home-nav-actions" aria-label="Public navigation">
          <Link className="home-nav-sign-in" href="/login">Sign in</Link>
          <Link className="home-pill home-pill-copper" href="/request-access">Request access <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </nav>
      </header>

      <main>
        <section className="home-shell home-hero" aria-labelledby="home-hero-title">
          <div>
            <p className="home-eyebrow"><span className="home-eyebrow-dot" aria-hidden="true" /> Lending, with clarity</p>
            <h1 id="home-hero-title">Make every shilling move <em>with purpose.</em></h1>
            <p className="home-hero-copy">A clear, connected workspace for loans, repayments, customers, and the daily decisions that keep your lending business moving forward.</p>
            <div className="home-hero-actions">
              <Link className="home-pill home-pill-ink" href="/login">Sign in to your workspace <ArrowUpRight size={16} aria-hidden="true" /></Link>
              <Link className="home-pill" href="/request-access" style={{ border: "1px solid var(--home-line)", color: "var(--home-ink-soft)" }}>Request access</Link>
            </div>
            <p className="home-hero-note"><Check size={14} strokeWidth={2.5} aria-hidden="true" /> Built for disciplined, growing lending teams</p>
          </div>

          <div className="home-preview-wrap" aria-hidden="true">
            <div className="home-preview">
              <div className="home-preview-topbar">
                <span className="home-preview-brand"><span className="home-preview-brand-mark">K</span> Kaks Credit</span>
                <span>Overview&nbsp;&nbsp; Collections&nbsp;&nbsp; Reports</span>
              </div>
              <div className="home-preview-body">
                <div className="home-preview-heading">
                  <div><p>Portfolio health</p><strong>Moving in the right direction</strong></div>
                  <span className="home-preview-trend"><Sparkles size={12} aria-hidden="true" /> On track</span>
                </div>
                <div className="home-chart" aria-hidden="true">
                  <span className="home-chart-bar" /><span className="home-chart-bar" /><span className="home-chart-bar" /><span className="home-chart-bar" /><span className="home-chart-bar" /><span className="home-chart-bar" /><span className="home-chart-bar" />
                </div>
                <div className="home-preview-stats">
                  <div className="home-preview-stat"><span>Active loans</span><strong>In view</strong></div>
                  <div className="home-preview-stat"><span>Collections</span><strong>On track</strong></div>
                  <div className="home-preview-stat"><span>Customers</span><strong>Connected</strong></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="home-section home-section-soft" aria-labelledby="home-capabilities-title">
          <div className="home-shell">
            <div className="home-section-heading">
              <p className="home-section-kicker">Everything in one view</p>
              <h2 id="home-capabilities-title">The details matter. So does the bigger picture.</h2>
              <p className="home-section-intro">Kaks Credit brings the work around every loan into focus, so your team can spend less time searching and more time moving with confidence.</p>
            </div>
            <div className="home-capability-grid">
              <article className="home-capability-card">
                <span className="home-capability-icon"><ChartNoAxesCombined size={21} aria-hidden="true" /></span>
                <h3>Portfolio visibility</h3>
                <p>Understand what is active, what is due, and where your attention will make the biggest difference.</p>
              </article>
              <article className="home-capability-card">
                <span className="home-capability-icon"><CalendarCheck2 size={21} aria-hidden="true" /></span>
                <h3>Daily collections</h3>
                <p>Keep a reliable rhythm from first payment to final settlement with a record your team can trust.</p>
              </article>
              <article className="home-capability-card">
                <span className="home-capability-icon"><UsersRound size={21} aria-hidden="true" /></span>
                <h3>Customer context</h3>
                <p>See each customer’s story alongside the numbers, without losing the detail that makes decisions human.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="home-shell home-section" aria-labelledby="home-workflow-title">
          <div className="home-workflow">
            <div className="home-section-heading">
              <p className="home-section-kicker">A better daily rhythm</p>
              <h2 id="home-workflow-title">Good lending is a practice.</h2>
              <p className="home-section-intro">A focused flow keeps the operation steady, visible, and ready for the next decision.</p>
            </div>
            <div className="home-workflow-list">
              <div className="home-workflow-item"><span className="home-workflow-number">01</span><div><h3>Record the loan</h3><p>Start with a complete picture of the agreement, the customer, and the capital behind it.</p></div></div>
              <div className="home-workflow-item"><span className="home-workflow-number">02</span><div><h3>Stay ahead of collections</h3><p>Make the day’s work visible and keep the next payment from becoming a surprise.</p></div></div>
              <div className="home-workflow-item"><span className="home-workflow-number">03</span><div><h3>Close the loop</h3><p>Finish every loan with a clean record that strengthens the decisions that come after it.</p></div></div>
            </div>
          </div>
        </section>

        <section className="home-shell home-cta" aria-labelledby="home-cta-title">
          <div className="home-cta-content">
            <p className="home-section-kicker">Make room for better work</p>
            <h2 id="home-cta-title">Your lending operation deserves a clear place to land.</h2>
            <p className="home-section-intro">Request access to Kaks Credit and give your team one calm, connected workspace for the work that keeps capital moving.</p>
            <Link className="home-pill home-pill-copper" href="/request-access">Request access <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>

      <footer className="home-shell home-footer">
        <p>© 2026 Kaks Credit. Lending, with clarity.</p>
        <p>Already have an account? <Link href="/login">Sign in</Link></p>
      </footer>
    </div>
  )
}
