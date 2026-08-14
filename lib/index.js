/**
 * Node half of dsh-client-ui-voice-input.
 *
 * Registers one HTTP endpoint, `POST /dsh-voice-input/optimize`, that
 * rewrites a draft prompt with the harness's own LLM service
 * (`ctx.llm.stream`, provider/model from `agentDefaultModel`), so the
 * browser half can optimize the composer draft without ever holding
 * credentials. The browser half ships through `exports["./client"]`.
 */
import { BlockAssembler, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";

/** Hard cap on the request body (64 KiB) and on the prompt text itself. */
const MAX_BODY_BYTES = 65536;
const MAX_INPUT_CHARS = 8000;
/** Model-call deadline; the browser shows a failure notice on expiry. */
const OPTIMIZE_TIMEOUT_MS = 30000;
/**
* Output cap for the rewritten prompt. Generous on purpose: the default
* model reasons before answering, and reasoning tokens count toward the
* completion budget; 1024 proved too tight (repeated max-tokens finishes).
*/
const MAX_OUTPUT_TOKENS = 4096;

/** Stable system instruction: rewrite, keep intent and language, plain text only. */
const SYSTEM_PROMPT = [
	"You are a prompt-optimization assistant for an AI coding agent.",
	"Rewrite the user's prompt to be clearer, more specific, and better structured, preserving its intent and its language.",
	"The optimized prompt must be concise and directly usable: at most 200 characters for CJK text or 100 words for Latin text.",
	"Do not add explanations, questions, or meta-commentary.",
	"Return ONLY the optimized prompt as plain text: no quotes, no prefixes, no Markdown fences, no bullet lists, no commentary."
].join("\n");

/** One JSON response for every outcome so the browser half has one parse path. */
function respond(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(body);
}

/** Collect the request body up to a byte cap. */
async function readBody(req, limit) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("request body too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Build the route handler bound to the injected services. */
function createOptimizeHandler(scope) {
	return async (req, res) => {
		try {
			if (req.method !== "POST") {
				respond(res, 405, { error: "method not allowed" });
				return;
			}
			const raw = await readBody(req, MAX_BODY_BYTES);
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch {
				respond(res, 400, { error: "invalid json" });
				return;
			}
			const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
			if (text === "") {
				respond(res, 400, { error: "empty text" });
				return;
			}
			if (text.length > MAX_INPUT_CHARS) {
				respond(res, 413, { error: "text too long" });
				return;
			}
			const sessionId = typeof parsed?.sessionId === "string" ? parsed.sessionId : void 0;
			const selection = scope.agentDefaultModel?.currentSelection?.() ?? {};
			const provider = selection.provider;
			const model = selection.model;
			if (typeof provider !== "string" || provider === "" || typeof model !== "string" || model === "") {
				respond(res, 500, { error: "no model route available" });
				return;
			}
			const messages = [createUserMessage({
				content: [{
					type: "text",
					text: `Optimize this prompt:\n\n${text}`
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-client-ui-voice-input"
				}
			})];
			const options = deepFreeze({
				provider,
				model,
				messages,
				system: SYSTEM_PROMPT,
				maxTokens: MAX_OUTPUT_TOKENS,
				// Prompt rewriting is a light task: skip model reasoning for
				// faster, cheaper calls (and reasoning tokens no longer compete
				// with the output budget).
				reasoningEffort: "off",
				...(sessionId === void 0 ? {} : { sessionId }),
				signal: AbortSignal.timeout(OPTIMIZE_TIMEOUT_MS)
			});
			const assembler = new BlockAssembler();
			for await (const chunk of scope.llm.stream(options)) assembler.push(chunk);
			const finish = assembler.finish;
			if (finish.kind !== "stop") {
				respond(res, 502, { error: `model call finished with ${finish.kind}` });
				return;
			}
			const output = assembler.blocks()
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("")
				.trim();
			if (output === "") {
				respond(res, 502, { error: "model returned no text" });
				return;
			}
			respond(res, 200, { text: output });
		} catch (error) {
			console.error("voice-input: optimize endpoint error:", error);
			respond(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}

/** Host plugin body: mount the optimize endpoint once the services exist. */
function apply(ctx) {
	ctx.inject(["webServer", "llm", "agentDefaultModel"], (scope) => {
		ctx.effect(() => scope.webServer.register({
			kind: "exact",
			path: "/dsh-voice-input/optimize",
			handler: createOptimizeHandler(scope)
		}), "voice-input: optimize endpoint");
	});
}
export { apply };
