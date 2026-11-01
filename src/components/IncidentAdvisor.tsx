import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Sparkles, Square, Copy, Check, ChevronDown, Loader2, RotateCcw, AlertTriangle } from "lucide-react";
import { INCIDENT_MAX, INCIDENT_MIN, type IncidentEvent } from "@/lib/incident-shared";

type Phase = "idle" | "journal" | "thinking" | "writing" | "done" | "error" | "stopped";

const STEP_LABEL: Record<string, string> = {
  journal: "Lecture du journal des actions…",
  thinking: "Analyse de l'incident…",
  writing: "Rédaction de la recommandation…",
};

const md = {
  h2: (p: React.ComponentProps<"h2">) => <h2 className="mb-1.5 mt-5 text-sm font-semibold uppercase tracking-wider text-primary first:mt-0" {...p} />,
  h3: (p: React.ComponentProps<"h3">) => <h3 className="mb-1 mt-3 font-semibold" {...p} />,
  p: (p: React.ComponentProps<"p">) => <p className="mb-2 leading-relaxed" {...p} />,
  ul: (p: React.ComponentProps<"ul">) => <ul className="mb-2 list-disc space-y-1 pl-5" {...p} />,
  ol: (p: React.ComponentProps<"ol">) => <ol className="mb-2 list-decimal space-y-1 pl-5" {...p} />,
  strong: (p: React.ComponentProps<"strong">) => <strong className="font-semibold text-foreground" {...p} />,
  blockquote: (p: React.ComponentProps<"blockquote">) => <blockquote className="my-2 border-l-2 border-primary pl-3 italic text-muted-foreground" {...p} />,
  code: (p: React.ComponentProps<"code">) => <code className="rounded bg-background px-1 py-0.5 font-mono text-xs" {...p} />,
  a: (p: React.ComponentProps<"a">) => <a className="text-primary underline" target="_blank" rel="noreferrer" {...p} />,
};

export function IncidentAdvisor({ guildId }: { guildId: string }) {
  const [desc, setDesc] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [showReasoning, setShowReasoning] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const running = phase === "journal" || phase === "thinking" || phase === "writing";
  const len = desc.trim().length;

  // Cancel an in-flight analysis when leaving the page or switching server.
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    abortRef.current?.abort();
    setPhase("idle");
    setText("");
    setReasoning("");
    setError("");
  }, [guildId]);

  async function analyze() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("journal");
    setText("");
    setReasoning("");
    setError("");
    setShowReasoning(false);

    let gotDone = false;
    let gotError = false;
    try {
      const res = await fetch("/api/incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId, description: desc }),
        signal: ctrl.signal,
        credentials: "same-origin",
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Erreur ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as IncidentEvent;
          if (ev.type === "status") setPhase(ev.step);
          else if (ev.type === "reasoning") setReasoning((r) => r + ev.text);
          else if (ev.type === "text") setText((t) => t + ev.text);
          else if (ev.type === "error") {
            gotError = true;
            setError(ev.message);
            setPhase("error");
          } else if (ev.type === "done") gotDone = true;
        }
      }
      if (!gotError) {
        if (gotDone) setPhase("done");
        else {
          setError("La connexion a été interrompue avant la fin de l'analyse.");
          setPhase("error");
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        setPhase((p) => (p === "idle" ? p : "stopped"));
        return;
      }
      setError(e instanceof Error ? e.message : "L'analyse a échoué.");
      setPhase("error");
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setPhase("stopped");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible");
    }
  }

  const btn = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50";

  return (
    <section className="rounded-xl border border-primary/40 bg-card p-5 shadow-glow" aria-labelledby="advisor-title">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 id="advisor-title" className="font-semibold">Conseiller IA</h2>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Décrivez l'incident : l'IA consulte le journal des actions du serveur et propose une réponse proportionnée. Elle ne sanctionne jamais elle-même.
      </p>

      <label htmlFor="incident-desc" className="sr-only">Description de l'incident</label>
      <textarea
        id="incident-desc"
        rows={4}
        maxLength={INCIDENT_MAX}
        disabled={running}
        placeholder="Ex : Pseudo123 insulte plusieurs membres dans #général depuis ce matin et a ignoré un premier rappel des règles."
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && len >= INCIDENT_MIN && !running) analyze();
        }}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {running ? (
          <button type="button" onClick={stop} className={`${btn} border border-border hover:bg-muted`}>
            <Square className="h-4 w-4" /> Arrêter
          </button>
        ) : (
          <button type="button" onClick={analyze} disabled={len < INCIDENT_MIN} className={`${btn} bg-primary text-primary-foreground`}>
            {phase === "done" || phase === "error" || phase === "stopped" ? <RotateCcw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {phase === "done" || phase === "error" || phase === "stopped" ? "Relancer l'analyse" : "Analyser l'incident"}
          </button>
        )}
        <span className={`ml-auto font-mono text-xs ${len > 0 && len < INCIDENT_MIN ? "text-destructive" : "text-muted-foreground"}`}>
          {len > 0 && len < INCIDENT_MIN ? `${INCIDENT_MIN - len} caractère(s) de plus` : `${desc.length}/${INCIDENT_MAX}`}
        </span>
      </div>

      {running && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" /> {STEP_LABEL[phase]}
        </p>
      )}

      {reasoning && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowReasoning((s) => !s)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={showReasoning}>
            <ChevronDown className={`h-3 w-3 transition-transform ${showReasoning ? "rotate-180" : ""}`} /> Raisonnement de l'IA
          </button>
          {showReasoning && <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-xs text-muted-foreground">{reasoning}</p>}
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {text && (
        <div className="relative mt-4 rounded-lg bg-muted p-4 text-sm" aria-live="polite">
          {phase !== "writing" && (
            <button type="button" onClick={copy} aria-label="Copier la recommandation" className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground">
              {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            </button>
          )}
          <div className="pr-8">
            <ReactMarkdown components={md}>{text}</ReactMarkdown>
          </div>
          {phase === "stopped" && <p className="mt-2 text-xs italic text-muted-foreground">Analyse arrêtée avant la fin.</p>}
        </div>
      )}
    </section>
  );
}
