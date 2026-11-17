# AI companions: models, costs and the prototype

Researched 2026-11-17 for Task E (see `docs/ROADMAP.md`). Prices and limits change often: the links in each section are the sources, and `server/ai/prices.js` holds the numbers the game uses for its spend estimate.

## Recommendation (short)

**Try Claude Haiku 5.5 first** (`claude-haiku-5-5`, the default for `AI_PROVIDER=anthropic`).
- It is the cheapest per call for this job. The list price is $0.10 in / $0.50 out per 1M tokens, the same as GPT-6 Luna, but our static system prompt (~750 tokens) is cached at $0.01, which brings it to about **$0.09 per 1,000 calls**.
- At the default settings that is about **$0.015/hour for one companion, $0.05/hour for three and $0.15/hour for ten**.
- It scores highest of the cheap tier on Artificial Analysis's intelligence index (19 vs Luna's 10 at low effort).
- Structured JSON output is generally available and needs no beta header.

**Then GPT-6 Luna** (`gpt-6-luna`).
- It has the same list price, and the fastest measured first token in its non-reasoning mode (1.5 s).
- It costs about $0.16 per 1,000 calls here, because our prompt is too short for OpenAI's cache.
- It has a known structured-output glitch, which the adapter already handles.

**Then Gemini 3.1 Flash-Lite** (`gemini-3.1-flash-lite`).
- It is stable, with minimal thinking by default.
- It costs about 2.6× Haiku: $0.25 / $1.50, about $0.41 per 1,000 calls.
- It has a free tier that's enough to try one companion without spending anything.

**A smarter tier isn't needed for this layer.** The rule-based brain does the fighting, and the model only talks and sets intents.
- To A/B conversation quality, try Claude Sonnet 5.5 or GPT-6.1 Terra. Each costs about $1.6 per 1,000 calls, about $0.3/hour per companion at the default rate.

The default daily cap is `AI_DAILY_USD=1`. That covers about 20 hours of three Haiku companions at the default rate.

## 1. Current models and prices (USD per 1M tokens, standard tier)

| Provider | Fast/cheap tier | In | Out | Cached in | Smarter tier | In | Out | Cached in |
|---|---|---|---|---|---|---|---|---|
| Anthropic | Claude Haiku 5.5 (`claude-haiku-5-5`) | 0.10 | 0.50 | 0.01 (write 0.125) | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | 2 | 10 | 0.10 (write 2.50) |
| OpenAI | GPT-6 Luna (`gpt-6-luna`) | 0.10 | 0.50 | 0.01 | GPT-6.1 Terra (`gpt-6.1-terra`) / GPT-6.1 Sol (`gpt-6.1-sol`) | 1 / 2 | 5 / 10 | 0.05 / 0.10 |
| Google | Gemini 3.1 Flash-Lite (`gemini-3.1-flash-lite`); older Gemini 2.5 Flash-Lite | 0.25; 0.10 | 1.50; 0.40 | 0.025; 0.01 | Gemini 3.5 Flash (`gemini-3.5-flash`) | 1.50 | 9 | 0.15 |

### Anthropic
- **Prices:** [Claude pricing](https://platform.claude.com/en/docs/about-claude/pricing).
  - Haiku 5.5 is $0.10/$0.50 for prompts up to 100k tokens ($0.50/$2.50 above, irrelevant here).
  - Others: Sonnet 5.5 $2/$10, Opus 5.5 $4/$20, Haiku 4.5 $1/$5.
  - The Batch API gives 50% off, but it doesn't suit live chat.
- **Haiku 5.5:** [announcement](https://anthropic.com/news/claude-haiku-5-5).
  - Released 2026-10-07, model ID `claude-haiku-5-5`.
  - Anthropic calls it "our fastest model to date" and the first Haiku with effort levels.
  - Anthropic says it costs about 75% less to run than Haiku 4.5.
  - It is aimed at high-volume, speed-sensitive work such as live support.

### OpenAI
- **Prices:** [OpenAI API pricing](https://developers.openai.com/api/docs/pricing).
  - gpt-6-luna $0.10/$0.50 (cached $0.01), gpt-6.1-terra $1/$5, gpt-6.1-sol $2/$10, gpt-6-astra $10/$50.
  - Cross-checked against [BenchLM](https://benchlm.ai/openai/api-pricing) (synced 2026-11-16) and [Morph](https://morphllm.com/openai-api-pricing).
  - Both also list older models still on sale: gpt-5.4-mini $0.75/$4.50 and gpt-5.4-nano $0.20/$1.25.
- **GPT-6 Luna:** [model page](https://developers.openai.com/api/docs/models/gpt-6-luna).
  - Described as "our most efficient model for focused, high-volume tasks".
  - Reasoning effort `none`…`max` (default `medium`).
  - Streaming, function calling and structured outputs.

### Google
- **Prices:** [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), paid tier, text.
  - 3.5 Flash $1.50/$9, 3.1 Flash-Lite $0.25/$1.50, 3 Flash Preview $0.50/$3, 2.5 Flash-Lite $0.10/$0.40, 2.5 Flash $0.30/$2.50.
  - Gemini 2.0 Flash and Flash-Lite were shut down on 2026-06-01.
- **3.1 Flash-Lite:** [model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite).
  - Stable, described as "low-latency".
  - Structured outputs, function calling and context caching.
- **Unverified newer models:**
  - Google's [structured-output doc](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) also lists **Gemini 4 Argon, 3.8 Flash, 3.6 Flash and 3.5 Flash-Lite**, but the official pricing page as fetched today doesn't show them.
  - Third-party prices for them, from [Morph](https://www.morphllm.com/gemini-api-pricing) and not verified:
    - 3.5 Flash-Lite $0.30/$2.50.
    - 3.6 / 3.8 Flash $0.75/$3.75 (promo to 2026-12-31).
    - Gemini 4 Argon $2/$10 (to 2026-11-30, then $4/$20).
  - Morph also says Gemini 2.5 Flash requests get routed to 3.5 Flash-Lite from 2026-12-01.
  - To try one, set `AI_MODEL` plus `AI_PRICE_IN` / `AI_PRICE_OUT`.

## 2. Latency

Published numbers are mostly for "reasoning" settings, which we turn off. Treat them as upper bounds. The admin card shows the real average milliseconds per call, so measure in game.

| Model (setting) | First token | Output speed | Source |
|---|---|---|---|
| GPT-6 Luna (non-reasoning) | 1.53 s | 91 tok/s | [Artificial Analysis](https://artificialanalysis.ai/models/comparisons/claude-haiku-5-5-medium-vs-gpt-6-luna-high) |
| GPT-6 Luna (low) | 2.66 s | 90 tok/s | same |
| Claude Haiku 5.5 (low effort, thinking on) | 5.27 s | 213 tok/s | same; no non-reasoning variant was measured |
| Gemini 3.1 Flash-Lite | 4.25 s ("standard") | 376 tok/s | [BenchLM speed](https://www.benchlm.ai/llm-speed), refreshed 2026-11-16; setting not stated |
| Gemini 3.5 Flash / 3.5 Flash-Lite | 12.96 s / 4.83 s | 188 / 308 tok/s | same (reasoning) |
| Older reference: Haiku 4.5 / Gemini 2.5 Flash (thinking off), ~200-token prompts | ~0.6 s / ~0.45 s | – | [Ganglani benchmark](https://www.kunalganglani.com/blog/llm-api-latency-benchmarks-2026.md) (March 2026) |

What drives latency for us:
- **Thinking.** The adapters turn it off or to the minimum:
  - Haiku: `thinking: disabled`, `effort: low` ([effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)).
  - Sonnet 5.5: `between_tools` (it answers before thinking).
  - Luna: `reasoning.effort: none`.
  - Gemini 3.x: `thinkingLevel: minimal`, the 3.1 Flash-Lite default. Google says minimal doesn't guarantee zero thinking ([thinking docs](https://ai.google.dev/gemini-api/docs/generate-content/thinking)).
  - Gemini 2.5 Flash-Lite: `thinkingBudget: 0`.
  - A [Verdent guide](https://www.verdent.ai/guides/gemini-3-1-flash-lite-thinking-levels) ranks minimal as the fastest Flash-Lite level.
- **Output length.** A reply is ~50–80 tokens of JSON, so at 90–380 tok/s generation adds 0.2–0.9 s.

Expected total: about 1–3 s per decision. That's fine for a "slow mind": a teammate answering in chat a second or two later reads naturally, and combat never waits for it.

## 3. Structured output and tool calling

All three support both. The prototype uses **JSON-schema structured output**, not tool calls, because each call returns exactly one intent object.

- **Anthropic** ([docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).
  - Uses `output_config.format = { type: "json_schema", schema }` on the Messages API. It is GA on all models, and beta headers are no longer required.
  - Objects need `additionalProperties: false`, and enums are supported. Compare enum values case-insensitively, which our sanitiser does.
  - Strict tool use (`strict: true`) exists too.
  - Watch `stop_reason: refusal` / `max_tokens`.
- **OpenAI** ([docs](https://developers.openai.com/api/docs/guides/structured-outputs)).
  - Uses the Responses API with `text.format = { type: "json_schema", name, schema, strict: true }`. Every field is required and `additionalProperties: false`.
  - Luna supports function calling. On Chat Completions it does so only with `reasoning_effort: none` ([model page](https://developers.openai.com/api/docs/models/gpt-6-luna)).
  - **Known issue:** Luna sometimes adds an extra `commentary` message item (3–5 per 100 calls in one report: [forum thread](https://community.openai.com/t/gpt-6-luna-occasionally-returns-an-additional-message-item-for-structured-outputs/1401886)). The adapter skips commentary items and takes the last valid JSON.
- **Google** ([docs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)).
  - Uses JSON Schema output with `enum`, `required` and `additionalProperties`. `maxLength` isn't supported, so we cap lengths ourselves.
  - The docs now show `generationConfig.responseFormat.text { mimeType, schema }`, and the SDKs use `responseMimeType` + `responseJsonSchema`.
  - The adapter sends the latter and falls back to the former once if the API rejects it.
  - Google is also moving examples to a new Interactions API. `generateContent` is still documented, for example in the thinking docs.

## 4. Prompt caching

- **Anthropic** ([docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
  - Caching is explicit: `cache_control` goes on the system block.
  - The minimum cacheable prompt is **512 tokens on Haiku 5.5 and Sonnet 5.5** (4,096 on Haiku 4.5). Our system prompt is ~750 tokens, so it caches.
  - Reads cost $0.01/M on Haiku 5.5. Writes cost 1.25× input with a 5-minute TTL, refreshed on every hit.
  - The system prompt is identical for every bot, so all companions share one cache entry.
- **OpenAI.**
  - Caching is automatic from about 1,024 tokens ([forum thread](https://community.openai.com/t/on-gpt-5-6-chat-completions-api-adding-a-strict-response-format-type-json-schema-appears-to-prevent-prompt-cache-writes-entirely/1386687)).
  - Our static prefix is shorter, so expect no cache hits. The cost table assumes none.
- **Google.**
  - Context caching costs $0.025/M on 3.1 Flash-Lite, plus storage per hour ([pricing](https://ai.google.dev/gemini-api/docs/pricing)).
  - It isn't worth it for a ~750-token prompt. The table assumes no caching.

## 5. Rate limits

- **Anthropic, Start tier** ([docs](https://platform.claude.com/docs/en/api/rate-limits)).
  - Haiku 5.5 and Sonnet 5.5: **4,000 RPM, 2M input TPM, 400k output TPM**.
  - New organisations may start in a lower "Evaluation" tier.
  - Monthly spend cap: Start $500.
  - Cached reads don't count toward input TPM.
  - On a 429, honour `retry-after` when it's present. Our budget does this.
- **OpenAI** ([gpt-6-luna page](https://developers.openai.com/api/docs/models/gpt-6-luna)).
  - The free tier is not supported for Luna.
  - Build tier: **5,000 RPM, 2M TPM**.
- **Google** (per project, not per key; RPD resets at midnight Pacific; per [ScriptByAI](https://www.scriptbyai.com/gemini-api-rate-limits/), updated 2026-11-12).
  - 3.1 Flash-Lite free tier: **10 RPM, 250k TPM, 500 requests/day**.
  - Tier 1 (billing on): 4,000 RPM, 4M TPM, 150k RPD.
  - The free tier covers about 1 companion for about 3 hours a day at the default rate.

Our own load is tiny: 10 companions at the "chatty" rate is about 70 calls/min. The game's caps keep it lower still: `AI_MAX_CALLS_MIN=30` by default.

## 6. Cost per hour of play

**Assumptions per call:**
- ~1,150 input tokens: the ~780-token shared system prompt plus a ~370-token state summary and recent chat.
- ~80 output tokens.
- Thinking off or minimal.
- Anthropic caches the system prompt; OpenAI and Gemini get no cache hits.

**Call rates per companion:**
- **Talk only** (`AI_THINK_S=0`): ~1 call/min. The model is consulted only when someone talks to the bot, plus the odd event.
- **Default** (`AI_THINK_S=30`): ≤3 calls/min. Check-ins every 30 s happen only when something changed, plus talk.
- **Chatty** (`AI_THINK_S=10`): ~7 calls/min.

Each rate cell gives the cost for 1 / 3 / 10 companions, per hour.

| Model | per 1,000 calls | Talk only, 60/h | Default, 180/h | Chatty, 420/h |
|---|---|---|---|---|
| **Claude Haiku 5.5** | $0.085 | $0.005 / $0.015 / $0.051 | $0.015 / $0.046 / $0.15 | $0.036 / $0.11 / $0.36 |
| GPT-6 Luna | $0.155 | $0.009 / $0.028 / $0.093 | $0.028 / $0.084 / $0.28 | $0.065 / $0.20 / $0.65 |
| Gemini 3.1 Flash-Lite | $0.407 | $0.024 / $0.073 / $0.24 | $0.073 / $0.22 / $0.73 | $0.17 / $0.51 / $1.71 |
| Gemini 2.5 Flash-Lite | $0.147 | $0.009 / $0.026 / $0.088 | $0.026 / $0.079 / $0.26 | $0.062 / $0.19 / $0.62 |
| Claude Sonnet 5.5 | $1.618 | $0.097 / $0.29 / $0.97 | $0.29 / $0.87 / $2.91 | $0.68 / $2.04 / $6.80 |
| GPT-6.1 Terra | $1.550 | $0.093 / $0.28 / $0.93 | $0.28 / $0.84 / $2.79 | $0.65 / $1.95 / $6.51 |
| GPT-6.1 Sol | $3.100 | $0.19 / $0.56 / $1.86 | $0.56 / $1.67 / $5.58 | $1.30 / $3.91 / $13.02 |
| Gemini 3.5 Flash | $2.445 | $0.15 / $0.44 / $1.47 | $0.44 / $1.32 / $4.40 | $1.03 / $3.08 / $10.27 |

The cheap tier costs pennies per evening even with 10 companions. The smarter tier is affordable for a few companions, but it adds up at 10.
- Gemini 3.5 Flash may still think a little at `minimal`, and those thought tokens are billed as output. Its figures are a floor.

## 7. How the prototype works (`server/ai/`)

The LLM is a **slow mind** on top of the fast rule-based brain (`shared/bots/brain.js`).
- It never runs per tick and never moves, aims or dodges.
- It hooks into the brain through the existing `registerBotHook('onEvent')` (`shared/bots/registry.js`), with no changes to the bot files.
- It runs a 1-second loop over BotManager's bots.

**When it calls the model:**
1. **A human party member names the bot in chat.** For example: "Rook, hang back and heal me when I'm low".
   - The match is on the name as a word, in party chat or say/global chat from a party member.
   - Lines starting with `/` are commands (`/b …`) and are ignored.
   - Unnamed chat, other parties and bots never trigger a call.
2. **Every `AI_THINK_S` seconds (default 30) while partied with a human.**
   - The call happens only if the situation changed: HP band, nearby enemies, deaths, new events or chat.
   - These calls may only `say` something. They can't give orders, change stance or focus, or store memories.

**What it sends:**
- A shared system prompt with the game rules, the intent fields and the safety rules.
- A compact summary of the bot's own view:
  - itself (class, role, HP, potions, goal, order, stance, focus) and where it is;
  - each party member (human or bot, class, level, HP, distance, target);
  - nearby enemies (boss HP, Broken, enraged);
  - recent events (downs, level-ups, Breaks, boss kills);
  - memories about the humans present;
  - the last 8 party chat lines;
  - the trigger.

**What comes back:** one JSON intent (`server/ai/intent.js`), always passed through `sanitizeIntent`.
- **`say`:** one chat line. It replaces the canned "Following." acknowledgement when an order comes with it, and links are dropped.
- **`order`:** one of follow, stay, come, attack (the speaker's target), heal, potion, farm, boss, ready.
  - It runs through the brain's own `b.command()`, the same path as `/b`.
  - "Leave party" is not allowed, so the model can't detach a bot.
- **`stance`:**
  - *Defensive*: a non-tank steps out of the fight when it drops below 50% HP.
  - *Aggressive*: it doesn't step out.
  - Either lasts 10 minutes.
- **`focus`:** a party member's name.
  - A healer keeps that player topped up through `b.healFocus`.
  - Other bots anchor on that player.
- **`remember`:** a short note about the speaker, kept per bot and player. Notes are in memory only, so they are lost on a restart.

**Caps and fallback** (`server/ai/budget.js`):
- **Per bot:** a minimum gap (`AI_BOT_MIN_GAP_S`, 4 s) and a token budget per rolling hour (`AI_BOT_TOKENS_HOUR`, 150k).
- **Global:**
  - calls per minute (`AI_MAX_CALLS_MIN`, 30);
  - calls in flight (`AI_MAX_CONCURRENT`, 4);
  - estimated USD per UTC day (`AI_DAILY_USD`, 1.00);
  - minds at once (`AI_MAX_BOTS`, 10).
- **Timeout:** each call has `AI_TIMEOUT_MS` (8 s). After 5 errors in a row, calls pause for 2 minutes. A 429's `retry-after` is honoured.
- **Fallback:** any "no" or any error means no intent this time, and the bot keeps playing on its brain. A line left unanswered for 20 s is dropped.
- **Off means off:** with no `AI_PROVIDER`, no key, or the toggle off, the hook returns at once and the loop does nothing. `test/ai-mind.js` checks this by running the same seeded bot with and without the layer and comparing every message it sends.

**Safety:**
- Keys are read from the environment at call time. They are never stored, logged or returned, and provider error text is redacted.
- Only party members can give orders.
- The system prompt treats chat as player speech, not instructions to the AI. It refuses to reveal itself or to say anything hateful, and the bot never claims to be human.
- Output is enum-checked and length-capped.

**Admin** (`/admin.html` → Bots tab → "AI companions" card, `public/admin-ai.js`):
- An on/off toggle and the status line, for example:
  `AI companions: ON · anthropic/claude-haiku-5-5 · 42 calls (0 failed) · $0.0036 today of $1.00 · avg 900 ms`.
- Token counts (with cached tokens), why calls were skipped, the last error, and the last 8 decisions.
- API: `GET/POST /api/admin/ai`, for admins only.

**Mock provider:** `AI_PROVIDER=mock` needs no key and costs nothing.
- It answers "(mock) Heard you, <name>." to test the plumbing locally.
- Tests script its replies.

## 8. Turning it on (Render)

Never put a key in the repo, `render.yaml` or chat. It lives only in Render's environment settings.

1. **Get a key** in the provider's console (Anthropic Console, OpenAI Platform or Google AI Studio). Setting a low monthly spend limit there is a good extra safety net.
2. **Add the variables.** Render dashboard → service **floorbound** → **Environment** → **Add Environment Variable**:

   | Key | Value |
   |---|---|
   | `AI_PROVIDER` | `anthropic` (or `openai`, `gemini`) |
   | `ANTHROPIC_API_KEY` | your key (`OPENAI_API_KEY` for OpenAI, `GEMINI_API_KEY` for Gemini) |
   | `AI_MODEL` | optional, e.g. `claude-sonnet-5-5` to compare. Default: `claude-haiku-5-5` / `gpt-6-luna` / `gemini-3.1-flash-lite` |
   | `AI_ENABLED` | optional: `1` makes companions start ON after every deploy. Without it they start off, and you switch them on from the admin page after each restart. |
   | `AI_DAILY_USD` | optional spend cap per day, default `1` |
   | `AI_THINK_S` | optional, default `30`; `0` = only talk when spoken to |

3. **Save.** Render restarts the service with the new variables.
4. **Switch it on.** Open `/admin.html` → **Bots** → **AI companions** → **Turn on**. The status line then shows calls, spend and latency.
5. **Try it.** Add a bot (P → Bots) and say in party chat: "Lyra, hang back and heal me when I'm low", "Rook, what do you think of this fight?". Orders still work with `/b`.
6. **Compare providers.** Change `AI_PROVIDER` (and add that provider's key). Only one provider runs at a time. The admin card's average latency and spend per call give the comparison.

Other variables (rarely needed):
- `AI_KEY_ENV`: read the key from a differently named variable.
- `AI_EFFORT`: the provider's speed knob.
- `AI_BOT_MIN_GAP_S`, `AI_BOT_TOKENS_HOUR`, `AI_MAX_CALLS_MIN`, `AI_MAX_CONCURRENT`, `AI_TIMEOUT_MS`, `AI_MAX_BOTS`, `AI_MAX_OUT_TOKENS`.
- `AI_PRICE_IN` / `AI_PRICE_OUT`: the price for a model that isn't in `prices.js`.

## 9. Caveats and next steps
- **Not yet run against the live APIs** (no keys here). The request shapes follow the current docs and are unit-tested with fake HTTP. On the first real run, watch the admin card's "Last error".
- **Memories are in memory only,** so they're lost on each deploy. A small `bot_memories` table would make them persist.
- **Gemini's newest models** (3.5 Flash-Lite, 3.6/3.8 Flash, Gemini 4 Argon) have unverified prices; see section 1.
- **Streaming** the `say` line would cut perceived latency, but it isn't needed yet.
- **Plain chat orders.** Until the `/b`-only change (Task C) is merged, the brain's old keyword parser still reacts to plain chat such as "heal me", alongside the mind.
