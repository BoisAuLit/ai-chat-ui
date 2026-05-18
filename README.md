# ai-chat-ui

A working LLM-app playground built in 5 days while pivoting careers from frontend to AI engineering. Three routes, each exercising a different production AI capability.

**🌐 Live:** https://ai-career-radar.vercel.app *(project named pre-rename; chat-ui code, not the AI Career Radar product — different repo)*

## Routes

### `/` · Plain streaming chat
- Multi-model picker — Claude Sonnet 4.6 / Haiku 4.5 / Opus 4.7 (server-side allow-list validation)
- Editable system prompt per message (collapsible panel)
- Streaming Markdown rendering (GFM tables, code blocks, lists)
- Conversation persistence via localStorage; `Stop` button mid-stream; per-message `📋 Copy`
- Error state surfaced from the SSE stream (returns 200 but emits an error event)

### `/rag` · Retrieval-Augmented chat with evals
- **Multi-document** indexing: paste text or upload PDF → server chunks (~1000 chars, paragraph-aware) → OpenAI `text-embedding-3-small` → in-memory cosine retrieval
- Cross-doc query: each retrieved chunk is attributed back to its source doc by hash; UI shows "from N docs" badge
- Inline retrieved-chunks panel for full transparency
- **📊 Run eval** button on each assistant message: 3 parallel Haiku-as-judge calls returning faithfulness · context relevance · answer relevance, with color-coded score cards and the specific quotes the judge flagged

### `/agent` · Claude tool-use with sandboxed tools
- Three real tools, scoped for safety:
  - `calculator` — regex-validated math expressions in a `new Function()` scope (no identifiers reachable)
  - `fetch_url` — public HTTPS only, SSRF block-list (private IPs, `.local`, `.internal`), 5s timeout, 200KB response cap, 15K char output cap
  - `search_indexed_doc` — cosine search the latest /rag-indexed doc (reuses the RAG infra)
- `streamText({ tools, stopWhen: stepCountIs(8) })` — bounded agent loop
- Per tool call: collapsible UI block shows state badge (preparing → calling → done/error), input JSON, output JSON, error text

## Why this exists

I'm a 7-year frontend engineer (mostly Angular) pivoting into AI engineering. The fastest way to prove "I can build LLM applications" was to actually build one across the four most-cited skill categories in the AI Career Radar corpus's `agent_engineering` archetype:

| Report B gap | % of agent_engineering JDs | Closed by |
|---|---|---|
| LLM API + prompt engineering | 51% | `/` |
| RAG | 44.7% | `/rag` |
| LLM evaluation | 34% | `/rag` Run Eval button |
| AI agents + tool use | 25.5% | `/agent` |

Built in 5 days. Open about the trade-offs (in-memory state evicts on cold start; ports of `pdfjs-dist` were broken on Vercel — `unpdf` works; specificity-vs-actionability is a real prompt-design tension).

## Stack

- **Next.js 16** (Turbopack, App Router) + **React 19** + **TypeScript** + **Tailwind v4**
- **Vercel AI SDK v6** — `ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` + `@ai-sdk/react`
- **Claude Sonnet 4.6** (generation) + **Claude Haiku 4.5** (LLM-as-judge evals)
- **OpenAI `text-embedding-3-small`** (RAG embeddings)
- **`unpdf`** (serverless-safe PDF extraction)
- **`zod`** (tool input schemas)
- **`react-markdown` + `remark-gfm`** (Markdown rendering)

## Known production trade-offs

- **In-memory RAG store evicts on Vercel cold start.** Documented in `/rag`: "re-index after a cold start." Real fix (Vercel KV / Upstash / Turso SQLite) is paid + deferred until a real user complains.
- **`/api/rag/list` can disagree with `/api/rag/chat`** when Vercel routes the requests to different serverless instances. Same in-memory-state limitation. Surfaced and documented during a live production test.
- **Tool-use loop is capped at 8 steps** to avoid runaway loops. Adjustable in `src/app/api/agent/route.ts`.

## Local development

```bash
git clone git@github.com:BoisAuLit/ai-chat-ui.git
cd ai-chat-ui
npm install
cat > .env.local <<EOF
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
EOF
npm run dev
```

## License

MIT.
