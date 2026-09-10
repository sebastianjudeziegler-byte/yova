"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, Check, Circle, Plus, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { agenda, compare, faq, habits, inputs, noticed } from "./content";
import { LandingWaitlistForm } from "./landing-waitlist-form";
import styles from "./landing.module.css";

type LandingProps = {
  inviteOnly: boolean;
  authIssue: string | null;
  signedOutStorageIssue: string | null;
  onRetryAuth: () => void;
  onCreate: () => void;
  onSignIn: () => void;
};

export function Landing({ inviteOnly, authIssue, signedOutStorageIssue, onRetryAuth, onCreate, onSignIn }: LandingProps) {
  return (
    <div className={styles.landing}>
      <a className="skip-link" href="#landing-main">Skip to main content</a>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="YOVA home"><BrandMark /></Link>
        <nav className={styles.navigation} aria-label="Primary">
          <a href="#how">How it adapts</a>
          <a href="#session">Your profile</a>
          <a href="#faq">FAQ</a>
          <Link href="/study-profile">Study Profile <span className={styles.free}>FREE</span></Link>
          <button type="button" onClick={onSignIn}>Sign in</button>
          {inviteOnly
            ? <InvitationButton onCreate={onCreate} />
            : <a className={`button primary ${styles.primary}`} href="#join">Join the waitlist</a>}
        </nav>
      </header>

      <main id="landing-main" className={styles.main} tabIndex={-1}>
        {authIssue && <section className={styles.warning} role="alert"><AlertCircle size={19} aria-hidden="true" /><div><strong>Account connection interrupted</strong><span>{authIssue}</span></div><button className="button secondary" onClick={onRetryAuth}>Try again</button></section>}
        {signedOutStorageIssue && <section className={styles.warning} role="alert"><AlertCircle size={19} aria-hidden="true" /><div><strong>Signed out with a browser cleanup warning</strong><span>{signedOutStorageIssue}</span></div></section>}

        <section id="join" className={`${styles.darkCard} ${styles.hero}`} aria-labelledby="landing-title">
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>{inviteOnly ? "YOVA private alpha" : "Coming soon · Founding waitlist open"}</span>
            <h1 id="landing-title">Studying that adapts to how you <em>actually</em> learn.</h1>
            <p>YOVA starts from your habits, your materials and the time you really have. Every session is shaped by what you did in the last one: the method changes, the timing changes, and the plan moves with you.</p>
            {inviteOnly
              ? <div className={styles.invitation}><InvitationButton onCreate={onCreate} /></div>
              : <LandingWaitlistForm idPrefix="landing-hero" compact />}
            <Benefits inline items={["Founding price, locked for a year", "Access before public launch", "One launch email, then your choice"]} />
          </div>
          <SessionPreview />
        </section>

        <section id="how" className={styles.section} aria-labelledby="how-title">
          <div className={styles.sectionHeading}>
            <span className={styles.kicker}>How personalization works</span>
            <h2 id="how-title">Six things YOVA knows about you before it chooses a session.</h2>
            <p>Some you tell it once. The rest it learns from your completed sessions. All of it is visible and changeable in your profile.</p>
          </div>
          <div className={styles.inputGrid}>
            {inputs.map((input) => <article className={styles.inputCard} key={input.number}>
              <span className={styles.number}>{input.number}</span>
              <div><div className={styles.inputTitle}><h3>{input.name}</h3><span className={styles.tag} data-learned={input.tag === "It learns"}>{input.tag}</span></div><p>{input.body}</p></div>
            </article>)}
          </div>
        </section>

        <section id="session" className={`${styles.section} ${styles.darkCard} ${styles.profileSection}`} aria-labelledby="profile-title">
          <div>
            <span className={styles.kicker}>Your profile, as YOVA sees it</span>
            <h2 id="profile-title">Everything YOVA knows about you, on one page you can edit.</h2>
            <p>Personalization only works if you can see it. Your habits, materials, energy window and method preferences live in one place. Change any of them and the next session reflects it. Nothing is inferred behind your back.</p>
            <Benefits items={[
              "Every habit level shows where it came from: your answers, or your sessions.",
              "Override any value. YOVA uses your setting until the evidence clearly disagrees, and then asks.",
              "Export or delete the whole profile at any time.",
            ]} />
          </div>
          <ProfilePreview />
        </section>

        <section className={styles.section} aria-labelledby="learns-title">
          <div className={styles.sectionHeading}>
            <span className={styles.kicker}>What YOVA learns over time</span>
            <h2 id="learns-title">Small observations, kept in plain language. A schedule that follows them.</h2>
            <p>Each completed session adds a little evidence. When a pattern is clear enough to act on, YOVA writes it down where you can read it and adjusts the next session to match. When a day is missed, the same evidence decides where the work goes.</p>
          </div>
          <div className={styles.learningGrid}>
            <div className={styles.observations}>
              {noticed.map((notice) => <article className={styles.noticeCard} key={notice.when}>
                <div className={styles.cardTop}><span className={styles.kicker}><Sparkles size={14} aria-hidden="true" />YOVA noticed</span><span>{notice.when}</span></div>
                <p>{notice.observation}</p>
                <div className={styles.change}><span className={styles.kicker}>Change</span><span>{notice.change}</span></div>
              </article>)}
              <p className={styles.footnote}>Dismiss any observation and it stops being used.</p>
            </div>
            <CalendarPreview />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="comparison-title">
          <div className={styles.sectionHeading}>
            <span className={styles.kicker}>Where YOVA sits</span>
            <h2 id="comparison-title">Flashcard apps repeat. Chat assistants answer. YOVA adjusts.</h2>
            <p>All three have a place. The table shows what each one knows about you when you sit down to study.</p>
          </div>
          <div className={styles.tableScroll} role="region" aria-label="Study tools comparison" tabIndex={0}>
            <table>
              <caption className={styles.srOnly}>What each study tool knows about you</caption>
              <thead><tr>{["Knows", "Flashcard apps", "Chat assistants", "YOVA"].map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
              <tbody>{compare.map((row) => <tr key={row.row}><th scope="row">{row.row}</th><td>{row.cards}</td><td>{row.chat}</td><td>{row.yova}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className={`${styles.section} ${styles.bridge}`} aria-labelledby="bridge-title">
          <div>
            <span className={styles.kicker}>Available today <span className={styles.free}>Free</span></span>
            <h2 id="bridge-title">Start your profile now with the three-minute Study Profile.</h2>
            <p>Fourteen questions about how you study on an ordinary evening. You get a named pattern, the habit to work on first and a session plan for tonight. When YOVA opens, the profile is already in place.</p>
          </div>
          <Link className={`button secondary ${styles.bridgeLink}`} href="/study-profile">Take the Study Profile <ArrowRight size={18} aria-hidden="true" /></Link>
        </section>

        <section id="faq" className={`${styles.section} ${styles.faq}`} aria-labelledby="faq-title">
          <div>
            <span className={styles.kicker}>Questions</span>
            <h2 id="faq-title">The things people ask before joining.</h2>
            <p>Something missing? <Link href="/support">Write to us</Link> and we will answer directly.</p>
          </div>
          <div className={styles.accordions}>
            {faq.map((item) => <details key={item.question}><summary>{item.question}<span className={styles.faqIcon} aria-hidden="true"><Plus size={14} /></span></summary><p>{item.answer}</p></details>)}
          </div>
        </section>

        <section id="founding" className={`${styles.section} ${styles.darkCard} ${styles.finalCta}`} aria-labelledby="founding-title">
          <div>
            <span className={styles.kicker}>{inviteOnly ? "YOVA private alpha" : "Founding waitlist"}</span>
            <h2 id="founding-title">Join before launch and YOVA opens already knowing how you learn.</h2>
            <p>Founding members get access ahead of the public launch, a founding price held for the first year, and a direct line to the team while the adaptive features are being tuned.</p>
            <Benefits items={["Access before public launch, in the order you joined", "Founding price, held for twelve months", "Your Study Profile carries into your first plan"]} />
          </div>
          <div className={styles.formPanel}>
            {inviteOnly ? <InvitationButton onCreate={onCreate} /> : <LandingWaitlistForm idPrefix="landing-footer" />}
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div><BrandMark compact /><span>© 2026 YOVA. Your study system should adapt to you.</span></div>
        <nav aria-label="Trust and support"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/support">Support</Link></nav>
      </footer>
    </div>
  );
}

function InvitationButton({ onCreate }: { onCreate: () => void }) {
  return <button type="button" className={`button primary ${styles.primary}`} onClick={onCreate}>Use my invitation <ArrowRight size={16} aria-hidden="true" /></button>;
}

function Benefits({ items, inline = false }: { items: string[]; inline?: boolean }) {
  return <ul className={`${styles.benefits} ${inline ? styles.inlineBenefits : ""}`}>{items.map((item) => <li key={item}><Check size={16} aria-hidden="true" /><span>{item}</span></li>)}</ul>;
}

function SessionPreview() {
  return <div className={styles.sessionPreview} role="group" aria-label="Example adapted YOVA session">
    <div className={styles.windowBar}><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /><span className={styles.windowLabel}>Tonight in YOVA</span></div>
    <div className={styles.sessionHead}><div><span className={styles.kicker}>Adjusted for you</span><h2>Cellular respiration</h2><p>20 min · Retrieval, then one targeted repair</p></div><span className={styles.testPill}>Thu test</span></div>
    <div className={styles.reasons}>
      <div><Sparkles size={16} aria-hidden="true" /><span><strong>Shortened to 20 minutes.</strong> You finished every 20-minute session this week and stopped early in both 40-minute ones.</span></div>
      <div><Sparkles size={16} aria-hidden="true" /><span><strong>Method switched from rereading to retrieval.</strong> Your confidence on Tuesday was high; your closed-notes check found one gap.</span></div>
    </div>
    <ol className={styles.sessionSteps}>
      <li className={styles.activeStep}><span className={styles.stepNumber} aria-hidden="true"><Circle className={styles.pulse} size={8} fill="currentColor" /></span><div><strong>Recall the four stages from memory</strong><small>6 minutes · starts now</small></div></li>
      <li><span className={styles.stepNumber} aria-hidden="true">2</span><div><strong>Repair the electron transport chain</strong><small>9 minutes · from your notes, p.3</small></div></li>
      <li><span className={styles.stepNumber} aria-hidden="true">3</span><div><strong>Verify without notes</strong><small>5 minutes</small></div></li>
    </ol>
    <div className={styles.sessionFooter}><span>Your strongest window: 19:00 to 21:00</span><span className={styles.kicker}>PROFILE · MATERIALS · RESULTS</span></div>
  </div>;
}

// These previews illustrate the product. Their Edit/Add and calendar pills are
// presentational so they do not expose nonfunctional controls to keyboard users.
function ProfilePreview() {
  return <div className={styles.profilePanel} role="group" aria-label="Example YOVA study profile">
    <div className={styles.profileTop}><span>You · Study profile</span><span>Updated after 17 sessions</span></div>
    <div className={styles.habits}>{habits.map((habit) => <div className={styles.habit} key={habit.name}>
      <span>{habit.name}</span>
      <span className={styles.habitBar} role="meter" aria-label={habit.name} aria-valuemin={0} aria-valuemax={3} aria-valuenow={habit.level} aria-valuetext={`${habit.level} of 3, from ${habit.source}`}>
        {[1, 2, 3].map((level) => <i key={level} data-active={level <= habit.level} />)}
      </span>
      <span className={styles.source}>{habit.source}</span><span className={styles.exampleControl}>Edit</span>
    </div>)}</div>
    <div className={styles.preferenceGrid}>
      <div className={styles.preference}><div className={styles.preferenceTop}><strong>Energy window</strong><span className={styles.exampleControl}>Edit</span></div><Chips items={["Morning", "Afternoon", "Evening", "Late night"]} selected={["Afternoon"]} /></div>
      <div className={styles.preference}><div className={styles.preferenceTop}><strong>Session length</strong><span className={styles.exampleControl}>Edit</span></div><Chips items={["15 min", "20 min", "30 min", "45 min"]} selected={["20 min"]} /></div>
    </div>
    <div className={styles.preference}>
      <div className={styles.preferenceTop}><strong>Materials · Biology</strong><span className={styles.exampleControl}>Add</span></div>
      <ul className={styles.materials}><li><span>Unit 4 notes.pdf</span><span>12 pages · used in 9 sessions</span></li><li><span>Lecture slides, week 3 to 5</span><span>3 files</span></li><li><span>Khan Academy: cellular respiration</span><span>link</span></li></ul>
    </div>
    <div className={styles.preference}><div className={styles.preferenceTop}><strong>Method preferences</strong><span className={styles.exampleControl}>Edit</span></div><Chips items={["Chemistry: worked examples first", "History: retrieval first", "Never: rereading"]} selected={["Chemistry: worked examples first", "History: retrieval first"]} /></div>
  </div>;
}

function Chips({ items, selected }: { items: string[]; selected: string[] }) {
  return <ul className={styles.chips}>{items.map((item) => <li key={item} data-selected={selected.includes(item)}>{item}{selected.includes(item) && <span className={styles.srOnly}> (selected)</span>}</li>)}</ul>;
}

function CalendarPreview() {
  return <div className={styles.calendar} role="group" aria-label="Example calendar after a missed session">
    <div className={styles.cardTop}><span className={styles.kicker}>Missed session · Wednesday</span><span>Thu 07:10</span></div>
    <h3>Wednesday did not happen. Here is the new week.</h3>
    <p>The test date stays. The missed material moves into the afternoons you usually keep, and the final review gets shorter so spacing still holds. Every change is listed and reversible.</p>
    <ol className={styles.agenda}>{agenda.map((item) => <li key={item.day} data-state={item.state}><span>{item.day}</span><span>{item.state === "missed" ? <s>{item.title}</s> : item.title}</span><span>{item.meta}</span></li>)}</ol>
    <div className={styles.calendarActions}><span className={styles.exampleSecondary}>Keep the old dates</span><span className={styles.examplePrimary}>Accept the new week</span></div>
  </div>;
}
