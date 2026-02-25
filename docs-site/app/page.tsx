import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-fd-background text-fd-foreground">
      <div className="mx-auto max-w-2xl text-center px-6">
        <h1 className="text-5xl font-bold tracking-tight mb-4">BTMG</h1>
        <p className="text-lg text-fd-muted-foreground mb-2">
          Bidirectional Temporal Memory Graph
        </p>
        <p className="text-fd-muted-foreground mb-8 max-w-lg mx-auto">
          A single source of truth between your documentation and every AI agent
          in your stack. Schema-enforced, temporally versioned, bidirectionally
          synced.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/thefounder-seb/btmg"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-fd-border px-6 py-3 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            GitHub
          </a>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
          <div className="rounded-lg border border-fd-border p-4">
            <h3 className="font-semibold mb-1">Schema Enforced</h3>
            <p className="text-sm text-fd-muted-foreground">
              Zod validators prevent agents from hallucinating invalid structure
            </p>
          </div>
          <div className="rounded-lg border border-fd-border p-4">
            <h3 className="font-semibold mb-1">Temporal Timeline</h3>
            <p className="text-sm text-fd-muted-foreground">
              Full version history — who changed what, when, and why
            </p>
          </div>
          <div className="rounded-lg border border-fd-border p-4">
            <h3 className="font-semibold mb-1">Bidirectional Sync</h3>
            <p className="text-sm text-fd-muted-foreground">
              Graph and docs stay in sync. Edit either, the other updates
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
