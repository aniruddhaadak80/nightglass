import { site } from "@/config/site";
import { DEFAULT_SITE, todayFor } from "@/app/api/briefing/route";
import { AgentConsole } from "@/components/agent-console";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Agent",
  description:
    "A live MCP JSON-RPC 2.0 endpoint with eight tools: read a night, search the catalogue, score an object, create plans, decide targets and log observations.",
};

const ENDPOINT = `${site.url}/api/mcp`;

export default function AgentPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="gutter">
        <p className="plate-caption">Agent</p>
        <h1 className="font-display mt-1 text-4xl text-bone-100">An agent that can actually plan a night</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-300">
          This is not a mock. The calls below hit{" "}
          <code className="text-brass-300">POST {ENDPOINT}</code> over JSON-RPC 2.0 and run the same
          service functions the browser UI uses, including the mutations.
        </p>
      </header>

      <div className="plate mt-6 p-4">
        <p className="plate-caption">Connect an MCP client</p>
        <p className="mt-1 text-sm text-bone-300">
          A ready-made manifest is published at{" "}
          <a
            href="/mcp.json"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brass-300 underline underline-offset-2"
          >
            /mcp.json
          </a>
          .
        </p>
        <pre className="plate-inset mt-3 overflow-x-auto p-3 text-[0.7rem] leading-relaxed text-bone-300">
{`{
  "mcpServers": {
    "nightglass": {
      "type": "http",
      "url": "${ENDPOINT}"
    }
  }
}`}
        </pre>
      </div>

      <AgentConsole endpoint="/api/mcp" today={todayFor(DEFAULT_SITE.longitudeDeg)} />

      <section className="mt-10">
        <h2 className="plate-caption">How the agent is scoped</h2>
        <div className="plate mt-3 p-4 text-sm leading-relaxed text-bone-300">
          <p>
            There are no accounts. An agent calling this endpoint shares the anonymous session of
            whatever browser made the first request, via the same HTTP-only scope cookie. It can only
            read and mutate plans and observations belonging to that session; another session&rsquo;s
            rows return <code className="text-brass-300">404</code>, not <code>403</code>, so ids
            cannot be probed.
          </p>
          <p className="mt-3">
            Mutating tools are idempotent where that is meaningful: a repeated{" "}
            <code>log_observation</code> for the same object and date returns the existing entry
            rather than creating a second one, and <code>create_plan</code> honours an{" "}
            <code>idempotencyKey</code>.
          </p>
        </div>
      </section>
    </div>
  );
}