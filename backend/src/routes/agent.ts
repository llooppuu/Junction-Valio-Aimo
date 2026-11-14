import { Router } from "express";
import { helsinkiDate } from "../services/dates.js";
import { z } from "zod";
import type { AgentModel } from "../agent/model.js";
import { cancelAgentRun, startAgentRun, type AgentRun } from "../agent/runner.js";
import { currentPrincipal, requireRole } from "../auth.js";
import { ApiError, parseOr400 } from "../http.js";
import type { Store } from "../store.js";

export const startRunSchema = z.strictObject({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().min(1).optional(),
  /** Which kitchen's agent acts. A follow-up keeps its conversation's agent. */
  agentId: z.string().min(1).optional(),
  /** The language the buyer reads, so the agent replies in it. English by default. */
  language: z.enum(["en", "fi"]).optional(),
  /** "list_photo": the message is a list read from a photo. The agent restates it and asks the buyer to confirm before acting. */
  kind: z.enum(["request", "list_photo"]).optional(),
});

const NOT_CONFIGURED =
  "The AI agent is not configured. Set GEMINI_API_KEY or OPENAI_API_KEY in .env and restart the backend. Everything else works without it.";

/**
 * Lets the buyer hand a request to the AI agent. The agent then acts through
 * the public API with its own token, so the buyer never lends it buyer rights.
 */
export function agentRouter(store: Store, model: AgentModel | null) {
  const router = Router();
  const buyerOnly = requireRole(store, "buyer");

  router.get("/", requireRole(store, "agent", "buyer"), (_req, res) => {
    res.json({ available: model !== null, model: model?.name ?? null });
  });

  router.post("/runs", buyerOnly, (req, res) => {
    const input = parseOr400(startRunSchema, req.body, res);
    if (!input) return;
    if (!model) throw new ApiError(503, NOT_CONFIGURED);

    // A follow-up keeps the agent its conversation started with.
    const conversationAgent = input.conversationId
      ? store.agent.conversations.get(input.conversationId)?.agentId
      : undefined;
    if (conversationAgent && input.agentId && input.agentId !== conversationAgent) {
      throw new ApiError(409, `Conversation ${input.conversationId} belongs to ${conversationAgent}. Start a new conversation to switch agents.`);
    }
    const agentId = conversationAgent ?? input.agentId;
    const agent = agentId
      ? store.principals.find((principal) => principal.role === "agent" && principal.id === agentId)
      : store.principals.find((principal) => principal.role === "agent");
    if (!agent) throw new ApiError(agentId ? 404 : 500, agentId ? `Unknown agent "${agentId}".` : "No agent principal is configured.");

    // The agent calls this same server over HTTP, on the port this request arrived on.
    const { run } = startAgentRun(
      {
        store,
        model,
        api: { baseUrl: `http://127.0.0.1:${req.socket.localPort}/api`, token: agent.token },
        requester: currentPrincipal(res),
        agent,
        today: helsinkiDate(store.clock()),
      },
      input,
    );
    res.status(202).json({ run });
  });

  router.get("/runs", buyerOnly, (_req, res) => {
    const runs: AgentRun[] = [...store.agent.runs.values()].reverse();
    res.json({ runs });
  });

  router.get("/runs/:id", buyerOnly, (req, res) => {
    const run = store.agent.runs.get(String(req.params.id));
    if (!run) throw new ApiError(404, `Unknown agent run "${String(req.params.id)}".`);
    res.json({ run });
  });

  // The buyer changed their mind while the agent was working.
  router.post("/runs/:id/cancel", buyerOnly, (req, res) => {
    const id = String(req.params.id);
    const run = store.agent.runs.get(id);
    if (!run) throw new ApiError(404, `Unknown agent run "${id}".`);
    if (!cancelAgentRun(store.agent, id)) throw new ApiError(409, `Agent run ${id} has already finished (${run.status}).`);
    res.json({ run });
  });

  return router;
}
