import type { Context } from "fresh";
import type { State } from "../utils.ts";
import {
  ArchitecturePreview,
  PhonePreview,
  ProductPreview,
} from "../components/ProductPreview.tsx";

export const title = "PM.ai — Product management for AI coding agents";
const description =
  "Turn ideas into focused coding tasks and orchestrate Codex and Claude across your own machines with PM.ai.";

// Only deployment configuration can supply the public origin; never trust Host.
export function publicURL(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) || url.username ||
      url.password
    ) return;
    return `${url.origin}/`;
  } catch {
    return;
  }
}

const features = [
  [
    "01",
    "A backlog for your prompts",
    "Keep the title, prompt, repository and execution target together. Your next task is ready when you are.",
  ],
  [
    "02",
    "Codex + Claude Code",
    "Orchestrate the local coding tools you already use, with provider profiles for different setups.",
  ],
  [
    "03",
    "Desktop + mobile",
    "Plan at your desk. Capture an idea, check progress or answer your agent from your phone.",
  ],
  [
    "04",
    "More than one machine",
    "Keep repositories grouped by device. Send work to the computer where that project lives.",
  ],
  [
    "05",
    "A queue with intent",
    "Move from Inbox to Ready, then explicitly Run or Queue. Track running, waiting and completed work.",
  ],
  [
    "06",
    "Conversation → task",
    "MCP integration lets compatible AI clients turn a discussion into focused backlog items. Creating tasks and starting work stay separate.",
    "MCP",
  ],
  [
    "07",
    "Continue after capacity returns",
    "Resume supported tasks when provider capacity becomes available. Quota data and auto-resume depend on provider capabilities.",
  ],
  [
    "08",
    "Help choosing how to run",
    "An optional AI Task Router is planned to recommend provider, model tier, reasoning effort and session choice—and flag tasks that are too broad.",
    "Planned · optional",
  ],
];
const steps = [
  ["Think", "Explore the product or architecture with your preferred AI."],
  ["Capture", "Turn the discussion into focused prompts in your backlog."],
  ["Execute", "Send each task to Codex or Claude on the right machine."],
  ["Monitor", "Follow progress, completion and requests for your input."],
  ["Continue", "Review the result. Give the next step a task of its own."],
];
const questions = [
  [
    "Does PM.ai replace Codex or Claude?",
    "No. PM.ai coordinates the coding agents you already use. The agents do the implementation; PM.ai keeps the work organized.",
  ],
  [
    "Does the code run in the cloud?",
    "Coding-agent processes run on your configured machine against local repositories. PM.ai syncs task and prompt content, execution updates and metadata through its server. Your coding provider may process code according to its own settings and policies.",
  ],
  [
    "Does PM.ai need GitHub access?",
    "No. The current core workflow uses local repositories and prompt-based tasks. It does not require GitHub or Git integration.",
  ],
  [
    "Can I use multiple computers?",
    "Yes. Repositories belong to devices, and one account can manage multiple devices and their provider profiles.",
  ],
  [
    "Can AI create tasks automatically?",
    "Compatible MCP clients can create backlog items from conversations using your PM.ai account token. Creating a task and authorizing its execution are separate decisions. Clients that require OAuth account linking need a future authentication extension.",
  ],
  [
    "Is PM.ai an IDE?",
    "No. It is a task and orchestration layer. Keep using your preferred editor and development environment.",
  ],
  ["Is it free?", "Pricing has not been announced yet."],
];

export function LandingPage({ canonical }: { canonical?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="robots" content="index, follow" />
        <meta name="theme-color" content="#173d33" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="PM.ai" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {canonical && (
          <>
            <link rel="canonical" href={canonical} />
            <meta property="og:url" content={canonical} />
            <meta
              property="og:image"
              content={`${canonical}marketing/icon.png`}
            />
            <meta property="og:image:width" content="1024" />
            <meta property="og:image:height" content="1024" />
            <meta
              property="og:image:alt"
              content="PM.ai app icon: stacked task cards on a forest green background"
            />
            <meta
              name="twitter:image"
              content={`${canonical}marketing/icon.png`}
            />
            <meta name="twitter:image:alt" content="PM.ai app icon" />
          </>
        )}
        <link rel="icon" type="image/png" href="/marketing/brand.png" />
        <link rel="stylesheet" href="/marketing/site.css" />
      </head>
      <body>
        <a class="skip-link" href="#main">Skip to content</a>
        <header class="site-header shell">
          <a class="brand" href="#" aria-label="PM.ai home">
            <img src="/marketing/brand.png" alt="" width="32" height="32" />
            <span class="wordmark">
              PM<span>.ai</span>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#features">Features</a>
            <a href="#architecture">Architecture</a>
            <a href="#faq">FAQ</a>
          </nav>
          <span class="beta-label">
            <span aria-hidden="true">●</span> Public beta coming soon
          </span>
        </header>
        <main id="main">
          <section class="hero shell">
            <div class="hero-copy">
              <p class="eyebrow">
                <span class="small-line" /> BUILT FOR THE WAY YOU BUILD NOW
              </p>
              <h1>
                Turn ideas into work<br class="desktop-break" /> for your{" "}
                <em>coding agents.</em>
              </h1>
              <p class="hero-description">
                A home for your next idea. A queue for what comes
                next.<br />PM.ai turns focused prompts into tasks for Codex and
                Claude—on your own machines.
              </p>
              <div class="hero-actions">
                <a class="primary-link" href="#how-it-works">
                  See how it works <span aria-hidden="true">↗</span>
                </a>
                <span class="hero-note">
                  Your agents. Your machines. Your direction.
                </span>
              </div>
            </div>
            <ProductPreview />
            <div class="hero-bottom">
              <span>FROM THOUGHT TO FOLLOW-THROUGH</span>
              <span>
                Codex <span class="separator">/</span> Claude Code{" "}
                <span class="separator">/</span> Desktop + Mobile
              </span>
            </div>
          </section>
          <section class="section shell problem">
            <div class="section-heading">
              <p class="eyebrow">LESS SCROLLING. MORE SHIPPING.</p>
              <h2>
                Good ideas deserve<br />more than a chat history.
              </h2>
            </div>
            <div class="three-grid">
              {[[
                "Lost in the conversation",
                "The implementation plan is somewhere in a long chat. Save the useful prompts as tasks you can come back to.",
              ], [
                "Too much in one prompt",
                "Auth, billing and onboarding need room to breathe. Give independent changes a focused task and, when useful, a clean agent session.",
              ], [
                "An agent still needs direction",
                "Decide what runs next. See what finished, what is waiting and what needs your input—all in one workflow.",
              ]].map(([heading, copy], i) => (
                <article key={heading}>
                  <span class="index">0{i + 1}</span>
                  <h3>{heading}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </section>
          <section class="workflow-section" id="how-it-works">
            <div class="shell section">
              <div class="section-heading">
                <p class="eyebrow">A SIMPLE LOOP</p>
                <h2>Think it through. Put it in motion.</h2>
                <p>Keep the conversation creative and the execution focused.</p>
              </div>
              <ol class="workflow">
                {steps.map(([name, copy], i) => (
                  <li key={name}>
                    <span class="step-number">0{i + 1}</span>
                    <h3>{name}</h3>
                    <p>{copy}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
          <section class="section shell" id="features">
            <div class="section-heading">
              <p class="eyebrow">ONE PLACE TO KEEP WORK MOVING</p>
              <h2>
                A little structure.<br />A lot less juggling.
              </h2>
            </div>
            <div class="features-grid">
              {features.map(([number, heading, copy, label]) => (
                <article class="feature" key={number}>
                  <span class="feature-number">{number} /</span>
                  {label && <span class="planned-label">{label}</span>}
                  <h3>{heading}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </section>
          <section class="architecture-section" id="architecture">
            <div class="shell section split">
              <div>
                <p class="eyebrow">LOCAL-FIRST, BY DESIGN</p>
                <h2>
                  Your coding agents<br />keep working on<br />
                  <em>your machines.</em>
                </h2>
                <p class="large-copy">
                  PM.ai coordinates the work. Your development environment stays
                  yours.
                </p>
                <p>
                  Repositories and coding-agent credentials stay on your
                  machines for orchestration. The server syncs task and prompt
                  content, metadata and execution updates, relays commands and
                  sends notifications.
                </p>
                <p class="muted">
                  Your coding providers retain their own data handling policies.
                  Local execution does not mean that no data leaves your device.
                </p>
              </div>
              <ArchitecturePreview />
            </div>
          </section>
          <section class="section shell positioning">
            <p class="eyebrow">A DIFFERENT KIND OF WORK ITEM</p>
            <h2>
              Product management when<br />the developer is an AI agent.
            </h2>
            <p class="large-copy">
              Part requirement. Part work item. An instruction ready to run.
            </p>
            <div class="comparison">
              <div>
                <span class="eyebrow">TRADITIONAL TASK TRACKER</span>
                <p>
                  Requirement <span>→</span> Ticket <span>→</span>{" "}
                  Human developer <span>→</span> Implementation
                </p>
              </div>
              <div class="comparison-pmai">
                <span class="eyebrow">THE PM.ai WORKFLOW</span>
                <p>
                  Idea <span>→</span> Focused prompt <span>→</span> Coding agent
                  {" "}
                  <span>→</span> Result
                </p>
              </div>
            </div>
            <p class="muted">
              A task holds the intent. A session is how the agent carries it
              out.
            </p>
          </section>
          <section class="mcp-section">
            <div class="shell section split">
              <div>
                <p class="eyebrow">
                  MCP INTEGRATION
                </p>
                <h2>
                  From AI conversation<br />to backlog.<br />
                  <em>Without copy-paste.</em>
                </h2>
                <p class="large-copy">
                  Keep the ideas flowing. Give the implementation steps
                  somewhere to land.
                </p>
                <p>
                  MCP lets compatible AI clients create and manage tasks
                  directly from a discussion. Saving a task will not, by itself,
                  start a coding agent. Execution remains an explicit decision.
                </p>
              </div>
              <figure class="conversation">
                <figcaption>
                  Illustrative MCP workflow
                </figcaption>
                <div class="chat-message">
                  <span class="chat-person">YOU</span>
                  <p>
                    Split this architecture into four implementation tasks and
                    add them to PM.ai.
                  </p>
                </div>
                <div class="chat-message ai-message">
                  <span class="chat-person">YOUR AI CLIENT</span>
                  <p>Four focused tasks, ready for your backlog.</p>
                  <ul>
                    {[
                      "Create provider abstraction",
                      "Implement Codex adapter",
                      "Add Claude adapter",
                      "Add reconciliation loop",
                    ].map((item) => (
                      <li key={item}>
                        <span aria-hidden="true">✓</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                  <span class="chat-footnote">
                    Saved to Inbox · awaiting your direction
                  </span>
                </div>
              </figure>
            </div>
          </section>
          <section class="section shell split mobile-section">
            <div>
              <p class="eyebrow">AWAY FROM YOUR DESK, STILL IN THE LOOP</p>
              <h2>
                The next idea<br />won’t wait until<br />
                <em>you’re back.</em>
              </h2>
              <p class="large-copy">
                Capture it on your phone. Send it to the right machine. Get
                notified when the work is done.
              </p>
              <ul class="mobile-benefits">
                <li>Save a prompt in a few taps</li>
                <li>Check running and waiting tasks across devices</li>
                <li>Reply when an agent needs your input</li>
                <li>Queue, resume or stop work remotely</li>
              </ul>
              <p class="muted">
                An offline device can receive new tasks in the backlog.
                Execution needs the machine to reconnect.
              </p>
            </div>
            <PhonePreview />
          </section>
          <section class="section shell faq-section" id="faq">
            <div>
              <p class="eyebrow">A FEW GOOD QUESTIONS</p>
              <h2>
                Before you<br />put it to work.
              </h2>
            </div>
            <div class="faq-list">
              {questions.map(([question, answer]) => (
                <details key={question}>
                  <summary>
                    {question}
                    <span aria-hidden="true">+</span>
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </section>
          <section class="closing shell">
            <p class="eyebrow">MAKE ROOM FOR WHAT’S NEXT</p>
            <h2>
              Your next idea.<br />Your agents’ next task.
            </h2>
            <span class="beta-label">● Public beta coming soon</span>
          </section>
        </main>
        <footer class="shell">
          <a class="wordmark" href="#">
            PM<span>.ai</span>
          </a>
          <p>AI-native task orchestration for coding agents.</p>
          <a href="#main">Back to top ↑</a>
        </footer>
      </body>
    </html>
  );
}

export function marketingPage(ctx: Context<State>) {
  return ctx.render(
    <LandingPage canonical={publicURL(Deno.env.get("PMAI_PUBLIC_URL"))} />,
    {
      headers: {
        "Content-Security-Policy":
          "default-src 'none'; style-src 'self'; img-src 'self'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    },
  );
}
