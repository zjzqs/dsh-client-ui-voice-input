# dsh-client-ui-voice-input

语音输入 + 提示词优化插件 for DeepSeek Harness 的 Web GUI（`dsh web`）。

输入框工具行右侧（发送按钮左边）有两个按钮：

1. **🎤 语音输入**：点击开始连续监听（不会因停顿自动断掉），识别文字**实时
   写入草稿箱**（最终+中间结果原地替换，不叠加不重复），意外中断自动恢复；
   再点一下结束。识别用浏览器 Web Speech API（`SpeechRecognition`），纯前端。
2. **✨ 优化提示词**：把当前草稿发给宿主端 `POST /dsh-voice-input/optimize`
   端点，由 harness 自己的 LLM 服务（`ctx.llm`，provider/model 取
   `agentDefaultModel` 的当前默认值，即 DeepSeek，**已关闭推理**）重写为更
   清晰、具体的提示词，成功后替换草稿；若优化期间草稿被修改则不覆盖。优化
   成功后 ✨ 按钮**变为撤回图标（↶）**，点击恢复优化前的草稿，撤回入口
   常驻直到被使用或草稿变化。优化中/成功/失败有状态提示条。

- 默认识别语言：`zh-CN`（普通话），修改 `lib/client.js` 顶部的
  `RECOGNITION_LANG` 常量后重新部署
- 识别走 Chromium 内置的 Web Speech 云端识别，需要联网
- 支持浏览器：Chrome / Edge；Firefox 不支持（按钮置灰并提示）

## 工作原理

- 包声明 `dsh.client: { platform: "web" }`；浏览器端 bundle 在
  `lib/client.js`（`window.__ModuleLoader__.load({ id, factory })` 工厂格式，
  与官方 `dsh-client-ui-*` 包一致）
- `apply(ctx)` 把组件注册进 `conversation.input.right` 插槽；`locale`
  命名空间 `voice.input` 提供中/英文案
- 宿主端 `lib/index.js` 注入 `webServer`/`llm`/`agentDefaultModel` 服务，
  注册 `/dsh-voice-input/optimize` 精确路由：读请求体 → `ctx.llm.stream`
  （system 提示词限定"只返回优化后的提示词"，`reasoningEffort: "off"`，
  30s 超时，4096 token 上限）→ 返回 `{ text }`；所有错误路径返回 JSON 错误
- 依赖：宿主端需要 `@deepseek-ai/dsh-llm`（已作为 profile 依赖安装）

## 安装到 web profile（已完成，仅供参考）

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\web"

# 1) 源码放入 profile 树内（同盘，保证 node 的 import 能解析到依赖）
Copy-Item -Recurse -Force "<源码目录>" "$profile\voice-input-src"

# 2) package.json 增加依赖（file: 相对路径，npm 会建 junction）
#    "dsh-client-ui-voice-input": "file:./voice-input-src"
#    "@deepseek-ai/dsh-llm": "^0.1.0-rc.6"
& npm.cmd install --no-audit --no-fund --prefix $profile

# 3) cordis.patch.yml 启用（已启用）：
#    - insert:
#        - id: voice-input
#          name: dsh-client-ui-voice-input

# 4) 重启 dsh web（宿主端插件在启动时加载）
```

注意：`dsh-client-ui-voice-input` 必须是 profile package.json 的依赖，
否则 `npm install` 会把它当多余包裁掉。

## 修改后重新部署

编辑源码后同步到 profile 内的安装副本，然后重启 `dsh web`：

```powershell
Copy-Item -Recurse -Force "D:\CODE\DEEPSEEK\voice-input\*" "$env:USERPROFILE\.dsh\profiles\web\voice-input-src\"
# 重启 dsh web（或运行 D:\CODE\DEEPSEEK\restart-dsh-web.ps1）
```

浏览器端 bundle 由服务器按请求实时读取（`no-cache`），仅改 `lib/client.js`
时**刷新页面即可**；改宿主端 `lib/index.js` 必须重启。
