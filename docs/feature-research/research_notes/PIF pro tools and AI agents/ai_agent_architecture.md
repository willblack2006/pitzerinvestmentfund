# State-of-the-art agentic AI system design for investment research (as of 2026-11-13)

Scope note: researched 2026-11-13. Every claim below has a URL. Where a source was a secondary blog or an aggregator, it says so. Where I could not verify something, it is in Gaps. The app context (OpenAI Responses API with strict json_schema, per-call cost logging, `gpt-6-luna`, Nov 12 seven-agent proposal) comes from the assignment, not from a source.

## (a) Architecture patterns: what "state of the art" agent design looks like

### Takeaway
The current consensus from the model vendors is: start with simple, code-defined workflows (chaining, routing, parallelization, evaluator-optimizer) and only use open-ended agents or orchestrator-worker multi-agent setups where the path is unpredictable, because multi-agent runs use roughly 15x the tokens of chat. The building blocks that matter in late 2026 are tool design, MCP connectors (now with a stateless core and OAuth-based auth), programmatic tool calling inside a code sandbox, native citations, prompt caching and batch.

### Cited Findings

**Workflow vs agent patterns (Anthropic, "Building effective agents")**
- Anthropic separates "workflows" (LLMs and tools run through predefined code paths) from "agents" (LLMs that direct their own process and tool use in a loop based on environment feedback). Named workflow patterns: prompt chaining, routing, parallelization (sectioning or voting), orchestrator-workers, evaluator-optimizer. Source: [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Core advice: find the simplest solution possible and add complexity only when it demonstrably improves outcomes; often optimizing single LLM calls is enough. Frameworks can obscure prompts and responses; start with LLM APIs directly. Source: [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- "Agent-computer interface": put as much effort into tool design as into a human UI; tool descriptions should include example usage, edge cases, input requirements; "poka-yoke" tools so mistakes are harder (their example: requiring absolute file paths removed a class of errors). Source: [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

**Orchestrator-worker multi-agent research (Anthropic Research feature)**
- Architecture: a lead agent (Claude Opus 4 at the time) plans and spawns subagents (Claude Sonnet 4) that search in parallel, each with its own context window, returning condensed findings. The lead saves its plan to memory because context beyond 200,000 tokens gets truncated. A separate CitationAgent receives the documents and report and places citations. Source: [Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Reported numbers: multi-agent beat single-agent Opus 4 by 90.2% on their internal research eval; on BrowseComp token usage alone explained about 80% of performance variance (95% together with tool-call count and model choice); agents use about 4x the tokens of chat and multi-agent systems about 15x; parallelization cut research time by up to 90% on complex queries. Source: [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Effort-scaling rules embedded in prompts: 1 agent with 3-10 tool calls for simple facts, 2-4 subagents for comparisons, more than 10 subagents for complex research. Subagents need explicit objective, output format, tool guidance and task boundaries, or they duplicate work. Rewriting a flawed tool description with a testing agent cut task completion time by 40%. Source: [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Production lessons: agents are stateful and errors compound, so resume from checkpoints rather than restart; let agents adapt when tools fail plus retry logic; full production tracing; "rainbow deployments" to shift traffic gradually; synchronous subagent execution is a bottleneck. Source: [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)

**Model Context Protocol (MCP)**
- The MCP spec revision dated 2026-07-28 has an authorization page stating authorization is OPTIONAL for implementations, and that clients MUST use OAuth 2.0 Protected Resource Metadata for authorization server discovery. Source: [MCP spec 2026-07-28: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- Per the MCP blog and secondary coverage, the 2026-07-28 release drops the protocol-level session (no initialize handshake), so remote servers can sit behind ordinary round-robin load balancers; servers that need state should mint an explicit handle from a tool and have the model pass it back. Source: [MCP blog 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/); [MLOps Community summary (secondary)](https://home.mlops.community/public/blogs/mcp-2026-07-28-stateless-core-enterprise-authorization-and-sdk-betas)
- OpenAI Responses API supports remote MCP servers via `server_url` (Streamable HTTP or HTTP/SSE), or local servers via a tunnel; OpenAI's docs warn a malicious MCP server can exfiltrate sensitive data from anything in the model's context. Source: [OpenAI: Connectors and MCP servers](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) (seen as search snippet only)
- Financial data vendors now expose MCP: S&P opened Capital IQ Pro to outside AI agents through MCP servers built with Kensho (March 2026, per trade press). Source: [A-Team Insight (secondary)](https://a-teaminsight.com/blog/sp-global-bets-on-agent-native-architecture-as-capital-iq-pro-consolidation-accelerates/?brand=ati)

**OpenAI Agents SDK**
- Official docs index describes guardrails as validators that run alongside the agent loop, handoffs as a specialized tool call to transfer control between agents, and built-in tracing of agent runs. Source: [OpenAI Agents SDK docs index](https://openai.github.io/openai-agents-python/llms.txt)
- One practitioner blog notes the built-in tracer writes to OpenAI's platform, not yours. Source: [DEV Community (secondary)](https://dev.to/gabrielanhaia/the-openai-agents-sdk-in-production-what-it-gives-you-and-what-it-hides-16a9)

**Programmatic tool calling / code sandbox (Anthropic)**
- Programmatic tool calling lets Claude write code inside the code execution container that calls your tools, instead of a model round trip per tool call; intermediate results are not loaded into Claude's context window. Enabled by adding `allowed_callers: ["code_execution_20260120"]` to a tool definition; requires `code_execution_20260120` or later. Status: stable; supported on Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.x and others. Not ZDR-eligible (data retained up to 30 days). Source: [Claude docs: Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- `allowed_callers` is not a hard API-level block on direct calls; the client should still handle a direct `tool_use` for any tool it defines. Source: [Claude docs: Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)

**Citations (Anthropic)**
- Citations are stable and supported on all active models. Location types: `char_location` (plain text), `page_location` (PDF), `content_block_location` (custom content), plus `search_result` blocks. Source: [Claude docs: Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- Stated benefits: `cited_text` does not count toward output tokens (nor input tokens when passed back); citations "are guaranteed to contain valid pointers to the provided documents"; in Anthropic's evaluations the feature is "significantly more likely to cite the most relevant quotes" than prompt-based approaches. Source: [Claude docs: Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- Important constraint: "Citations and structured outputs are incompatible." Enabling citations on any document plus `output_config.format` errors, because citations interleave citation blocks with text. Source: [Claude docs: Citations](https://platform.claude.com/docs/en/build-with-claude/citations)

**Memory for trading/research agents (research literature)**
- FinMem (Stevens Institute, arXiv 2311.13743; ICLR 2024 workshop listing; later IEEE Transactions on Big Data) uses a profiling module (background and risk attitude), a memory module combining working memory with layered long-term memory sorted by recency/importance, and a decision module. Source: [FinMem arXiv](https://arxiv.org/pdf/2311.13743.pdf); [author page](https://suchow.io/finmem/)

### Inferences
- For PIF, most of the Nov 12 agents (Triage, Earnings, Editor weekly memo, Today recap) fit Anthropic's "workflow" category (routing plus chaining plus parallelization), not open-ended agents. Only Scout, Red team and Ask PIF chat need a real tool-use loop. Building them as code-defined workflows keeps cost predictable on a $7.25/mo Render box.
- An orchestrator-worker setup is worth it only for "deep research on a new name" style tasks, given the ~15x token multiplier. Use a cheap model for workers and a stronger model for the lead and the final editor, which mirrors Anthropic's Opus-lead/Sonnet-worker split.
- The events table plus rules-based router from the Nov 12 proposal is the "routing" workflow. Adding a checkpointed job record per agent run (state, step, tool calls, cost) gives the resume-from-checkpoint and tracing properties Anthropic describes.
- Because Anthropic citations cannot be combined with structured outputs, a filing brief that needs both cited quotes and strict JSON would need two passes (a cited prose pass, then a JSON extraction pass over that output) or prompt-based quote fields plus server-side verification that each quote appears verbatim in the filing text.
- Exposing PIF's own data (holdings, theses, filings cache, 13F, congress trades) as an MCP server would let the same tools be used by the in-app agents, Claude Code, and the Responses API remote MCP tool. Under the 2026-07-28 stateless core this is a plain HTTP service.

### Gaps
- I did not fetch the Claude Agent SDK docs, the Anthropic "skills" docs, Claude Managed Agents docs, or the tool search / `defer_loading` docs, so I cannot state their current features from a source. (The pricing page confirms Claude Managed Agents exists and bills session runtime; see section d.)
- No quantitative token/latency savings numbers for programmatic tool calling appeared in the part of the doc I extracted.
- No source fetched on knowledge-graph memory for per-holding memory, or on RAG vs long-context beyond FinanceBench (section b).
- OpenAI computer use and Anthropic computer use docs were not fetched.
- MCP 2026-07-28 finality: secondary sources conflict on whether it was a release candidate or final; check the spec changelog.

## (a2) Current model lineup and pricing (official pages)

### Takeaway
Anthropic's current lineup on the official pricing page includes Claude Fable 5.2 ($8/$40 per MTok), Opus 5.5 ($4/$20), Sonnet 5.5 ($2/$10) and Haiku 5.5 ($0.10/$0.50 up to 100K-token prompts). OpenAI's official pricing page lists gpt-6-luna at $0.10 input / $0.01 cached / $0.50 output per 1M tokens, so the app's current model is the cheapest tier and is priced the same as Haiku 5.5 for short prompts. Both vendors give 50% off for batch.

### Cited Findings

**Anthropic (per MTok, standard)** : all from [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
| Model | Input | 5m cache write | 1h cache write | Cache hit | Output | Batch in / out |
|---|---|---|---|---|---|---|
| Claude Fable 5.2 | $8 | $10 | $16 | $0.20 | $40 | $4 / $20 |
| Claude Mythos 5.2 (limited availability) | $8 | $10 | $16 | $0.20 | $40 | $4 / $20 |
| Claude Opus 5.5 | $4 | $5 | $8 | $0.20 | $20 | $2 / $10 |
| Claude Sonnet 5.5 | $2 | $2.50 | $4 | $0.10 | $10 | $1 / $5 |
| Claude Sonnet 5 | $2 | $2.50 | $4 | $0.20 | $10 | $1 / $5 |
| Claude Haiku 5.5 (prompts up to 100,000 tokens) | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 | $0.05 / $0.25 |
| Claude Haiku 5.5 (prompts over 100,000 tokens) | $0.50 | $0.625 | $1 | $0.05 | $2.50 | $0.25 / $1.25 |
| Claude Haiku 4.5 | $1 | $1.25 | $2 | $0.10 | $5 | $0.50 / $2.50 |

- Cache hits on Opus 5.5 and Sonnet 5.5 are 0.05x base input; on Fable/Mythos 5.2 and 5.1, 0.025x; all other models 0.1x. Multipliers stack with batch and data residency. Source: [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Batch API: 50 percent discount on input and output. Source: [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Long context: Claude 4.6 and later models (except Haiku 5.5) include the full 1M-token context window at standard pricing; Haiku 5.5 is priced higher when the prompt (including cache reads/writes) exceeds 100,000 tokens. Source: [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- US-only inference (`inference_geo: "us"`) is a 1.1x multiplier for 4.6+ models. Source: [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Fast mode output-premium rows listed: Opus 5.5 $8/$40, Fable 5.2 $16/$80; fast mode is not available with Batch. Source: [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Server tools: web search $10 per 1,000 searches plus tokens; web fetch no extra charge beyond tokens; code execution is free when used with `web_search_20260209`/`web_fetch_20260209` or later, otherwise billed by container time with usage beyond 1,550 hours at $0.05 per hour per container. Source: [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Tool-use system prompt overhead listed as 286 tokens for Opus 5.5, Sonnet 5.5 and Haiku 5.5. Source: [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)

**OpenAI (per 1M tokens, standard, short context ≤272K input)** : from [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
| Model | Input | Cached input | Output | Batch/Flex in / out |
|---|---|---|---|---|
| gpt-6-astra | $10.00 | $1.00 | $50.00 | $5.00 / $25.00 |
| gpt-6.1-sol | $2.00 | $0.10 | $10.00 | $1.00 / $5.00 |
| gpt-6-sol | $2.00 | $0.20 | $10.00 | $1.00 / $5.00 |
| gpt-6.1-terra | $1.00 | $0.05 | $5.00 | $0.50 / $2.50 |
| gpt-6-luna | $0.10 | $0.01 | $0.50 | $0.05 / $0.25 |

- Older listed: gpt-5.6-sol $4.00/$0.40/$20.00; gpt-5.6-terra $2.00/$0.20/$12.00; gpt-5.6-luna $0.20/$0.02/$1.20; gpt-5.5 $5.00/$0.50/$30.00. Source: [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- Tools: web search $10.00 per 1k calls plus content tokens; file search $0.10/GB/day storage (1 GB free) and $2.50 per 1k calls; containers (Code Interpreter / Hosted Shell) $0.03 (1 GB) to $1.92 (64 GB) per 20-minute session, but the page also says eligible sessions are billed by the minute with a 5-minute minimum, so the billing unit is ambiguous on the page itself. Source: [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- A third-party source reports gpt-6-astra long-context (>272K input) pricing at 2x input and 1.5x output; not confirmed on the official page in my fetch. Source: [eesel.ai (secondary)](https://www.eesel.ai/blog/gpt-6-astra-pricing)

### Inferences
- gpt-6-luna and Haiku 5.5 have identical short-prompt list prices ($0.10/$0.50), so a provider switch for cheap triage work is not a cost decision; it is a feature decision (Anthropic citations, programmatic tool calling vs OpenAI strict json_schema the app already uses).
- A sensible tiering: Haiku 5.5 or gpt-6-luna for triage/classification; Sonnet 5.5 or gpt-6.1-sol ($2/$10 both) for briefs and the red team; Opus 5.5 ($4/$20) only for the weekly memo editor or deep research lead. Fable 5.2 at $8/$40 is hard to justify for a student fund budget.
- Watch the Haiku 5.5 100,000-token threshold: a full 10-K in one prompt can cross it and pay 5x.

### Gaps
- I did not find official model-card capability or benchmark claims for Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.2 or gpt-6-luna.
- openai.com/api/pricing returned 403; numbers above are from developers.openai.com, which is OpenAI's own domain.

## (b) Evidence on what LLMs and agents can and cannot do in finance

### Takeaway
On realistic filing-research tasks, the best published agent score is around 64% (Vals AI Finance Agent, June 2026 update, Claude Opus 4.7), so roughly a third of entry-level analyst tasks still fail. Retrieval design dominates accuracy on filings (FinanceBench: 19% correct with a shared vector store vs 79% with the whole filing in long context, for the same model). Return-prediction results exist (Lopez-Lira and Tang; Kim, Muhn and Nikolaev) but backtests are exposed to look-ahead and "distraction" bias.

### Cited Findings

**Vals AI Finance Agent Benchmark**
- Version 1.1, page updated 6/4/2026. 537 questions (50 public validation, 150 private validation, 337 test); results on Test. Built with Stanford researchers, a Global Systemically Important Bank and industry experts; v1.1 QC by AfterQuery using finance experts from firms including Goldman Sachs, Silver Lake and Citadel. Tasks are SEC-filing research (Quantitative Retrieval, Trends, Financial Modeling, etc.). Tools: EDGAR search, Google search (Tavily in v1.1), ParseHTML, RetrieveInformation. Source: [Vals AI Finance Agent](https://www.vals.ai/benchmarks/finance_agent)
- Top 5 as listed: Claude Opus 4.7 64.37% ($0.80/test, 4m31s); Claude Sonnet 4.6 63.33% ($1.44, 5m49s); Muse Spark 60.59% (no cost, 6m58s); DeepSeek V4 60.39% ($0.59, 9m48s); Claude Opus 4.6 (Thinking) 60.05% ($1.11, 4m50s). Source: [Vals AI Finance Agent](https://www.vals.ai/benchmarks/finance_agent)
- Anthropic's May 5, 2026 finance post cites the same 64.37% for Opus 4.7. Source: [Anthropic: finance agents](https://www.anthropic.com/news/finance-agents)

**FinanceBench (Patronus AI et al., arXiv 2311.11944)**
- 10,231 open-book questions about public companies with answers and evidence strings; 16 configurations tested on a 150-case sample with manual review (n=2,400). Abstract: GPT-4-Turbo with a retrieval system "incorrectly answered or refused to answer 81% of questions." Source: [FinanceBench arXiv](https://arxiv.org/abs/2311.11944)
- Table 2 (150 cases): GPT-4-Turbo closed book 9% correct / 3% incorrect / 88% failed to answer (the counts 14+5+126 sum to 145, so this row looks internally inconsistent); shared vector store GPT-4-Turbo 19% / 13% / 68%; Llama 2 shared 19% / 70% / 11%; single vector store GPT-4-Turbo 50% / 11% / 39%; Llama 2 single 41% / 54% / 5%; long context GPT-4-Turbo 79% / 17% / 4%; Claude 2 long context 76% / 21% / 3%; Oracle GPT-4-Turbo 85% / 15% / 0%. Source: [FinanceBench full text](https://arxiv.org/html/2311.11944)

**Kim, Muhn, Nikolaev, "Financial Statement Analysis with Large Language Models" (Chicago Booth, arXiv 2407.17866)**
- Using only standardized, anonymized statements, GPT-4 with a chain-of-thought prompt reached about 60% accuracy predicting the direction of future earnings, on par with a purpose-trained ANN (about 60%), and above the median analyst range reported as roughly 53-57%. A simple prompt performed closer to analysts. Some sources name the model "GPT 4.0 Turbo". Source: [arXiv 2407.17866](https://arxiv.org/abs/2407.17866v2); [CLS Blue Sky Blog](https://clsbluesky.law.columbia.edu/2024/09/16/will-large-language-models-propel-financial-statement-analysis-into-a-new-era/?amp=1) (numbers via search summary; I did not read the tables)

**Lopez-Lira and Tang, "Can ChatGPT Forecast Stock Price Movements?" (arXiv 2304.07619, v6 Oct 2025)**
- ChatGPT headline scores predict out-of-sample daily returns and subsume traditional sentiment methods; predictability stronger for smaller stocks and after negative news; GPT-1, GPT-2 and BERT cannot forecast returns; ChatGPT-4 long-short has the highest Sharpe; v6 covers headlines for 4,123 firms and reports strategy returns decline as LLM adoption rises. Source: [arXiv 2304.07619](https://arxiv.org/abs/2304.07619v5); [v6 PDF](https://arxiv.org/pdf/2304.07619v6) (via search summary; exact Sharpe values not verified)

**Look-ahead and distraction bias**
- Glasserman and Lin (arXiv 2309.17322) separate look-ahead bias (model knows subsequent returns) from a "distraction effect" (general company knowledge distorts sentiment). Anonymizing company identifiers in headlines improved GPT-3.5 in-sample trading performance, implying distraction outweighed look-ahead bias, most strongly for large companies; out-of-sample, look-ahead bias is not a concern but distraction may remain. Source: [arXiv 2309.17322](https://arxiv.org/abs/2309.17322)
- Sarkar and Vafa, "Lookahead Bias in Pretrained Language Models": propose tests such as whether a model can "predict" an unpredictable event; tests are one-sided and may not detect all leakage. Source: [search result pointing to Sarkar and Vafa paper via NBER conference](https://conference.nber.org/conf_papers/f205530/f205530.pdf) (I did not confirm which URL is the Sarkar-Vafa paper itself; see Gaps)
- He et al., ChronoBERT/ChronoGPT (arXiv 2502.21206): models trained with knowledge cutoffs 1999-2024; real-time outputs give Sharpe ratios comparable to a much larger Llama model, suggesting look-ahead bias is modest for news-based return prediction, but impact is model- and application-specific. Source: [arXiv 2502.21206](https://arxiv.org/html/2502.21206v2)
- A 2026 paper, Look-Ahead-Bench, reports standard LLMs show significant look-ahead bias (alpha decay) while point-in-time models do not. Source: [arXiv 2601.13770](https://arxiv.org/pdf/2601.13770) (via search summary)

**Multi-agent trading papers**
- TradingAgents (Xiao, Sun, Luo, Wang; arXiv 2412.20138, v6 Apr 2025) models a trading firm: fundamental, sentiment, technical analysts; bull and bear researchers; traders with different risk profiles; risk management team; fund manager. Reports better cumulative return, Sharpe and max drawdown than baselines on historical backtests; code at TauricResearch/TradingAgents. A Hugging Face comment questions out-of-backtest validity. Source: [arXiv 2412.20138](https://arxiv.org/html/2412.20138v4); [HF papers](https://huggingface.co/papers/2412.20138)
- FinMem reports outperforming algorithmic baselines on cumulative return and Sharpe on a real-world stock dataset. Source: [FinMem arXiv](https://arxiv.org/pdf/2311.13743.pdf)

### Inferences
- The FinanceBench gap (19% shared vector store vs 79% long context vs 85% oracle for one model) says per-document scoping matters more than model choice. For PIF: always retrieve within the specific filing (single-document scope) or pass the whole relevant section in long context; never run a cross-company shared vector index for filing Q&A. With 1M context at standard price on Sonnet/Opus 5.5, full-filing context is affordable for occasional deep reads, especially with caching.
- The 64% ceiling on Vals means any agent output that states a number from a filing needs a verification step (quote match or XBRL cross-check) before it shows as fact.
- The "Red team" and "Thesis checker" agents mirror TradingAgents' bull/bear debate, but the evidence for the debate structure improving returns is backtest-only. Position them as research aids, not signals.
- Any PIF backtest of an LLM signal (e.g., news triage score vs next-day return) should anonymize tickers/company names (Glasserman-Lin) and restrict to dates after the model's training cutoff.

### Gaps
- BizBench, FinQA, TAT-QA and SEC-QA: not fetched; no numbers to report.
- FinRobot and FinGPT: search did not return usable sources.
- Hallucination rates on filings for 2026-generation models: no source found beyond FinanceBench (2023 models) and Vals.
- Vals leaderboard last updated 6/4/2026, so it does not show Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2 or gpt-6 models; I found no official score for them.
- Exact Sharpe ratios for TradingAgents, Lopez-Lira-Tang, and the Sarkar-Vafa paper's primary URL were not verified.

## (b2) Commercial AI analyst products 2024-2026

### Takeaway
The commercial pattern is the same everywhere: licensed data exposed to the model through connectors (increasingly MCP), prebuilt task agents (earnings review, comps, memos), outputs into Excel/PowerPoint, and per-cell or per-sentence source links. Anthropic now ships ten finance agent templates plus Office add-ins and connectors to FactSet, S&P Capital IQ, MSCI, PitchBook, Morningstar, LSEG, Daloopa and others.

### Cited Findings
- **Anthropic, Claude for Financial Services (May 5, 2026 update):** ten ready-to-run finance agents as Claude Cowork/Claude Code plugins and Claude Managed Agents cookbooks: Pitch builder, Meeting preparer, Earnings reviewer, Model builder, Market researcher, Valuation reviewer, General ledger reconciler, Month-end closer, Statement auditor, KYC screener. Claude for Excel, PowerPoint and Word GA. New connectors: Dun & Bradstreet, Fiscal AI, Financial Modeling Prep, Guidepoint, IBISWorld, SS&C Intralinks, Third Bridge, Verisk; existing: FactSet, S&P Capital IQ, MSCI, PitchBook, Morningstar, Chronograph, LSEG, Daloopa; Moody's MCP app (600 million+ companies). Source: [Anthropic: finance agents](https://www.anthropic.com/news/finance-agents)
- The original July 2025 launch included MCP connectors to PitchBook, S&P Global (Capital IQ financials, transcripts), Daloopa (KPIs from filings), FactSet (pricing, fundamentals, consensus) and Morningstar. Source: [Anthropic: Advancing Claude for Financial Services](https://www.anthropic.com/news/advancing-claude-for-financial-services?pp=iaqb); [PPC Land (secondary)](https://ppc.land/anthropic-unveils-comprehensive-financial-analysis-platform-with-claude/)
- **Bloomberg ASKB:** conversational AI interface launched in beta for Terminal subscribers on February 23, 2026 (per trade press); an April 16 roadmap says expert-suggested ASKB questions will appear inside Terminal functions. Source: [The TRADE](https://thetradenews.com/bloomberg-embeds-agentic-ai-into-the-terminal); [Markets Media](https://www.marketsmedia.com/bloomberg-introduces-agentic-ai-to-the-terminal/)
- **S&P Capital IQ Pro / Kensho:** Capital IQ Pro opened to outside agents via MCP servers built with Kensho; ChatIQ is its conversational interface on Capital IQ Pro data. Source: [A-Team Insight (secondary)](https://a-teaminsight.com/blog/sp-global-bets-on-agent-native-architecture-as-capital-iq-pro-consolidation-accelerates/?brand=ati); [WatersTechnology](https://www.waterstechnology.com/data-management/7951295/sp-tests-chatiq-genai-search-tool-in-revamped-capiq-desktop)
- **AlphaSense:** custom AI agents and AI-led expert calls (March 2026 report); June 2026 release notes mention Organizational Agents and an Intralinks VDRPro connection; Deep Research mode automates investment-grade analysis. Source: [IT Brief](https://itbrief.news/story/alphasense-adds-custom-ai-agents-for-finance-research); [AlphaSense product releases](https://www.alpha-sense.com/resources/product-articles/product-releases-2025)
- **Hebbia Matrix:** spreadsheet-style agent interface that runs a question across hundreds or thousands of documents, extracting and sourcing answers cell by cell; has a "Deeper Research Agent". Source: [Hebbia (vendor)](https://www.hebbia.com/resources/financial-research-platforms) (vendor/competitor-sourced summary)
- **Rogo:** agents produce Excel models, investment memos, diligence materials and decks from firm and market data, for IB, PE, asset and wealth management. Source: [AllMind comparison (competitor-sourced)](https://allmind.ai/research/ai-equity-research-platforms-compared-2026)

### Inferences
- PIF cannot license FactSet/CapIQ, but the open equivalents it already uses (EDGAR, XBRL, 13F, congressional disclosures) can be wrapped the same way: tools with narrow, well-described inputs. Financial Modeling Prep is in Anthropic's connector list and is a lower-cost data source worth checking.
- Hebbia's per-cell sourcing is the UX to copy for a "compare holdings" matrix (rows = holdings, columns = questions, each cell = answer + quote + link).

### Gaps
- FactSet Mercury / FactSet AI agents, Brightwave, Fintool and OpenAI's financial-services offerings: no reliable source found in this pass.
- Bloomberg and S&P details are from trade press, not their official pressrooms.

## (c) Evaluation and guardrails

### Takeaway
Start with a small golden set (about 20 real queries is enough to see large effects), score outcomes with an LLM judge on a rubric that includes citation accuracy, and add humans for what automation misses. Treat every filing, news article and web page as untrusted input (indirect prompt injection), keep privileged actions in code, and require human approval for anything that changes holdings or sends anything.

### Cited Findings
- Anthropic began evaluating its research agent with about 20 real-usage queries, because large effect sizes show up in small samples. Their LLM judge used one prompt returning a 0.0-1.0 score plus pass/fail over factual accuracy, citation accuracy, completeness, source quality and tool efficiency, which matched human judgment best. Judge outcomes, not exact steps. Human testers caught agents preferring SEO content farms over authoritative sources. Source: [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- OWASP LLM01 defines direct injection (user input) vs indirect injection (external content such as a webpage or file containing instructions). Mitigations: constrain model behavior in the system prompt; validate output formats with deterministic code; filter inputs/outputs and check groundedness; least privilege (privileged functions handled in code, not by the model); human approval for high-risk actions; segregate and label untrusted content; adversarial testing. Source: [OWASP GenAI: LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- OpenAI warns a malicious MCP server can exfiltrate sensitive data from anything that enters the model's context. Source: [OpenAI: Connectors and MCP](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- OpenAI Agents SDK guardrails run as validators alongside the agent loop. Source: [OpenAI Agents SDK docs index](https://openai.github.io/openai-agents-python/llms.txt)
- Anthropic citations guarantee valid pointers into supplied documents (so quote existence is checkable), but cannot be combined with structured outputs. Source: [Claude docs: Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- FinanceBench's "oracle" configuration (evidence page given) still had 15% incorrect for GPT-4-Turbo, showing errors persist even with the right text in hand. Source: [FinanceBench full text](https://arxiv.org/html/2311.11944)

### Inferences
- PIF golden set: 20-50 questions per agent drawn from real holdings (e.g., "What was X's FY2025 segment revenue?", "Did the 10-K add a new risk factor about Y?"), each with the answer and an evidence quote. Run on every prompt or model change; store results in the DB next to cost.
- Numeric grounding rule: numbers come from XBRL/structured data computed in code; the LLM only narrates. Any number in LLM output that does not match a tool result or a verbatim quote gets flagged in the UI.
- Quote verification: for every quote field in a json_schema brief, check server-side that the string appears in the cached filing text (normalized whitespace). Drop or flag misses. This works today with the OpenAI path, no provider switch needed.
- Prompt-injection posture: filings, news and congress-trade text are wrapped and labeled as untrusted data; agents that read them get read-only tools only; any write (thesis change, paper trade, notification blast) goes through an approval queue.

### Gaps
- No finance-specific published LLM-as-judge calibration study found.
- No source on per-member rate-limit design for student apps; that is a design choice, not a finding.

## (d) Cost and latency control

### Takeaway
The big levers are model tiering, prompt caching (cache hits now 0.05x input on Opus/Sonnet 5.5 and 0.1x or less elsewhere), batch (50% off on both vendors), programmatic tool calling (keeps intermediate tool output out of context), and avoiding multi-agent fan-out except where it pays.

### Cited Findings
- Multi-agent systems use about 15x the tokens of chat, and agents about 4x; token usage explained about 80% of BrowseComp variance. Source: [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Anthropic Batch: 50% off; OpenAI Batch/Flex for GPT-6 variants: half of Standard. Source: [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing); [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- Cache hit pricing: Opus 5.5 and Sonnet 5.5 at 0.05x base input; 5m cache writes cost $5 vs $4 base on Opus 5.5 (1h writes $8). Source: [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- OpenAI cached input on gpt-6-luna is $0.01 vs $0.10 uncached. Source: [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- Programmatic tool calling avoids a model round trip per tool call and keeps intermediate results out of Claude's context. Source: [Claude docs: Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- Anthropic code execution is free when used with the 2026-02-09-or-later web search/fetch tools. Source: [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- On Vals, cost per test ranged from $0.59 (DeepSeek V4) to $1.44 (Sonnet 4.6) among the top five, with 4.5-10 minutes per task. Source: [Vals AI Finance Agent](https://www.vals.ai/benchmarks/finance_agent)

### Inferences
- Overnight jobs (10-K change briefs, weekly memo drafts, 13F digests) belong on the Batch API: same output at half price, and nobody waits for them.
- Put the stable part of each prompt (system prompt, fund policy, holdings list, schema) first so it caches; put the changing filing/news text last.
- A Vals-style agentic research task costs on the order of a dollar and several minutes per question on frontier models. A per-member daily budget (e.g., N deep-research runs/day) and a fund-wide monthly cap enforced from the existing cost log are needed before opening Ask PIF to all members.

### Gaps
- No vendor-published latency numbers (time to first token, tokens/sec) for the 5.5 or gpt-6 models were fetched.

## (e) Agent UX patterns and reference systems

### Takeaway
The patterns that recur in shipped products and Anthropic's own system are: inline citations that point to exact passages, a separate citation step, visible plans/traces, per-cell sourcing in matrix views, and long-running jobs that resume from checkpoints. Open-source references are TradingAgents (multi-role debate) and FinMem (layered memory); commercial references are Anthropic's ten finance agent templates, Hebbia Matrix, AlphaSense Deep Research and Bloomberg ASKB.

### Cited Findings
- Anthropic's research system uses a dedicated CitationAgent after research completes. Source: [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Anthropic recommends making the agent's planning steps explicit (transparency). Source: [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Citations API returns `cited_text` plus character/page/block locations, which supports click-to-source UI. Source: [Claude docs: Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- Hebbia Matrix sources answers cell by cell across many documents. Source: [Hebbia (vendor)](https://www.hebbia.com/resources/financial-research-platforms)
- Anthropic notes synchronous subagents block and lists async execution as an improvement; it resumes long runs from checkpoints. Source: [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Open-source: TradingAgents code at GitHub TauricResearch/TradingAgents. Source: [arXiv 2412.20138](https://arxiv.org/html/2412.20138v4)
- Anthropic's finance agents are published as plugins and Claude Managed Agents cookbooks (reference implementations). Source: [Anthropic: finance agents](https://www.anthropic.com/news/finance-agents)

### Inferences
- For PIF: every agent output card shows (1) claim, (2) quote with link to the filing section, (3) "verified" badge if the quote matched server-side, (4) model, cost and run time, (5) Accept / Override / Discard buttons that write to an audit log. Confidence should come from checks (quote matched, number matched XBRL) rather than the model's self-rating.
- Long jobs (deep research on a new name, weekly memo) run as background jobs with a status row and a notification when done, matching Render's single-process constraint.
- Anthropic's "Earnings reviewer" and "Market researcher" templates are the closest public reference designs for PIF's Earnings and Scout agents and are worth reading before building.

### Gaps
- No published user research on confidence displays or accept/override rates for finance agents was found.
- FinRobot and FinGPT repositories were not verified in this pass.
