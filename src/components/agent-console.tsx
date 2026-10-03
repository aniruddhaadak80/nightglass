"use client";

import { useState } from "react";
import { Loader2, Play, Terminal } from "lucide-react";

interface Preset {
  label: string;
  method: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

/** Injected from the server so the preset bodies do not call `new Date()` during render. */
const PRESETS: Preset[] = [
  { label: "initialize", method: "initialize" },
  { label: "tools/list", method: "tools/list" },
  {
    label: "get_briefing",
    method: "tools/call",
    tool: "get_briefing",
    arguments: {},
  },
  {
    label: "list_catalogue (nebula)",
    method: "tools/call",
    tool: "list_catalogue",
    arguments: { kind: "nebula", limit: 5 },
  },
  {
    label: "analyse_object M42",
    method: "tools/call",
    tool: "analyse_object",
    arguments: { objectId: "sample:M42" },
  },
  {
    label: "create_plan",
    method: "tools/call",
    tool: "create_plan",
    arguments: {
      name: "Agent-created session",
      nightOf: "__TODAY__",
      site: {
        name: "Agent site",
        latitudeDeg: 28.6139,
        longitudeDeg: 77.209,
        bortle: 6,
        horizonDeg: 10,
        timezone: "UTC",
      },
      instrument: {
        name: "150 mm Newtonian",
        apertureMm: 150,
        magnification: 60,
        type: "reflector",
      },
      targets: [
        {
          objectId: "sample:M42",
          name: "Orion Nebula",
          kind: "nebula",
          magnitude: 4,
          decision: "pending",
          note: "created by the agent console",
        },
      ],
      idempotencyKey: "agent-console-demo-1",
    },
  },
  {
    label: "log_observation (idempotent)",
    method: "tools/call",
    tool: "log_observation",
    arguments: {
      objectId: "sample:M42",
      objectName: "Orion Nebula",
      seenOn: "__TODAY__",
      confidence: 4,
      notes: "Logged from the agent console.",
    },
  },
  { label: "verify_integrity", method: "tools/call", tool: "verify_integrity", arguments: {} },
];

function buildRequest(preset: Preset, today: string): unknown {
  if (preset.method === "tools/call") {
    const args = substituteToday(preset.arguments ?? {}, today);
    return {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: preset.tool, arguments: args },
    };
  }
  return { jsonrpc: "2.0", id: 1, method: preset.method, params: {} };
}

/**
 * Live agent console.
 *
 * Every button issues a real JSON-RPC request against the real endpoint and
 * shows both the request and the response, including real errors. Nothing here
 * is canned.
 */
/** Replace the `__TODAY__` placeholder so preset dates are fixed at render time. */
function substituteToday(value: unknown, today: string): unknown {
  if (value === "__TODAY__") return today;
  if (Array.isArray(value)) return value.map((v) => substituteToday(v, today));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteToday(v, today);
    }
    return out;
  }
  return value;
}

export function AgentConsole({ endpoint, today }: { endpoint: string; today: string }) {
  const [request, setRequest] = useState<string>(JSON.stringify(buildRequest(PRESETS[0]!, today), null, 2));
  const [response, setResponse] = useState<string>("// No call made yet.");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function send(body: unknown) {
    setPending(true);
    setStatus(null);
    setRequest(JSON.stringify(body, null, 2));
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      setResponse(text);
      setStatus(`${res.status} ${res.statusText}`);
    } catch (error) {
      setResponse(String(error));
      setStatus("request failed");
    } finally {
      setPending(false);
    }
  }

  function sendEdited() {
    try {
      const parsed = JSON.parse(request) as unknown;
      void send(parsed);
    } catch {
      setStatus("request body is not valid JSON");
      setResponse("// The request could not be parsed, so nothing was sent.");
    }
  }

  return (
    <section className="mt-6" aria-labelledby="console">
      <h2 id="console" className="plate-caption">
        Console
      </h2>

      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="agent-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => void send(buildRequest(preset, today))}
            data-testid={`preset-${preset.label.split(" ")[0]}`}
          >
            {pending ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="plate p-4">
          <p className="plate-caption flex items-center gap-2">
            <Terminal size={12} aria-hidden="true" />
            Request
          </p>
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={14}
            spellCheck={false}
            className="field mt-2 font-mono text-[0.7rem] leading-relaxed"
            aria-label="JSON-RPC request body"
            data-testid="agent-request"
          />
          <button
            type="button"
            className="btn btn-primary mt-3"
            onClick={sendEdited}
            disabled={pending}
            data-testid="agent-send"
          >
            {pending ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <Play size={13} aria-hidden="true" />
            )}
            Send to {endpoint}
          </button>
        </div>

        <div className="plate p-4">
          <p className="plate-caption">Response</p>
          {status ? (
            <p
              className={`mt-1 text-xs ${status === "request failed" ? "signal-fallback" : "text-bone-400"}`}
              data-testid="agent-status"
            >
              HTTP {status}
            </p>
          ) : null}
          <pre
            className="field mt-2 max-h-[22rem] overflow-auto whitespace-pre-wrap break-words text-[0.7rem] leading-relaxed"
            data-testid="agent-response"
          >
            {response}
          </pre>
        </div>
      </div>
    </section>
  );
}