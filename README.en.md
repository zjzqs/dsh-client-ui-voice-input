# dsh-client-ui-voice-input

English | [中文](README.md)

Voice input + prompt optimization plugin for the DeepSeek Harness Web GUI (`dsh web`).

Two buttons appear on the right side of the composer tool row (left of the send button):

1. **🎤 Voice input** — click to start continuous listening (no auto-stop on pauses).
   The transcript **streams into the draft in real time** (final + interim replace in
   place — never stacked, never duplicated), and an unexpected end (long silence /
   transient drop) resumes automatically. Click again to stop. Recognition uses the
   browser Web Speech API (`SpeechRecognition`), purely client-side.
2. **✨ Optimize prompt** — sends the current draft to the host-side
   `POST /dsh-voice-input/optimize` endpoint, which rewrites it with the harness's
   own LLM service (`ctx.llm`; provider/model come from `agentDefaultModel`, i.e.
   DeepSeek, **reasoning disabled**). The result replaces the draft unless the draft
   changed mid-flight. After a successful optimization the ✨ button **becomes an undo
   control (↶)** — clicking it restores the pre-optimize draft; the undo entry stays
   until used or the draft changes. Busy / success / failure states show a status chip.

- Default recognition language: `zh-CN` (Mandarin). To change it, edit the
  `RECOGNITION_LANG` constant at the top of `lib/client.js` and redeploy.
- Recognition runs through Chromium's built-in Web Speech cloud recognition and
  needs a network connection.
- Browser support: Chrome / Edge. Firefox does not support `SpeechRecognition`
  (the button is greyed out with a hint).

## How it works

- The package declares `dsh.client: { platform: "web" }`; the browser bundle lives in
  `lib/client.js` (`window.__ModuleLoader__.load({ id, factory })` factory format,
  same as the official `dsh-client-ui-*` packages).
- `apply(ctx)` registers the component into the `conversation.input.right` slot;
  the `voice.input` locale namespace carries the zh/en copy.
- The host half `lib/index.js` injects the `webServer` / `llm` / `agentDefaultModel`
  services and registers the exact route `/dsh-voice-input/optimize`: read the
  request body → `ctx.llm.stream` (system prompt demands "return only the optimized
  prompt", `reasoningEffort: "off"`, 30s timeout, 4096 token cap) → returns
  `{ text }`; every failure path returns a JSON error.
- Dependency: the host half needs `@deepseek-ai/dsh-llm` (installed automatically
  by npm as a dependency of this package).

## Installing on another machine (from GitHub)

**Prerequisites:** `dsh web` already runs on the machine, and the browser is
Chrome / Edge.

```powershell
# ① Get the source (or GitHub page → Code → Download ZIP)
git clone https://github.com/zjzqs/dsh-client-ui-voice-input.git D:\dsh-voice-input

# ② Web profile directory
$profile = "$env:USERPROFILE\.dsh\profiles\web"

# ③ Copy the source INSIDE the profile tree (required: the host half resolves its
#    imports by walking up from its real path, so the package must sit under the
#    profile directory to reach the profile's node_modules)
Copy-Item -Recurse -Force "D:\dsh-voice-input" "$profile\voice-input-src"

# ④ Add one line to the "dependencies" of $profile\package.json:
#      "dsh-client-ui-voice-input": "file:./voice-input-src"
#    Then install (npm installs the plugin's own dependency @deepseek-ai/dsh-llm
#    and creates the link automatically):
& npm.cmd install --no-audit --no-fund --prefix $profile
```

**⑤ Enable the plugin** — edit `$profile\cordis.patch.yml`:

```yaml
# Voice input + prompt optimization (dsh-client-ui-voice-input).
- insert:
    - id: voice-input
      name: dsh-client-ui-voice-input
```

**⑥ Restart `dsh web`** and refresh the page — the 🎤 and ✨ buttons appear next to
the composer.

Notes:

- `dsh-client-ui-voice-input` MUST be a dependency of the profile's `package.json`,
  otherwise `npm install` prunes it as an extraneous package.
- The optimize feature calls the machine's own default model
  (`agentDefaultModel`) — configure the DeepSeek API key in that dsh installation
  and it just works; the plugin never touches credentials.
- Voice recognition needs a network connection (Chromium cloud recognition).

## Redeploying after local edits

Sync the edited source into the profile's copy, then restart `dsh web`:

```powershell
Copy-Item -Recurse -Force "repo-dir\*" "$env:USERPROFILE\.dsh\profiles\web\voice-input-src\"
# restart dsh web (kill the process, then start it again)
```

## License

MIT
