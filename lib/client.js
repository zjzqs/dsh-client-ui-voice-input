window.__ModuleLoader__.load({
	id: "dsh-client-ui-voice-input",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const { useState, useRef, useEffect, createElement } = react;
		const { Tooltip, IconEnhanceOutline16 } = _primitives;
		//#region voice-input styles
		const css = ".dsh-vi-wrap{display:flex;align-items:center;gap:6px;flex:none}.dsh-vi-status{box-sizing:border-box;max-width:200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:22px;height:22px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;padding:0 10px;flex:none}.dsh-vi-button{background:transparent;width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;display:grid;padding:0}.dsh-vi-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-vi-button:disabled{cursor:default;opacity:.45}.dsh-vi-listening{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger);animation:dsh-vi-pulse 1.4s ease-in-out infinite}@keyframes dsh-vi-pulse{0%,100%{opacity:1}50%{opacity:.55}}";
		const tagId = "dsh-client-ui-voice-input/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-client-ui-voice-input";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Locale namespace owning the mic button copy. */
		const NS = "voice.input";
		/** zh dictionary. */
		const zh = {
			start: "语音输入",
			listening: "正在聆听…点击结束",
			unsupported: "当前浏览器不支持语音输入，请使用 Chrome 或 Edge",
			optimize: "优化提示词",
			optimizing: "正在优化提示词…",
			optimized: "提示词已优化",
			optimizeFailed: "优化失败，请重试",
			draftChanged: "草稿已变化，未应用优化结果",
			undo: "撤回",
			undone: "已撤回优化结果"
		};
		/** en dictionary. */
		const en = {
			start: "Voice input",
			listening: "Listening… click to stop",
			unsupported: "Voice input is unsupported in this browser; use Chrome or Edge",
			optimize: "Optimize prompt",
			optimizing: "Optimizing prompt…",
			optimized: "Prompt optimized",
			optimizeFailed: "Optimization failed, please retry",
			draftChanged: "Draft changed; optimized result not applied",
			undo: "Undo",
			undone: "Optimization reverted"
		};
		/** Required services: the locale face owns the copy; the slots service owns the seat. */
		const inject = ["locale", "slots"];
		/** Recognition language (browser Web Speech API BCP-47 tag). Edit to change. */
		const RECOGNITION_LANG = "zh-CN";
		/** Settle delay before resuming after an unexpected end (avoids the restart-too-fast bug). */
		const RESTART_DELAY_MS = 300;
		/**
		* The continuous-mode engine flushes the last final segment a second time
		* (a new result index with identical text) when a session winds down.
		* Within this window an identical consecutive segment is treated as that
		* re-emission and dropped.
		*/
		const DUPLICATE_FINAL_WINDOW_MS = 1500;
		/**
		* Join two text pieces with a word space only when both sides are Latin
		* script (CJK text reads naturally without spaces; the engine already
		* spaces English words within a segment).
		*/
		const joinText = (a, b) => {
			if (!b) return a;
			if (!a) return b;
			if (/\s$/.test(a)) return a + b;
			const last = a.charAt(a.length - 1);
			const first = b.charAt(0);
			const latin = (c) => /[A-Za-z0-9]/.test(c);
			return latin(last) && latin(first) ? a + " " + b : a + b;
		};
		/**
		* Mic button for the composer tool row. Rendered into the
		* `conversation.input.right` seat (the right end of the tool row, before
		* the send button). Continuous-recognition voice input: click to start,
		* click again to stop; the transcript streams into the draft live
		* (final + interim replace in place, never append to stale text), and an
		* unexpected end (long silence / transient drop) resumes automatically.
		*
		* Props: the standard session kit (sessionId, useSession, useInput,
		* inputActions, t) plus the InputZone owner share ({@code input} snapshot
		* carrying the live draft).
		*/
		function VoiceButton({ input, inputActions, t, sessionId }) {
			const [listening, setListening] = useState(false);
			const [interim, setInterim] = useState("");
			const [optimizing, setOptimizing] = useState(false);
			const [notice, setNotice] = useState(null);
			const recRef = useRef(null);
			const stoppingRef = useRef(false);
			const errorRef = useRef(false);
			const finalRef = useRef("");
			/** Latest full transcript (finals + current interim) exactly as displayed. */
			const transcriptRef = useRef("");
			/** Draft text EXCLUDING the current session's transcript (never grows mid-session). */
			const draftBaseRef = useRef("");
			const mountedRef = useRef(true);
			const noticeTimerRef = useRef(null);
			/** Latest draft snapshot for the optimistic-replace guard. */
			const latestDraftRef = useRef((input && input.draft) || "");
			latestDraftRef.current = (input && input.draft) || "";
			/** Undo slot: the pre-optimize draft and the applied result. */
			const undoRef = useRef(null);
			const unsupported = typeof window === "undefined" || (!window.SpeechRecognition && !window.webkitSpeechRecognition);
			const tr = (key) => (typeof t === "function" ? t(key) : void 0) || zh[key];
			/** Keep the base in sync with user edits while idle. */
			useEffect(() => {
				if (!listening) draftBaseRef.current = (input && input.draft) || "";
			}, [input, listening]);
			/**
			* Live write: base + (finals + interim). The transcript portion is
			* rebuilt from scratch on every event, so interim text REPLACES the
			* previous interim instead of stacking on it. The base is untouched
			* here; it only moves at commit points.
			*/
			const applyDraft = (finalText, interimText) => {
				if (!inputActions) return;
				const base = draftBaseRef.current;
				const transcript = (finalText + interimText).trim();
				const next = transcript === "" ? base : joinText(base, transcript);
				inputActions.setDraft(next);
			};
			/**
			* Commit point: absorb the transcript into the base and write the
			* settled draft. The caller decides whether to pass finals only
			* (auto-resume, where re-recognition could duplicate a fragment) or
			* the latest full transcript (deliberate stop / terminal end, where
			* dropping the still-interim tail would delete what the user just
			* said).
			*/
			const commit = (transcript) => {
				if (!inputActions) return;
				const base = draftBaseRef.current;
				const text = (transcript || "").trim();
				const next = text === "" ? base : joinText(base, text);
				draftBaseRef.current = next;
				inputActions.setDraft(next);
			};
			/** End the session deliberately: commit the accumulated transcript. */
			const stop = () => {
				stoppingRef.current = true;
				const rec = recRef.current;
				recRef.current = null;
				if (rec) {
					rec.onresult = null;
					rec.onend = null;
					rec.onerror = null;
					try {
						rec.stop();
					} catch (e) {
						/* already stopped */
					}
				}
				// Deliberate stop: keep the latest full transcript (finals +
				// still-interim tail) so the last sentence is never dropped.
				commit(transcriptRef.current);
				setListening(false);
				setInterim("");
			};
			/** Start (or resume) a continuous recognition session. */
			const start = () => {
				if (unsupported || !mountedRef.current) return;
				const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
				const rec = new SR();
				rec.lang = RECOGNITION_LANG;
				rec.continuous = true;
				rec.interimResults = true;
				rec.maxAlternatives = 1;
				stoppingRef.current = false;
				errorRef.current = false;
				finalRef.current = "";
				transcriptRef.current = "";
				// Final-result dedupe: Chrome re-delivers already-final results in
				// later events, and its end-of-stream flush re-emits the last
				// final segment under a new index. Index guard + identical-text
				// window guard together make each final appear exactly once.
				let lastFinalIndex = -1;
				let lastFinalSegment = "";
				let lastFinalAt = 0;
				rec.onresult = (event) => {
					errorRef.current = false;
					let finalText = finalRef.current;
					let interimText = "";
					const now = Date.now();
					for (let i = event.resultIndex; i < event.results.length; i++) {
						const result = event.results[i];
						if (result.isFinal) {
							if (i > lastFinalIndex) {
								const segment = result[0].transcript;
								const reEmission = segment === lastFinalSegment && now - lastFinalAt < DUPLICATE_FINAL_WINDOW_MS;
								if (!reEmission) {
									finalText = joinText(finalText, segment);
									lastFinalSegment = segment;
									lastFinalAt = now;
								}
								lastFinalIndex = i;
							}
						} else {
							interimText += result[0].transcript;
						}
					}
					finalRef.current = finalText;
					transcriptRef.current = finalText + interimText;
					setInterim(interimText);
					applyDraft(finalText, interimText);
				};
				rec.onend = () => {
					const stillCurrent = recRef.current === rec;
					recRef.current = null;
					if (!stoppingRef.current && !errorRef.current && stillCurrent && mountedRef.current) {
						// Continuous recognition can end on long silences or
						// transient drops; absorb the finals and resume
						// transparently after a settle.
						setInterim("");
						commit(finalRef.current);
						setTimeout(() => {
							if (mountedRef.current && !stoppingRef.current) start();
						}, RESTART_DELAY_MS);
						return;
					}
					setListening(false);
					setInterim("");
					// Terminal end (error or user stop via engine): keep the
					// latest full transcript, interim tail included.
					commit(transcriptRef.current);
				};
				rec.onerror = (event) => {
					console.error("voice-input: recognition error:", event && event.error);
					errorRef.current = true;
				};
				recRef.current = rec;
				setListening(true);
				setInterim("");
				try {
					rec.start();
				} catch (error) {
					console.error("voice-input: failed to start:", error);
					errorRef.current = true;
					recRef.current = null;
					setListening(false);
				}
			};
			const toggle = () => {
				if (listening) stop();
				else start();
			};
			/** Surface a transient status chip; busy notices stay until replaced. */
			const showNotice = (kind, text, durationMs) => {
				setNotice({ kind, text });
				if (noticeTimerRef.current) {
					clearTimeout(noticeTimerRef.current);
					noticeTimerRef.current = null;
				}
				if (kind !== "busy") {
					noticeTimerRef.current = setTimeout(() => setNotice(null), durationMs || 3000);
				}
			};
			/** Revert the last applied optimization back to the pre-optimize draft. */
			const undoOptimize = () => {
				const undo = undoRef.current;
				if (!undo || !inputActions) return;
				undoRef.current = null;
				if (latestDraftRef.current === undo.next) {
					inputActions.setDraft(undo.prev);
					showNotice("ok", tr("undone"));
				} else {
					showNotice("error", tr("draftChanged"));
				}
			};
			/** Ask the host to rewrite the current draft with the harness LLM. */
			const optimizePrompt = async () => {
				if (!inputActions || optimizing) return;
				const source = ((input && input.draft) || "").trim();
				if (!source) return;
				const captured = source;
				setOptimizing(true);
				showNotice("busy", tr("optimizing"));
				try {
					const res = await fetch("/dsh-voice-input/optimize", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ text: source, sessionId })
					});
					const data = await res.json().catch(() => null);
					if (!res.ok || !data || typeof data.text !== "string" || data.text.trim() === "") {
						throw new Error("optimize request failed (HTTP " + res.status + ")");
					}
					if (latestDraftRef.current === captured) {
						const next = data.text.trim();
						undoRef.current = { prev: captured, next };
						inputActions.setDraft(next);
						// The "已优化" chip + undo button stay until the undo is
						// used, a new optimize replaces the slot, or the session
						// changes; only the transient flash is timed.
						showNotice("ok", tr("optimized"));
					} else {
						showNotice("error", tr("draftChanged"));
					}
				} catch (error) {
					console.error("voice-input: optimize failed:", error);
					showNotice("error", tr("optimizeFailed"));
				} finally {
					setOptimizing(false);
				}
			};
			useEffect(() => () => {
				mountedRef.current = false;
				stoppingRef.current = true;
				if (noticeTimerRef.current) {
					clearTimeout(noticeTimerRef.current);
					noticeTimerRef.current = null;
				}
				const rec = recRef.current;
				recRef.current = null;
				if (rec) {
					rec.onresult = null;
					rec.onend = null;
					rec.onerror = null;
					try {
						rec.abort();
					} catch (e) {
						/* already gone */
					}
				}
			}, []);
			const label = listening ? (interim ? interim : tr("listening")) : tr("start");
			const hint = unsupported ? tr("unsupported") : label;
			const draftTrimmed = ((input && input.draft) || "").trim();
			// After a successful optimize the button BECOMES the undo control
			// (left-arc arrow, "撤回" on hover) until the undo is used, a new
			// optimize replaces the slot, or the draft drifts from the applied
			// result (then it reverts to the optimize affordance).
			const canUndo = !!(undoRef.current && !listening && !optimizing && latestDraftRef.current === undoRef.current.next);
			const optimizeLabel = canUndo ? tr("undo") : tr("optimize");
			// Persistent "已优化" chip while undo is possible (survives the
			// transient notice); transient notices still win while they show.
			const statusText = listening ? (interim || tr("listening")) : (notice ? notice.text : (canUndo ? tr("optimized") : ""));
			const showChip = listening || notice || canUndo;
			return createElement(
				"span",
				{ className: "dsh-vi-wrap" },
				showChip && createElement("span", { className: "dsh-vi-status", "aria-hidden": true }, statusText),
				createElement(
					Tooltip,
					{ label: optimizeLabel, side: "top", delayMs: 500 },
					createElement("button", {
						type: "button",
						className: "dsh-vi-button",
						"aria-label": optimizeLabel,
						title: optimizeLabel,
						disabled: canUndo ? false : (optimizing || listening || draftTrimmed === ""),
						onClick: canUndo ? undoOptimize : optimizePrompt,
						onMouseDown: (event) => event.preventDefault()
					}, canUndo ? createElement("svg", {
						viewBox: "0 0 24 24",
						width: "14",
						height: "14",
						fill: "currentColor",
						"aria-hidden": true
					}, createElement("path", { d: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" })) : createElement(IconEnhanceOutline16, { size: 14 }))
				),
				createElement(
					Tooltip,
					{ label: hint, side: "top", delayMs: 500 },
					createElement("button", {
						type: "button",
						className: listening ? "dsh-vi-button dsh-vi-listening" : "dsh-vi-button",
						"aria-label": hint,
						title: hint,
						disabled: unsupported,
						onClick: toggle,
						onMouseDown: (event) => event.preventDefault()
					}, createElement("svg", {
						viewBox: "0 0 24 24",
						width: "14",
						height: "14",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "2",
						strokeLinecap: "round",
						strokeLinejoin: "round",
						"aria-hidden": true
					},
						createElement("path", { d: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" }),
						createElement("path", { d: "M19 10v2a7 7 0 0 1-14 0v-2" }),
						createElement("line", { x1: "12", y1: "19", x2: "12", y2: "22" })
					))
				)
			);
		}
		/**
		* Client plugin body: register the locale dictionary, then put the mic
		* button into the composer tool row once the seat's declarer is up.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "voice-input: labels");
			ctx.inject(["slots"], (scope) => {
				scope.slots.inject("conversation.input.right", () => scope.slots.register({
					name: "conversation.input.right",
					id: "voice-input",
					order: 10,
					locale: NS
				}, VoiceButton));
			});
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
