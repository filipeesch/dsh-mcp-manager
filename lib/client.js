window.__ModuleLoader__.load({
	id: "dsh-mcp-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const createElement = react.createElement;

		const inject = ["slots", "locale"];

		const css = ".mm_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}.mm_row{display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:12px 14px}.mm_rowHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mm_name{font-weight:600;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.mm_statusDot{background:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;width:7px;height:7px;display:inline-block}.mm_statusDot.connected{background:var(--dsw-alias-state-success-primary)}.mm_statusDot.needs-auth,.mm_statusDot.authorizing,.mm_statusDot.connecting{background:var(--dsw-alias-state-business-primary)}.mm_statusDot.error{background:var(--dsw-alias-state-error-primary)}.mm_badge{background:var(--dsw-alias-bg-layer-1);min-height:20px;color:var(--dsw-alias-label-secondary);border-radius:5px;align-items:center;padding:1px 8px;font-size:11px;line-height:16px;display:inline-flex}.mm_badge.connected{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}.mm_badge.error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}.mm_badge.needs-auth,.mm_badge.authorizing,.mm_badge.connecting{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);color:var(--dsw-alias-state-business-primary)}.mm_badge.disabled{color:var(--dsw-alias-label-tertiary)}.mm_actions{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.mm_btn{cursor:pointer;font-size:12px;line-height:18px;padding:3px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}.mm_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.mm_btn:disabled{opacity:.5;cursor:default}.mm_btn.primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}.mm_err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.mm_meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}.mm_form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mm_form label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}.mm_form input,.mm_form select{font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.mm_form input::placeholder,.mm_form select::placeholder{color:var(--dsw-alias-label-tertiary)}.mm_form select option{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}.mm_form .wide{grid-column:1 / -1}.mm_add{border-style:dashed}.mm_kv{display:flex;gap:6px;align-items:center}.mm_kv input{flex:1}.mm_kv .mm_btn{flex:none}.mm_catalogHeading{align-items:baseline;gap:7px;padding:0 2px;display:flex}.mm_catalogHeading h3{font-size:18px;font-weight:600;line-height:26px;margin:0}.mm_catalogHeading span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}.mm_cards{grid-template-columns:repeat(auto-fit,minmax(280px,1fr));align-items:start;gap:10px;display:grid}.mm_cardContent{width:100%;align-items:center;gap:8px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;padding:0;display:flex;text-align:left}.mm_chevron{color:var(--dsw-alias-label-tertiary);flex:none;margin-left:auto;transition:transform .15s;display:inline-flex}.mm_chevron[data-open=true]{transform:rotate(180deg)}.mm_details{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding-top:10px;margin-top:10px;display:flex}.mm_cardTrailing{flex:none;align-items:center;gap:7px;display:inline-flex}.mm_addBtn{box-sizing:border-box;width:36px;height:36px;flex:none;color:var(--dsw-alias-label-primary-foreground);cursor:pointer;background:var(--dsw-alias-state-business-primary);border:1px solid transparent;border-radius:18px;padding:0;display:inline-flex;align-items:center;justify-content:center;transition:filter .15s ease}.mm_addBtn:hover:not(:disabled){filter:brightness(1.08)}.mm_addBtn:disabled{opacity:.6;cursor:default}.mm_overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:1000}.mm_dialog{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-shadow-lv1);padding:20px;max-width:360px;width:100%;display:flex;flex-direction:column;gap:12px}.mm_dialogTitle{font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary)}.mm_dialogBody{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}.mm_dialogActions{display:flex;justify-content:flex-end;gap:8px}.mm_btn.danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}.mm_btn.danger:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}.mm_cardActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mm_switchRow{align-items:center;gap:8px;display:inline-flex}.mm_switch{box-sizing:border-box;width:36px;height:20px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:999px;cursor:pointer;padding:0;position:relative;flex:none;transition:background-color .2s ease,border-color .2s ease}.mm_switch:disabled{cursor:default;opacity:.6}.mm_switch[data-on=true]{border-color:transparent;background:var(--dsw-alias-state-business-primary)}.mm_switchThumb{box-sizing:border-box;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);position:absolute;top:2px;left:2px;transition:transform .22s cubic-bezier(.34,1.56,.64,1),background-color .18s ease}.mm_switch[data-on=true] .mm_switchThumb{transform:translateX(18px);background:var(--dsw-alias-label-primary-foreground)}.mm_switchText{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.mm_actionBtns{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.mm_collapsedErr{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mm_logHead{display:flex;align-items:center;gap:8px}.mm_logToggle{cursor:pointer;font-size:12px;line-height:18px;padding:0;border:none;background:none;color:var(--dsw-alias-state-business-primary);display:inline-flex;align-items:center;gap:4px}.mm_logBox{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all}.mm_logCopy{margin-left:auto}.mm_search{width:100%;color:var(--dsw-alias-label-tertiary);align-items:center;display:flex;position:relative}.mm_search>svg{pointer-events:none;position:absolute;left:12px}.mm_search input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;height:36px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:0 34px 0 36px;font-size:13px}.mm_search input::placeholder{color:var(--dsw-alias-label-tertiary)}.mm_search input:focus-visible{border-color:var(--dsw-alias-state-business-primary)}body[data-ds-dark-theme] .mm_switchThumb{background:#fff}body[data-ds-dark-theme] .mm_switch[data-on=true] .mm_switchThumb{background:#fff}.mm_wsList{display:flex;flex-direction:column;gap:10px}.mm_wsServer{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}.mm_wsServer .mm_badge{flex:none}.mm_row.mm_rowDisabled,.mm_wsServer.mm_rowDisabled{opacity:.6}.mm_statusDot.conflict{background:var(--dsw-alias-state-error-primary)}.mm_badge.conflict{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}.mm_wsBar{display:flex;align-items:center;gap:10px;padding:0 2px}.mm_wsSelect{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);max-width:100%}.mm_wsSelect option{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}.mm_wsPathHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;word-break:break-all;padding:0 2px}.mm_groupTitle{font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary);padding:0 2px;margin-top:4px}.mm_feature{display:flex;align-items:center;gap:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:8px;padding:10px 12px}.mm_featureText{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}.mm_featureTitle{font-size:13px;font-weight:600;line-height:20px}.mm_featureMeta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}.mm_rowHead .mm_cardContent{flex:1 1 auto;width:auto;min-width:0}.mm_badge.auth{cursor:pointer;border:1px solid var(--dsw-alias-state-business-primary)}.mm_badge.auth:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}.mm_badge.auth:disabled{opacity:.6;cursor:default}.mm_copy{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}.mm_redirect{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.mm_redirect code{min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;word-break:break-all;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 6px}.mm_redirect .mm_btn{flex:none}.mm_pending{color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:18px}.mm_wsBar .mm_wsSelect{flex:1;min-width:0}.mm_toolbar{display:flex;align-items:center;gap:8px}.mm_toolbar .mm_search{flex:1;min-width:0}.mm_tools{display:flex;flex-direction:column;gap:6px}.mm_toolsHead{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.mm_toolList{display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;max-height:200px;overflow:auto}.mm_toolName{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);word-break:break-all}.mm_toolState{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-mcp-manager/section\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-mcp-manager";
			tag.dataset.pluginCss = "dsh-mcp-manager/section";
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const zh = {
			"sectionLabel": "MCP",
			"namePlaceholder": "odin",
			"commandPlaceholder": "npx",
			"cwdPlaceholder": "/path/to/project",
			"urlPlaceholder": "https://mcp.example.com/mcp",
			"tokenEnvPlaceholder": "MCP_BEARER_TOKEN",
			"enableFailed": "启用失败 (HTTP {status})",
			"disableFailed": "禁用失败 (HTTP {status})",
			"addFailed": "添加失败 (HTTP {status})",
			"connected": "已启用",
			"needs-auth": "待认证",
			"authorizing": "认证中",
			"connecting": "连接中",
			"error": "错误",
			"disconnected": "未连接",
			"disabled": "已禁用",
			"enabled": "已启用",
			"conflict": "冲突",
			"configured": "已配置",
			"staticToken": "静态 Token",
			"disable": "停用",
			"enable": "启用",
			"reauth": "重新认证",
			"auth": "去认证",
			"edit": "编辑",
			"delete": "删除",
			"deleteServer": "删除 MCP 服务器",
			"cancel": "取消",
			"chooseWorkspaceError": "请选择工作区",
			"scope": "作用域 Scope",
			"userScope": "user（全局，所有工作区可用）",
			"workspaceScope": "workspace（仅指定工作区可用）",
			"workspace": "工作区",
			"chooseWorkspace": "选择工作区…",
			"type": "类型",
			"http": "HTTP（远程服务器）",
			"stdio": "stdio（本地进程）",
			"name": "名称",
			"command": "命令 command（可执行程序）",
			"arguments": "参数 arguments",
			"argumentValue": "参数值",
			"addArgument": "＋ 添加参数",
			"environment": "环境变量 environment variables",
			"keyUpper": "键 KEY",
			"valueUpper": "值 VALUE",
			"addEnvironment": "＋ 添加环境变量",
			"cwd": "工作目录 cwd（可选）",
			"toolTimeout": "工具调用超时（毫秒，可选）",
			"url": "MCP 服务器 URL",
			"authMode": "认证方式",
			"oauth": "OAuth（浏览器跳转认证）",
			"bearer": "静态 Bearer Token",
			"noAuth": "无鉴权",
			"noAuthOption": "无鉴权（服务器无需认证）",
			"tokenEnv": "Bearer 令牌环境变量（填变量名，不填明文）",
			"clientId": "OAuth Client ID（可选，填了就不走动态注册）",
			"clientSecretEnv": "Client Secret 环境变量名（可选，公共客户端留空）",
			"clientName": "OAuth Client 名称（可选，动态注册的 client_name；留空用 dsh-mcp-manager-<服务器名>）",
			"clientNamePlaceholder": "dsh-mcp-manager-my-server",
			"oauthScope": "Scopes（可选，空格分隔；留空则使用服务器公布的 scope）",
			"redirectUrl": "OAuth 回调地址（可选）",
			"redirectUrlPlaceholder": "http://localhost:8080/callback",
			"redirectUrlHint": "填写完整回调地址：http://host[:port][/path]。只接受回环地址（localhost、127.0.0.1、[::1]）。",
			"redirectUrlHintAuto": "回调端口在认证时自动分配；如果提供方要求预先登记地址，请在“高级”里设置固定地址，或在这里填写完整地址。",
			"redirectUrlAutoPlaceholder": "端口在认证时分配",
			"redirectUrlReset": "用默认值",
			"redirectUrlNotice": "保存新的回调地址后，下次认证会用新地址重新注册客户端；当前会话继续可用。",
			"redirectUri": "回调地址",
			"redirectUriAutomatic": "端口在认证时分配",
			"redirectLastUsed": "最近使用的回调地址",
			"redirectPending": "待重新注册：已保存的客户端是用另一个回调地址注册的。",
			"redirectUrlManualNotice": "手动配置的 Client ID 不会自动重新注册：请把新的回调地址加入提供方的白名单。",
			"redirectManualAuto": "手动配置的 Client ID 需要固定地址：请在“高级”中使用固定模式，或为该服务器填写回调地址。",
			"redirectInvalid": "已保存的回调地址无法使用，请修正后重试。",
			"copyRedirect": "复制",
			"redirectCopied": "已复制",
			"callbackTitle": "OAuth 回调",
			"callbackStatusLine": "{mode} · {count} 个监听器",
			"callbackModeAuto": "自动",
			"callbackModeFixed": "固定地址",
			"callbackMode": "回调模式",
			"callbackHost": "主机名",
			"callbackPort": "端口",
			"callbackPath": "回调路径",
			"callbackAutoHint": "主机名和路径默认为 localhost 与 /callback；端口在认证时分配。",
			"callbackFixedHint": "固定端口在认证时绑定；端口被占用会直接报错，不会自动改用其他端口。",
			"callbackListeners": "活动监听器",
			"callbackNoListeners": "当前没有监听器",
			"callbackListenerRow": "{addresses} · {pending} 个待处理",
			"callbackErrorBadge": "监听器错误",
			"callbackLastError": "最近一次监听器错误",
			"callbackSave": "保存",
			"callbackSaved": "已保存",
			"callbackSaveFailed": "保存回调配置失败",
			"insufficientScope": "权限范围不足：令牌缺少所需的 scope{scope}。请重新认证以授予这些权限。",
			"reauthScopes": "重新认证并授予权限",
			"headers": "标头 Headers",
			"key": "键 Key",
			"value": "值 Value",
			"addHeader": "＋ 添加标头",
			"headerEnv": "来自环境变量的标头（值填环境变量名）",
			"envName": "环境变量名",
			"addVariable": "＋ 添加变量",
			"save": "保存",
			"deleteWorkspaceServer": "删除工作区 MCP 服务器",
			"workspaceEnabled": "在此工作区启用",
			"workspaceDisabled": "已在此工作区禁用",
			"workspaceToggleFailed": "切换失败 (HTTP {status})",
			"addServer": "添加 MCP 服务器",
			"editGlobal": "编辑 MCP 服务器（全局）",
			"editWorkspace": "编辑 MCP 服务器（工作区）",
			"servers": "MCP 服务器",
			"onDemand": "按需 MCP 工具调用",
			"onDemandHelp": "仅 Native 模式收敛为 search、describe、execute；Code/PTC/both 模式保留完整 MCP 目录",
			"on": "已开启",
			"off": "已关闭",
			"global": "全局（所有工作区）",
			"workspaceServers": "工作区服务器（仅此工作区可见）",
			"emptyWorkspace": "该工作区还没有专属 MCP 服务器，点工作区选择器旁的 ＋ 添加（写入 .dsh/dshmm/mcp.json）。",
			"globalServers": "全局服务器（在此工作区可用）",
			"emptyGlobal": "还没有全局服务器。切换到「全局」视图添加。",
			"search": "搜索 MCP 服务器",
			"authFailed": "认证启动失败 (HTTP {status})",
			"deleteFailed": "删除失败 (HTTP {status})",
			"toggleFailed": "切换失败 (HTTP {status})",
			"saveFailed": "保存失败 (HTTP {status})",
			"toolCount": "{count} 个工具",
			"toolsNeedsAuth": "认证后即可查看此服务器的工具。",
			"toolsError": "服务器出错，暂时无法列出工具。",
			"toolsDisabled": "该服务器已禁用，不会暴露工具。",
			"toolsConnecting": "连接中——服务器就绪后会显示工具。",
			"toolsConfigured": "尚未连接。",
			"toolsConflict": "该条目与其他服务器名称冲突，无法连接。",
			"toolsEmpty": "已连接，但该服务器没有暴露工具。",
			"toolsLoadFailed": "无法加载工具列表。",
			"toolsLoading": "正在加载工具…",
			"confirmDelete": "确定要删除「{name}」吗？此操作不可恢复。",
			"confirmWorkspaceDelete": "确定要从该工作区删除「{name}」吗？",
			"logs": "日志",
			"hideLogs": "收起日志",
			"noLogs": "暂无日志记录",
			"copyLogs": "复制",
			"logsCopied": "已复制",
			"loadFailed": "加载失败 (HTTP {status})",
		};

		const en = {
			"sectionLabel": "MCP",
			"namePlaceholder": "odin",
			"commandPlaceholder": "npx",
			"cwdPlaceholder": "/path/to/project",
			"urlPlaceholder": "https://mcp.example.com/mcp",
			"tokenEnvPlaceholder": "MCP_BEARER_TOKEN",
			"enableFailed": "Enable failed (HTTP {status})",
			"disableFailed": "Disable failed (HTTP {status})",
			"addFailed": "Add failed (HTTP {status})",
			"connected": "Enabled",
			"needs-auth": "Authentication required",
			"authorizing": "Authenticating",
			"connecting": "Connecting",
			"error": "Error",
			"disconnected": "Disconnected",
			"disabled": "Disabled",
			"enabled": "Enabled",
			"conflict": "Conflict",
			"configured": "Configured",
			"staticToken": "Static token",
			"disable": "Disable",
			"enable": "Enable",
			"reauth": "Reauthenticate",
			"auth": "Authenticate",
			"edit": "Edit",
			"delete": "Delete",
			"deleteServer": "Delete MCP server",
			"cancel": "Cancel",
			"chooseWorkspaceError": "Please select a workspace",
			"scope": "Scope",
			"userScope": "user (global, available in all workspaces)",
			"workspaceScope": "workspace (available only in the selected workspace)",
			"workspace": "Workspace",
			"chooseWorkspace": "Select a workspace…",
			"type": "Type",
			"http": "HTTP (remote server)",
			"stdio": "stdio (local process)",
			"name": "Name",
			"command": "Command (executable)",
			"arguments": "Arguments",
			"argumentValue": "Argument value",
			"addArgument": "＋ Add argument",
			"environment": "Environment variables",
			"keyUpper": "KEY",
			"valueUpper": "VALUE",
			"addEnvironment": "＋ Add environment variable",
			"cwd": "Working directory (optional)",
			"toolTimeout": "Tool-call timeout (ms, optional)",
			"url": "MCP server URL",
			"authMode": "Authentication method",
			"oauth": "OAuth (authenticate in browser)",
			"bearer": "Static Bearer token",
			"noAuth": "No auth",
			"noAuthOption": "No auth (server needs no credentials)",
			"tokenEnv": "Bearer token environment variable (name, not the token itself)",
			"clientId": "OAuth Client ID (optional; skips dynamic registration)",
			"clientSecretEnv": "Client secret environment variable name (optional; leave empty for a public client)",
			"clientName": "OAuth client name (optional, DCR client_name; empty uses dsh-mcp-manager-<server>)",
			"clientNamePlaceholder": "dsh-mcp-manager-my-server",
			"oauthScope": "Scopes (optional, space separated; leave empty to use the scopes the server advertises)",
			"redirectUrl": "OAuth redirect URI (optional)",
			"redirectUrlPlaceholder": "http://localhost:8080/callback",
			"redirectUrlHint": "A complete redirect URI: http://host[:port][/path]. Only loopback addresses are accepted (localhost, 127.0.0.1, [::1]).",
			"redirectUrlHintAuto": "The callback port is assigned when you authenticate. If the provider requires a pre-registered URI, set a fixed address in Advanced or enter a complete URI here.",
			"redirectUrlAutoPlaceholder": "Port assigned at authentication",
			"redirectUrlReset": "Use default",
			"redirectUrlNotice": "Saving a different redirect URI registers the client again on the next Authenticate; the current session keeps working.",
			"redirectUri": "Redirect URI",
			"redirectUriAutomatic": "Port assigned at authentication",
			"redirectLastUsed": "Last used redirect URI",
			"redirectPending": "Registration pending: the stored client was registered with a different redirect URI.",
			"redirectUrlManualNotice": "A manual Client ID is never re-registered: add the new redirect URI to the provider's allowlist.",
			"redirectManualAuto": "A manual Client ID needs a fixed URI: use fixed mode in Advanced, or enter a redirect URI for this server.",
			"redirectInvalid": "The stored redirect URI cannot be served. Correct it and try again.",
			"copyRedirect": "Copy",
			"redirectCopied": "Copied",
			"callbackTitle": "OAuth callback",
			"callbackStatusLine": "{mode} · {count} listeners",
			"callbackModeAuto": "Automatic",
			"callbackModeFixed": "Fixed address",
			"callbackMode": "Callback mode",
			"callbackHost": "Hostname",
			"callbackPort": "Port",
			"callbackPath": "Callback path",
			"callbackAutoHint": "Hostname and path default to localhost and /callback; the port is assigned at authentication.",
			"callbackFixedHint": "The fixed port is bound when you authenticate; if it is taken the attempt fails instead of silently using another port.",
			"callbackListeners": "Active listeners",
			"callbackNoListeners": "No listener is running",
			"callbackListenerRow": "{addresses} · {pending} pending",
			"callbackErrorBadge": "Listener error",
			"callbackLastError": "Last listener error",
			"callbackSave": "Save",
			"callbackSaved": "Saved",
			"callbackSaveFailed": "Could not save the callback configuration",
			"insufficientScope": "Insufficient scope: the token lacks the required scope{scope}. Re-authenticate to grant it.",
			"reauthScopes": "Re-authenticate with scopes",
			"headers": "Headers",
			"key": "Key",
			"value": "Value",
			"addHeader": "＋ Add header",
			"headerEnv": "Headers from environment variables (enter variable names as values)",
			"envName": "Environment variable name",
			"addVariable": "＋ Add variable",
			"save": "Save",
			"deleteWorkspaceServer": "Delete workspace MCP server",
			"workspaceEnabled": "Enabled in this workspace",
			"workspaceDisabled": "Disabled in this workspace",
			"workspaceToggleFailed": "Toggle failed (HTTP {status})",
			"addServer": "Add MCP server",
			"editGlobal": "Edit MCP server (global)",
			"editWorkspace": "Edit MCP server (workspace)",
			"servers": "MCP servers",
			"onDemand": "On-demand MCP tool calls",
			"onDemandHelp": "Native mode exposes search, describe, execute only; Code/PTC/both keeps the full MCP catalog",
			"on": "On",
			"off": "Off",
			"global": "Global (all workspaces)",
			"workspaceServers": "Workspace servers (visible only in this workspace)",
			"emptyWorkspace": "No MCP servers in this workspace yet. Use ＋ next to the workspace selector to add one (saved to .dsh/dshmm/mcp.json).",
			"globalServers": "Global servers (available in this workspace)",
			"emptyGlobal": "No global servers yet. Switch to the Global view to add one.",
			"search": "Search MCP servers",
			"authFailed": "Failed to start authentication (HTTP {status})",
			"deleteFailed": "Delete failed (HTTP {status})",
			"toggleFailed": "Toggle failed (HTTP {status})",
			"saveFailed": "Save failed (HTTP {status})",
			"toolCount": "Tools: {count}",
			"toolsNeedsAuth": "Authenticate to see this server's tools.",
			"toolsError": "Tools are unavailable while this server is failing.",
			"toolsDisabled": "This server is disabled, so it exposes no tools.",
			"toolsConnecting": "Connecting — tools will appear when the server is ready.",
			"toolsConfigured": "Not connected yet.",
			"toolsConflict": "This entry conflicts with another server name, so it cannot connect.",
			"toolsEmpty": "Connected, but this server exposes no tools.",
			"toolsLoadFailed": "Could not load the tool list.",
			"toolsLoading": "Loading tools…",
			"confirmDelete": "Delete “{name}”? This cannot be undone.",
			"confirmWorkspaceDelete": "Delete “{name}” from this workspace?",
			"logs": "Logs",
			"hideLogs": "Hide logs",
			"noLogs": "No log entries yet",
			"copyLogs": "Copy",
			"logsCopied": "Copied",
			"loadFailed": "Load failed (HTTP {status})",
		};


		function api(path, options) {
			return fetch("/mcp-manager/api" + path, {
				headers: { "Content-Type": "application/json" },
				...options,
			}).then(async (resp) => ({ ok: resp.ok, status: resp.status, body: await resp.json().catch(() => ({})) }));
		}

		function formatLogEntry(entry) {
			const at = new Date(entry.at).toISOString();
			const status = entry.status ? " " + entry.status : "";
			return `[${at}] ${entry.phase}${status} ${entry.url} — ${entry.detail}`;
		}

		// The attempt log is fetched on demand. Its toggle lives in the action row,
		// next to Edit, and the panel renders below that row so a long log never
		// competes with the controls for horizontal space.
		function useAttemptLog(t, serverId) {
			const [open, setOpen] = react.useState(false);
			const [entries, setEntries] = react.useState([]);
			const [error, setError] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [copied, setCopied] = react.useState(false);
			const load = async () => {
				setBusy(true); setError("");
				try {
					const r = await api(`/servers/${serverId}/logs`);
					if (r.ok) setEntries(Array.isArray(r.body.logs) ? r.body.logs : []);
					else setError(r.body.error || t("loadFailed", { status: r.status }));
				} catch (e) { setError(String(e)); }
				setBusy(false);
			};
			const toggle = () => {
				const next = !open;
				setOpen(next);
				if (next) load();
			};
			const copy = () => {
				const body = entries.map((entry) => formatLogEntry(entry)).join("\n");
				try {
					const area = document.createElement("textarea");
					area.value = body;
					area.style.position = "fixed";
					area.style.opacity = "0";
					document.body.appendChild(area);
					area.select();
					const ok = document.execCommand("copy");
					document.body.removeChild(area);
					// A refused copy must not claim success.
					if (ok === false) throw new Error("clipboard copy was refused");
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch (e) { setError(String(e)); }
			};
			return { open, entries, error, busy, copied, toggle, copy };
		}

		function LogsToggle({ t, log }) {
			return createElement("button", { className: "mm_logToggle", type: "button", "aria-expanded": log.open, onClick: log.toggle, disabled: log.busy },
				log.busy ? "…" : log.open ? t("hideLogs") : t("logs"));
		}

		function AttemptLogPanel({ t, log }) {
			if (!log.open && !log.error) return null;
			return createElement("div", { className: "mm_logPanel" },
				log.open && log.entries.length > 0
					? createElement("div", { className: "mm_logHead" },
						createElement("button", { className: "mm_btn mm_logCopy", type: "button", onClick: log.copy }, log.copied ? t("logsCopied") : t("copyLogs")),
					)
					: null,
				log.open ? createElement("div", { className: "mm_logBox" },
					log.entries.length === 0
						? t("noLogs")
						: log.entries.map((entry, i) => createElement("div", { key: i, className: `mm_logLine ${entry.phase}` }, formatLogEntry(entry))),
				) : null,
				log.error ? createElement("div", { className: "mm_err" }, log.error) : null,
			);
		}

		// The effective redirect URI and the registration state live in the editor,
		// where the value is configured. The card does not repeat them: only the
		// plugin can resolve the URI, so the server view is the single source.
		function CopyValue({ t, value }) {
			const [copied, setCopied] = react.useState(false);
			const [error, setError] = react.useState("");
			const copy = () => {
				try {
					const area = document.createElement("textarea");
					area.value = value;
					area.style.position = "fixed";
					area.style.opacity = "0";
					document.body.appendChild(area);
					area.select();
					const ok = document.execCommand("copy");
					document.body.removeChild(area);
					// A refused copy must not claim success.
					if (ok === false) throw new Error("clipboard copy was refused");
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch (e) { setError(String(e)); }
			};
			return createElement("span", { className: "mm_copy" },
				createElement("button", { className: "mm_btn", type: "button", onClick: copy }, copied ? t("redirectCopied") : t("copyRedirect")),
				error ? createElement("span", { className: "mm_err" }, error) : null,
			);
		}

		function RedirectDetails({ t, server }) {
			if (!server || server.authMode !== "oauth") return null;
			const invalid = server.redirectWarning === "invalid";
			const automatic = !invalid && !server.redirectUri;
			const children = [];
			if (automatic) children.push(createElement("span", { key: "auto" }, t("redirectUriAutomatic")));
			if (server.redirectUri) {
				children.push(createElement("span", { key: "label" }, t("redirectUri")));
				children.push(createElement("code", { key: "code" }, server.redirectUri));
				children.push(createElement(CopyValue, { key: "copy", t, value: server.redirectUri }));
			}
			if (!server.redirectUri && server.redirectLastUsedUri) {
				children.push(createElement("span", { key: "lastLabel" }, t("redirectLastUsed")));
				children.push(createElement("code", { key: "lastCode" }, server.redirectLastUsedUri));
				children.push(createElement(CopyValue, { key: "lastCopy", t, value: server.redirectLastUsedUri }));
			}
			if (server.redirectPending) children.push(createElement("span", { key: "pending", className: "mm_pending" }, t("redirectPending")));
			if (invalid) children.push(createElement("span", { key: "invalid", className: "mm_err" }, server.redirectError || t("redirectInvalid")));
			if (server.redirectWarning === "manual-client-automatic") children.push(createElement("span", { key: "manual", className: "mm_pending" }, t("redirectManualAuto")));
			if (!children.length) return null;
			return createElement("div", { className: "mm_redirect" }, ...children);
		}

		// Raw names of the server's live connection. The page container owns the
		// request; this view only decides what the state means.
		function toolListView(t, server, tools) {
			const status = server.status;
			const inventory = tools && typeof tools === "object" ? tools : null;
			if (status !== "connected") {
				const key = status === "needs-auth" ? "toolsNeedsAuth"
					: status === "error" ? "toolsError"
						: status === "disabled" ? "toolsDisabled"
							: status === "connecting" || status === "authorizing" ? "toolsConnecting"
								: status === "conflict" ? "toolsConflict"
									: "toolsConfigured";
				return createElement("div", { className: "mm_tools" },
					createElement("div", { className: "mm_toolState" }, t(key)),
				);
			}
			const ready = inventory?.phase === "ready";
			const names = ready ? inventory.names : [];
			const count = ready ? names.length : server.toolCount;
			let body;
			if (inventory?.phase === "error") body = createElement("div", { className: "mm_err", title: inventory.error || undefined }, t("toolsLoadFailed"));
			else if (!ready) body = createElement("div", { className: "mm_toolState" }, t("toolsLoading"));
			else if (names.length === 0) body = createElement("div", { className: "mm_toolState" }, t("toolsEmpty"));
			else body = createElement("div", { className: "mm_toolList" },
				names.map((name) => createElement("code", { className: "mm_toolName", key: name }, name)),
			);
			return createElement("div", { className: "mm_tools" },
				createElement("div", { className: "mm_toolsHead" }, t("toolCount", { count: count ?? 0 })),
				body,
			);
		}

		// One shared card body for the global tier and the workspace tier. It is a
		// plain view function with no hooks: the per-tier rows keep owning their
		// requests (switch endpoint, auth endpoint, delete dialog) and this file
		// keeps one copy of the shared markup.
		function serverCardView({ t, server, tools, open, onToggle, actions, dialog, log }) {
			return createElement("div", { className: server.disabled ? "mm_row mm_rowDisabled" : "mm_row", "data-open": open ? "true" : undefined },
				createElement("div", { className: "mm_rowHead" },
					createElement("button", { className: "mm_cardContent", type: "button", "aria-expanded": open, onClick: onToggle },
						createElement("span", { className: "mm_name" }, server.name),
						createElement("span", { className: "mm_chevron", "data-open": open ? "true" : undefined },
							createElement("svg", { width: "12", height: "12", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
								createElement("path", { d: "M4 6l4 4 4-4", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" }),
							),
						),
					),
					createElement("span", { className: "mm_cardTrailing" },
						createElement("span", { className: `mm_statusDot ${server.status}`, "aria-hidden": "true" }),
						actions.authable
							? createElement("button", { className: `mm_badge auth ${server.status}`, type: "button", onClick: actions.onAuth, disabled: actions.busy, title: t("auth"), "aria-label": `${t("auth")}: ${server.name}` }, actions.busy ? "…" : t(server.status))
							: createElement("span", { className: `mm_badge ${server.status}` }, t(server.status)),
					),
				),
				actions.collapsedError && !open ? createElement("div", { className: "mm_collapsedErr", title: actions.collapsedError }, actions.collapsedError) : null,
				open ? createElement("div", { className: "mm_details" },
					actions.scopeIssue ? createElement("div", { className: "mm_err" }, actions.scopeMessage) : (server.error ? createElement("div", { className: "mm_err" }, server.error) : null),
					actions.error ? createElement("div", { className: "mm_err" }, actions.error) : null,
					toolListView(t, server, tools),
					createElement("div", { className: "mm_cardActions" },
						createElement("span", { className: "mm_switchRow" },
							createElement("button", { className: "mm_switch", type: "button", role: "switch", "data-on": actions.enabled ? "true" : undefined, "aria-checked": actions.enabled, "aria-label": actions.switchLabel, onClick: actions.onToggleEnabled, disabled: actions.busy },
								createElement("span", { className: "mm_switchThumb" }),
							),
							createElement("span", { className: "mm_switchText" }, t(actions.enabled ? "enabled" : "disabled")),
						),
						createElement("span", { className: "mm_actionBtns" },
							createElement(LogsToggle, { t, log }),
							createElement("button", { className: "mm_btn", type: "button", onClick: actions.onEdit, disabled: actions.busy }, t("edit")),
							createElement("button", { className: "mm_btn danger", type: "button", onClick: actions.onAskDelete, disabled: actions.busy }, t("delete")),
						),
					),
					createElement(AttemptLogPanel, { t, log }),
				) : null,
				dialog ? createElement("div", { className: "mm_overlay", onClick: dialog.onCancel },
					createElement("div", { className: "mm_dialog", onClick: (e) => e.stopPropagation() },
						createElement("div", { className: "mm_dialogTitle" }, dialog.title),
						createElement("div", { className: "mm_dialogBody" }, dialog.message),
						createElement("div", { className: "mm_dialogActions" },
							createElement("button", { className: "mm_btn", onClick: dialog.onCancel, disabled: actions.busy }, t("cancel")),
							createElement("button", { className: "mm_btn danger", onClick: dialog.onConfirm, disabled: actions.busy }, actions.busy ? "…" : t("delete")),
						),
					),
				) : null,
			);
		}

		function ServerRow({ t, server, tools, onChanged, onEdit, open, onToggle }) {
			const scopeInfo = server.oauth?.insufficientScope ?? server.insufficientScope ?? null;
			const scopeIssue = server.authMode === "oauth" && server.status === "needs-auth" && scopeInfo != null;
			const scopeMessage = scopeIssue ? t("insufficientScope", { scope: scopeInfo.scope ? ` (${scopeInfo.scope})` : "" }) : "";
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");
			const [confirming, setConfirming] = react.useState(false);
			const enabled = server.enabled !== false;
			const log = useAttemptLog(t, server.id);

			const startAuth = async () => {
				setBusy(true); setError("");
				try {
					const r = await api(`/servers/${server.id}/auth`, { method: "POST" });
					if (r.ok && r.body.authorizeUrl) { window.open(r.body.authorizeUrl, "_blank"); }
					else setError(r.body.error || t("authFailed", { status: r.status }));
				} catch (e) { setError(String(e)); }
				setBusy(false);
			};
			const remove = async () => {
				setConfirming(false);
				setBusy(true); setError("");
				try {
					const r = await api(`/servers/${server.id}`, { method: "DELETE" });
					if (!r.ok) setError(r.body.error || t("deleteFailed", { status: r.status }));
					onChanged();
				} catch (e) { setError(String(e)); }
				setBusy(false);
			};
			const toggleEnabled = async () => {
				setBusy(true); setError("");
				try {
					const r = await api(`/servers/${server.id}/enabled`, { method: "POST", body: JSON.stringify({ enabled: !enabled }) });
					if (!r.ok) setError(r.body.error || t(enabled ? "disableFailed" : "enableFailed", { status: r.status }));
					onChanged();
				} catch (e) { setError(String(e)); }
				setBusy(false);
			};

			// The status chip is the authentication action when authentication is
			// what the server needs. A connected server has no re-auth control: the
			// chip is a status label then, and Edit holds the configuration.
			return serverCardView({
				t, server, tools, open, onToggle, log,
				actions: {
					enabled, busy, error,
					authable: enabled && server.authMode === "oauth" && server.status === "needs-auth",
					scopeIssue,
					scopeMessage,
					collapsedError: scopeIssue ? scopeMessage : server.error,
					onAuth: startAuth,
					onToggleEnabled: toggleEnabled,
					onEdit,
					onAskDelete: () => setConfirming(true),
				},
				dialog: confirming ? {
					title: t("deleteServer"),
					message: t("confirmDelete", { name: server.name }),
					onCancel: () => setConfirming(false),
					onConfirm: remove,
				} : null,
			});
		}

		function ServerForm({ t, initial, onDone, onCancel, scope, workspacePath, workspaces }) {
			const editing = initial != null;
			const [formScope, setFormScope] = react.useState(scope ?? "user");
			const [wsPath, setWsPath] = react.useState(workspacePath ?? "");
			const [type, setType] = react.useState(initial?.type ?? "http");
			const [name, setName] = react.useState(initial?.name ?? "");
			const [url, setUrl] = react.useState(initial?.url ?? "");
			const [authMode, setAuthMode] = react.useState(initial?.authMode ?? "oauth");
			const [tokenEnv, setTokenEnv] = react.useState(initial?.tokenEnv ?? "");
			const [clientId, setClientId] = react.useState(initial?.clientId ?? "");
			const [clientSecretEnv, setClientSecretEnv] = react.useState(initial?.clientSecretEnv ?? "");
			const [clientName, setClientName] = react.useState(initial?.clientName ?? "");
			const [oauthScope, setOauthScope] = react.useState(initial?.scope ?? "");
			const [redirectUrl, setRedirectUrl] = react.useState(initial?.redirectUrl ?? "");
			const [headersList, setHeadersList] = react.useState(initial?.headers ? Object.entries(initial.headers).map(([k, v]) => ({ key: k, value: String(v) })) : [{ key: "", value: "" }]);
			const [headerEnvList, setHeaderEnvList] = react.useState(initial?.headerEnv ? Object.entries(initial.headerEnv).map(([k, v]) => ({ key: k, value: String(v) })) : [{ key: "", value: "" }]);
			const [command, setCommand] = react.useState(initial?.command ?? "");
			const [argsList, setArgsList] = react.useState((initial?.args ?? []).length ? initial.args.map(String) : [""]);
			const [envList, setEnvList] = react.useState(initial?.env ? Object.entries(initial.env).map(([k, v]) => ({ key: k, value: String(v) })) : [{ key: "", value: "" }]);
			const [cwd, setCwd] = react.useState(initial?.cwd ?? "");
			const [timeout, setTimeoutValue] = react.useState(initial?.timeout ?? "");
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");

			const isWorkspace = formScope === "workspace";

			const submit = async () => {
				if (isWorkspace && !wsPath) { setError(t("chooseWorkspaceError")); return; }
				setBusy(true); setError("");
				try {
					const body = type === "stdio"
						? {
							name, type: "stdio", command, cwd,
							args: argsList.map((a) => a.trim()).filter(Boolean),
							env: envList.reduce((acc, e) => { const k = e.key.trim(); if (k) acc[k] = e.value; return acc; }, {}),
						}
						: {
							name, type: "http", url, authMode,
							headers: headersList.reduce((acc, e) => { const k = e.key.trim(); if (k) acc[k] = e.value; return acc; }, {}),
							headerEnv: headerEnvList.reduce((acc, e) => { const k = e.key.trim(); if (k) acc[k] = e.value; return acc; }, {}),
							...(authMode === "static" ? { tokenEnv } : {}),
							...(authMode === "oauth" ? { clientId, clientSecretEnv, clientName, scope: oauthScope, redirectUrl } : {}),
						};
					body.timeout = timeout;
					let r;
					if (isWorkspace) {
						r = editing
							? await api("/workspaces/servers", { method: "PUT", body: JSON.stringify({ path: wsPath, oldName: initial.name, ...body }) })
							: await api("/workspaces/servers", { method: "POST", body: JSON.stringify({ path: wsPath, ...body }) });
					} else {
						r = editing
							? await api(`/servers/${initial.id}`, { method: "PUT", body: JSON.stringify(body) })
							: await api("/servers", { method: "POST", body: JSON.stringify(body) });
					}
					if (r.ok) onDone();
					else setError(r.body.error || t(editing ? "saveFailed" : "addFailed", { status: r.status }));
				} catch (e) { setError(String(e)); }
				setBusy(false);
			};

			return createElement("div", { className: "mm_row mm_add" },
				createElement("div", { className: "mm_form" },
					createElement("label", { className: "wide" }, t("scope"),
						createElement("select", { value: formScope, disabled: editing, onChange: (e) => setFormScope(e.target.value) },
							createElement("option", { value: "user" }, t("userScope")),
							createElement("option", { value: "workspace" }, t("workspaceScope")),
						),
					),
					isWorkspace ? createElement("label", { className: "wide" }, t("workspace"),
						createElement("select", { value: wsPath, disabled: editing, onChange: (e) => setWsPath(e.target.value) },
							createElement("option", { value: "" }, t("chooseWorkspace")),
							(workspaces ?? []).map((w) => createElement("option", { value: w, key: w }, w)),
						),
					) : null,
					createElement("label", null, t("type"),
						createElement("select", { value: type, onChange: (e) => setType(e.target.value) },
							createElement("option", { value: "http" }, t("http")),
							createElement("option", { value: "stdio" }, t("stdio")))),
					createElement("label", null, t("name"),
						createElement("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: t("namePlaceholder") })),
					createElement("label", null, t("toolTimeout"),
						createElement("input", { type: "number", min: 1000, step: 1000, value: timeout, onChange: (e) => setTimeoutValue(e.target.value) })),
					type === "stdio"
						? [
							createElement("label", { className: "wide" }, t("command"),
								createElement("input", { value: command, onChange: (e) => setCommand(e.target.value), placeholder: t("commandPlaceholder") })),
							createElement("label", { className: "wide" }, t("arguments"),
								...argsList.map((arg, i) => createElement("div", { className: "mm_kv", key: i },
									createElement("input", { value: arg, onChange: (e) => setArgsList(argsList.map((v, idx) => idx === i ? e.target.value : v)), placeholder: t("argumentValue") }),
									createElement("button", { className: "mm_btn", onClick: () => setArgsList(argsList.filter((_, idx) => idx !== i)), disabled: busy }, "✕"),
								)),
								createElement("button", { className: "mm_btn", onClick: () => setArgsList([...argsList, ""]), disabled: busy }, t("addArgument")),
							),
							createElement("label", { className: "wide" }, t("environment"),
								...envList.map((e, i) => createElement("div", { className: "mm_kv", key: i },
									createElement("input", { value: e.key, onChange: (ev) => setEnvList(envList.map((v, idx) => idx === i ? { ...v, key: ev.target.value } : v)), placeholder: t("keyUpper") }),
									createElement("input", { value: e.value, onChange: (ev) => setEnvList(envList.map((v, idx) => idx === i ? { ...v, value: ev.target.value } : v)), placeholder: t("valueUpper") }),
									createElement("button", { className: "mm_btn", onClick: () => setEnvList(envList.filter((_, idx) => idx !== i)), disabled: busy }, "✕"),
								)),
								createElement("button", { className: "mm_btn", onClick: () => setEnvList([...envList, { key: "", value: "" }]), disabled: busy }, t("addEnvironment")),
							),
							createElement("label", { className: "wide" }, t("cwd"),
								createElement("input", { value: cwd, onChange: (e) => setCwd(e.target.value), placeholder: t("cwdPlaceholder") })),
						]
						: [
							createElement("label", { className: "wide" }, t("url"),
								createElement("input", { value: url, onChange: (e) => setUrl(e.target.value), placeholder: t("urlPlaceholder") })),
							createElement("label", { className: "wide" }, t("authMode"),
								createElement("select", { value: authMode, onChange: (e) => setAuthMode(e.target.value) },
									createElement("option", { value: "oauth" }, t("oauth")),
									createElement("option", { value: "static" }, t("bearer")),
									createElement("option", { value: "none" }, t("noAuthOption")))),
							authMode === "static"
								? createElement("label", { className: "wide" }, t("tokenEnv"),
									createElement("input", { value: tokenEnv, onChange: (e) => setTokenEnv(e.target.value), placeholder: t("tokenEnvPlaceholder") }))
								: null,
							authMode === "oauth"
								? [
									createElement("label", null, t("clientId"),
										createElement("input", { value: clientId, onChange: (e) => setClientId(e.target.value), placeholder: "Ov23li…" })),
									createElement("label", null, t("clientSecretEnv"),
										createElement("input", { value: clientSecretEnv, onChange: (e) => setClientSecretEnv(e.target.value), placeholder: "GITHUB_OAUTH_CLIENT_SECRET" })),
									createElement("label", null, t("clientName"),
										createElement("input", { value: clientName, onChange: (e) => setClientName(e.target.value), placeholder: t("clientNamePlaceholder") })),
									createElement("label", { className: "wide" }, t("oauthScope"),
										createElement("input", { value: oauthScope, onChange: (e) => setOauthScope(e.target.value), placeholder: "repo read:org" })),
									createElement("label", { className: "wide" }, t("redirectUrl"),
										createElement("div", { className: "mm_kv" },
											createElement("input", { value: redirectUrl, onChange: (e) => setRedirectUrl(e.target.value), placeholder: initial?.redirectDefaultUri || t("redirectUrlAutoPlaceholder") }),
											redirectUrl.trim() ? createElement("button", { className: "mm_btn", type: "button", onClick: () => setRedirectUrl(""), disabled: busy }, t("redirectUrlReset")) : null,
										),
										createElement("span", { className: "mm_meta" }, initial?.redirectDefaultUri ? t("redirectUrlHint") : t("redirectUrlHintAuto")),
										initial && initial.authMode === "oauth" && redirectUrl.trim() === (initial.redirectUrl ?? "")
											? createElement(RedirectDetails, { t, server: initial })
											: null,
										redirectUrl.trim() && redirectUrl.trim() !== (initial?.redirectUrl ?? "")
											? createElement("span", { className: "mm_pending" }, t(initial?.clientId ? "redirectUrlManualNotice" : "redirectUrlNotice"))
											: null,
									),
								]
								: null,
							createElement("label", { className: "wide" }, t("headers"),
								...headersList.map((e, i) => createElement("div", { className: "mm_kv", key: i },
									createElement("input", { value: e.key, onChange: (ev) => setHeadersList(headersList.map((v, idx) => idx === i ? { ...v, key: ev.target.value } : v)), placeholder: t("key") }),
									createElement("input", { value: e.value, onChange: (ev) => setHeadersList(headersList.map((v, idx) => idx === i ? { ...v, value: ev.target.value } : v)), placeholder: t("value") }),
									createElement("button", { className: "mm_btn", onClick: () => setHeadersList(headersList.filter((_, idx) => idx !== i)), disabled: busy }, "✕"),
								)),
								createElement("button", { className: "mm_btn", onClick: () => setHeadersList([...headersList, { key: "", value: "" }]), disabled: busy }, t("addHeader")),
							),
							createElement("label", { className: "wide" }, t("headerEnv"),
								...headerEnvList.map((e, i) => createElement("div", { className: "mm_kv", key: i },
									createElement("input", { value: e.key, onChange: (ev) => setHeaderEnvList(headerEnvList.map((v, idx) => idx === i ? { ...v, key: ev.target.value } : v)), placeholder: t("key") }),
									createElement("input", { value: e.value, onChange: (ev) => setHeaderEnvList(headerEnvList.map((v, idx) => idx === i ? { ...v, value: ev.target.value } : v)), placeholder: t("envName") }),
									createElement("button", { className: "mm_btn", onClick: () => setHeaderEnvList(headerEnvList.filter((_, idx) => idx !== i)), disabled: busy }, "✕"),
								)),
								createElement("button", { className: "mm_btn", onClick: () => setHeaderEnvList([...headerEnvList, { key: "", value: "" }]), disabled: busy }, t("addVariable")),
							),
						],
				),
				error ? createElement("div", { className: "mm_err" }, error) : null,
				createElement("div", { className: "mm_actions" },
					createElement("button", { className: "mm_btn", onClick: submit, disabled: busy || !name || (isWorkspace && !wsPath) || (type === "stdio" ? !command : !url) }, busy ? "…" : t("save")),
					createElement("button", { className: "mm_btn", onClick: onCancel, disabled: busy }, t("cancel")),
				),
			);
		}

		function WorkspaceServerRow({ t, server, tools, workspacePath, onChanged, onEdit, open, onToggle }) {
			const scopeInfo = server.oauth?.insufficientScope ?? server.insufficientScope ?? null;
			const scopeIssue = server.authMode === "oauth" && server.status === "needs-auth" && scopeInfo != null;
			const scopeMessage = scopeIssue ? t("insufficientScope", { scope: scopeInfo.scope ? ` (${scopeInfo.scope})` : "" }) : "";
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");
			const [confirming, setConfirming] = react.useState(false);
			const enabled = server.disabled !== true;
			const log = useAttemptLog(t, server.id);
			const toggleEnabled = async (nextEnabled) => {
				setBusy(true); setError("");
				try {
					const r = await api("/workspaces/server-state", { method: "POST", body: JSON.stringify({ path: workspacePath, name: server.name, enabled: nextEnabled }) });
					if (!r.ok) setError(r.body.error || t("workspaceToggleFailed", { status: r.status }));
					onChanged();
				} catch (e) { setError(String(e)); }
				setBusy(false);
			};
			const startAuth = async () => {
				setBusy(true); setError("");
				try {
					const r = await api("/workspaces/auth", { method: "POST", body: JSON.stringify({ path: workspacePath, name: server.name }) });
					if (r.ok && r.body.authorizeUrl) window.open(r.body.authorizeUrl, "_blank");
					else setError(r.body.error || t("authFailed", { status: r.status }));
				} catch (e) { setError(String(e)); }
				setBusy(false);
			};
			const remove = async () => {
				setConfirming(false);
				setBusy(true); setError("");
				try {
					const r = await api("/workspaces/servers/delete", { method: "POST", body: JSON.stringify({ path: workspacePath, name: server.name }) });
					if (!r.ok) setError(r.body.error || t("deleteFailed", { status: r.status }));
					onChanged();
				} catch (e) { setError(String(e)); }
				setBusy(false);
			};
			return serverCardView({
				t, server, tools, open, onToggle, log,
				actions: {
					enabled, busy, error,
					authable: enabled && server.authMode === "oauth" && server.status === "needs-auth",
					scopeIssue,
					scopeMessage,
					collapsedError: scopeIssue ? scopeMessage : server.error,
					switchLabel: `${t("workspaceEnabled")}: ${server.name}`,
					onAuth: startAuth,
					onToggleEnabled: () => toggleEnabled(!enabled),
					onEdit,
					onAskDelete: () => setConfirming(true),
				},
				dialog: confirming ? {
					title: t("deleteWorkspaceServer"),
					message: t("confirmWorkspaceDelete", { name: server.name }),
					onCancel: () => setConfirming(false),
					onConfirm: remove,
				} : null,
			});
		}

		function GlobalMaskRow({ t, server, enabled, onToggleEnabled, onEdit, busy }) {
			return createElement("div", { className: server.status === "disabled" ? "mm_wsServer mm_rowDisabled" : "mm_wsServer", key: server.id },
				createElement("span", { className: `mm_statusDot ${server.status}`, "aria-hidden": "true" }),
				createElement("span", { className: "mm_name" }, server.name),
				createElement("span", { className: `mm_badge ${server.status}` }, t(server.status)),
				createElement("span", { className: "mm_switchRow" },
					createElement("span", { className: "mm_switchText" }, t("workspaceEnabled")),
					createElement("button", { className: "mm_switch", type: "button", role: "switch", "data-on": enabled ? "true" : undefined, "aria-checked": enabled, "aria-label": `${t("workspaceEnabled")}: ${server.name}`, onClick: () => onToggleEnabled(server.name, !enabled), disabled: busy || server.status === "disabled" },
						createElement("span", { className: "mm_switchThumb" }),
					),
				),
				createElement("button", { className: "mm_btn", onClick: onEdit, disabled: busy }, t("edit")),
			);
		}

		// Global callback configuration, collapsed by default. The header keeps the
		// current mode, the number of active listeners and an error indicator
		// visible, so a port conflict is noticeable without expanding anything.
		function CallbackSettings({ t, settings, onSaved }) {
			const current = settings.oauthCallback ?? { mode: "automatic", host: "localhost", port: null, path: "/callback" };
			const status = settings.callbackStatus ?? { listeners: [], lastError: "" };
			// The draft is null until the operator edits something, so the fields
			// always show the stored configuration the poll just delivered. A
			// useState initializer would freeze the values from the first render,
			// which happens before /settings resolves — and saving would then
			// write those defaults back over a real configuration.
			const [draft, setDraft] = react.useState(null);
			const mode = draft ? draft.mode : current.mode;
			const host = draft ? draft.host : (current.host ?? "localhost");
			const port = draft ? draft.port : (current.port ? String(current.port) : "");
			const path = draft ? draft.path : (current.path ?? "/callback");
			const edit = (patch) => setDraft({ mode, host, port, path, ...patch });
			const [open, setOpen] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");
			const [saved, setSaved] = react.useState(false);
			const save = async () => {
				setBusy(true); setError(""); setSaved(false);
				try {
					const r = await api("/settings/callback", {
						method: "PUT",
						body: JSON.stringify({ mode, host, port: mode === "fixed" ? port : "", path }),
					});
					if (r.ok) { setSaved(true); setDraft(null); onSaved(); }
					else setError(r.body.error || t("callbackSaveFailed"));
				} catch (e) { setError(String(e)); }
				setBusy(false);
			};
			const listeners = status.listeners ?? [];
			const statusLine = t("callbackStatusLine", {
				mode: t(current.mode === "fixed" ? "callbackModeFixed" : "callbackModeAuto"),
				count: listeners.length,
			});
			return createElement("div", { className: "mm_row" },
				createElement("button", { className: "mm_cardContent", type: "button", onClick: () => setOpen(!open), "aria-expanded": open, "aria-label": t("callbackTitle") },
					createElement("span", { className: "mm_featureText" },
						createElement("span", { className: "mm_featureTitle" }, t("callbackTitle")),
						createElement("span", { className: "mm_featureMeta" }, statusLine),
					),
					status.lastError ? createElement("span", { className: "mm_badge error" }, t("callbackErrorBadge")) : null,
					createElement("span", { className: "mm_chevron", "data-open": open ? "true" : undefined }, "\u25be"),
				),
				open ? createElement("div", { className: "mm_details" },
					createElement("div", { className: "mm_form" },
						createElement("label", null, t("callbackMode"),
							createElement("select", { value: mode, onChange: (e) => edit({ mode: e.target.value }) },
								createElement("option", { value: "automatic" }, t("callbackModeAuto")),
								createElement("option", { value: "fixed" }, t("callbackModeFixed")),
							),
						),
						mode === "fixed" ? createElement("label", null, t("callbackHost"),
							createElement("input", { value: host, onChange: (e) => edit({ host: e.target.value }), placeholder: "localhost" }),
						) : null,
						mode === "fixed" ? createElement("label", null, t("callbackPort"),
							createElement("input", { value: port, onChange: (e) => edit({ port: e.target.value }), inputMode: "numeric", placeholder: "8765" }),
						) : null,
						createElement("label", { className: "wide" }, t("callbackPath"),
							createElement("input", { value: path, onChange: (e) => edit({ path: e.target.value }), placeholder: "/callback" }),
						),
					),
					createElement("span", { className: "mm_meta" }, mode === "fixed" ? t("callbackFixedHint") : t("callbackAutoHint")),
					createElement("div", { className: "mm_cardActions" },
						createElement("button", { className: "mm_btn primary", type: "button", onClick: save, disabled: busy }, t("callbackSave")),
						saved ? createElement("span", { className: "mm_pending" }, t("callbackSaved")) : null,
					),
					error ? createElement("div", { className: "mm_err" }, error) : null,
					status.configError ? createElement("div", { className: "mm_err" }, status.configError) : null,
					createElement("div", { className: "mm_groupTitle" }, t("callbackListeners")),
					listeners.length
						? createElement("div", { className: "mm_wsList" },
							listeners.map((listener) => createElement("div", { className: "mm_meta", key: String(listener.port) },
								t("callbackListenerRow", {
									addresses: (listener.addresses ?? []).map((address) => `${address}:${listener.port}`).join(", "),
									pending: listener.pending ?? 0,
								}),
							)),
						)
						: createElement("div", { className: "mm_meta" }, t("callbackNoListeners")),
					status.lastError ? createElement("div", null,
						createElement("div", { className: "mm_groupTitle" }, t("callbackLastError")),
						createElement("div", { className: "mm_err" }, status.lastError),
					) : null,
				) : null,
			);
		}

		function McpContent({ t }) {
			const [servers, setServers] = react.useState([]);
			const [workspaces, setWorkspaces] = react.useState([]);
			const [settings, setSettings] = react.useState({ onDemandToolInjection: true, oauthCallback: null, callbackStatus: null });
			const [selected, setSelected] = react.useState("");
			const [view, setView] = react.useState("list"); // list | add | edit-global | edit-ws
			const [editingId, setEditingId] = react.useState(null);
			const [editingName, setEditingName] = react.useState(null);
			const [query, setQuery] = react.useState("");
			const [expandedId, setExpandedId] = react.useState(null);
			const [excludeBusy, setExcludeBusy] = react.useState(false);
			const [settingsBusy, setSettingsBusy] = react.useState(false);
			const [settingsError, setSettingsError] = react.useState("");
			const [toolLists, setToolLists] = react.useState({});
			// A stable token per server id: a slower response for an older request
			// must never overwrite the current inventory. useState's lazy
			// initializer gives a box that survives renders without a ref hook, so
			// the page stays renderable by the test harness.
			const toolRequests = react.useState(() => ({ next: 1, current: {} }))[0];
			// Latest expanded id for the poll: the interval keeps one callback, so it
			// reads this box instead of being re-created on every expand/collapse.
			const expandedRef = react.useState(() => ({ current: null }))[0];
			expandedRef.current = expandedId;
			const clearTools = react.useCallback((id) => {
				if (id == null) return;
				toolRequests.current[id] = toolRequests.next++; // a late response is ignored
				setToolLists((prev) => {
					if (!(id in prev)) return prev;
					const next = { ...prev };
					delete next[id];
					return next;
				});
			}, [toolRequests]);
			const loadTools = react.useCallback(async (id) => {
				const token = toolRequests.next++;
				toolRequests.current[id] = token;
				// A repeat read keeps the current state visible: only the first read
				// shows the loading message, and a failing background refresh must not
				// blank a list the operator is reading (the next poll retries it).
				setToolLists((prev) => (prev[id] ? prev : { ...prev, [id]: { phase: "loading" } }));
				try {
					const r = await api(`/servers/${id}/tools`);
					if (toolRequests.current[id] !== token) return;
					if (r.ok) setToolLists((prev) => ({ ...prev, [id]: { phase: "ready", names: Array.isArray(r.body.tools) ? r.body.tools : [] } }));
					else setToolLists((prev) => (prev[id]?.phase === "loading"
						? { ...prev, [id]: { phase: "error", error: r.body.error ?? "", status: r.status } }
						: prev));
				} catch (e) {
					if (toolRequests.current[id] !== token) return;
					setToolLists((prev) => (prev[id]?.phase === "loading"
						? { ...prev, [id]: { phase: "error", error: String(e) } }
						: prev));
				}
			}, [toolRequests]);
			const refresh = react.useCallback(() => {
				Promise.all([api("/servers"), api("/workspaces"), api("/settings")]).then(([sr, wr, tr]) => {
					const listedServers = sr.ok ? (sr.body.servers ?? []) : [];
					const listedWorkspaces = wr.ok ? (wr.body.workspaces ?? []) : [];
					if (sr.ok) setServers(listedServers);
					if (wr.ok) setWorkspaces(listedWorkspaces);
					if (tr.ok) setSettings({
						onDemandToolInjection: tr.body.onDemandToolInjection !== false,
						oauthCallback: tr.body.oauthCallback ?? null,
						callbackStatus: tr.body.callbackStatus ?? null,
					});
					const id = expandedRef.current;
					if (!id) return;
					const expanded = listedServers.find((s) => s.id === id)
						?? listedWorkspaces.flatMap((w) => w.servers ?? []).find((s) => s.id === id);
					// Only a live connection has an inventory to read; a card that left
					// `connected` also drops its cached names, so a later reconnect
					// cannot flash the previous connection's tools.
					if (expanded?.status === "connected") loadTools(id);
					else if (expanded) clearTools(id);
				}).catch(() => {});
			}, [loadTools, clearTools]);
			react.useEffect(() => {
				refresh();
				const t = setInterval(refresh, 3000);
				return () => clearInterval(t);
			}, [refresh]);
			// Drop the selection if the workspace disappeared.
			react.useEffect(() => {
				if (selected && !workspaces.some((w) => w.path === selected)) setSelected("");
			}, [workspaces, selected]);

			const selectedWs = workspaces.find((w) => w.path === selected) ?? null;
			const wsServers = selectedWs?.servers ?? [];
			const excludeSet = new Set(selectedWs?.exclude ?? []);
			const disabledSet = new Set(selectedWs?.disabled ?? []);
			const normalizedQuery = query.trim().toLocaleLowerCase();
			const filteredServers = servers.filter((s) => s.name.toLocaleLowerCase().includes(normalizedQuery));

			const toggleWorkspaceServer = async (serverName, enabled) => {
				if (!selected) return;
				setExcludeBusy(true);
				try {
					const r = await api("/workspaces/server-state", { method: "POST", body: JSON.stringify({ path: selected, name: serverName, enabled }) });
					if (r.ok) refresh();
				} catch (e) { /* transient */ }
				setExcludeBusy(false);
			};

			const toggleOnDemand = async () => {
				setSettingsBusy(true); setSettingsError("");
				try {
					const enabled = !settings.onDemandToolInjection;
					const r = await api("/settings/on-demand", { method: "POST", body: JSON.stringify({ enabled }) });
					if (r.ok) setSettings({ ...settings, onDemandToolInjection: r.body.onDemandToolInjection === true });
					else setSettingsError(r.body.error || t("toggleFailed", { status: r.status }));
				} catch (e) { setSettingsError(String(e)); }
				setSettingsBusy(false);
			};

			const toggleCard = (server) => {
				const next = expandedId === server.id ? null : server.id;
				if (next === null) clearTools(server.id);
				setExpandedId(next);
				if (next && server.status === "connected") loadTools(next);
			};

			const addBtn = createElement("button", { className: "mm_addBtn", type: "button", "aria-label": t("addServer"), title: t("addServer"), onClick: () => setView("add") },
				createElement("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
					createElement("path", { d: "M8 3.5v9", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }),
					createElement("path", { d: "M3.5 8h9", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }),
				),
			);

			if (view === "add") {
				return createElement("div", { className: "mm_section" },
					createElement("div", { className: "mm_catalogHeading" }, createElement("h3", null, t("addServer"))),
					react.createElement(ServerForm, { t, scope: selected ? "workspace" : "user", workspacePath: selected || "", workspaces: workspaces.map((w) => w.path), onDone: () => { setView("list"); refresh(); }, onCancel: () => setView("list") }),
				);
			}
			const globalEditing = view === "edit-global" ? (servers.find((s) => s.id === editingId) ?? null) : null;
			if (view === "edit-global" && globalEditing) {
				return createElement("div", { className: "mm_section" },
					createElement("div", { className: "mm_catalogHeading" }, createElement("h3", null, t("editGlobal"))),
					react.createElement(ServerForm, { t, initial: globalEditing, scope: "user", onDone: () => { setView("list"); refresh(); }, onCancel: () => setView("list") }),
				);
			}
			const wsEditing = view === "edit-ws" && selectedWs ? (selectedWs.servers.find((s) => s.name === editingName) ?? null) : null;
			if (view === "edit-ws" && selected && wsEditing) {
				return createElement("div", { className: "mm_section" },
					createElement("div", { className: "mm_catalogHeading" }, createElement("h3", null, t("editWorkspace"))),
					createElement("div", { className: "mm_wsPathHint" }, selected),
					react.createElement(ServerForm, { t, initial: wsEditing, scope: "workspace", workspacePath: selected, onDone: () => { setView("list"); refresh(); }, onCancel: () => setView("list") }),
				);
			}

			return createElement("div", { className: "mm_section" },
				createElement("div", { className: "mm_catalogHeading" },
					createElement("h3", null, t("servers")),
					createElement("span", null, selected ? (servers.length + wsServers.length) : servers.length),
				),
				createElement("div", { className: "mm_feature" },
					createElement("span", { className: "mm_featureText" },
						createElement("span", { className: "mm_featureTitle" }, t("onDemand")),
						createElement("span", { className: "mm_featureMeta" }, t("onDemandHelp")),
					),
					createElement("span", { className: "mm_switchRow" },
						createElement("button", { className: "mm_switch", type: "button", role: "switch", "data-on": settings.onDemandToolInjection ? "true" : undefined, "aria-checked": settings.onDemandToolInjection, "aria-label": t("onDemand"), onClick: toggleOnDemand, disabled: settingsBusy },
							createElement("span", { className: "mm_switchThumb" }),
						),
						createElement("span", { className: "mm_switchText" }, settings.onDemandToolInjection ? t("on") : t("off")),
					),
				),
				settingsError ? createElement("div", { className: "mm_err" }, settingsError) : null,
				createElement(CallbackSettings, { t, settings, onSaved: refresh }),
				createElement("div", { className: "mm_wsBar" },
					createElement("select", { className: "mm_wsSelect", value: selected, onChange: (e) => { clearTools(expandedId); setSelected(e.target.value); setExpandedId(null); setQuery(""); } },
						createElement("option", { value: "" }, t("global")),
						workspaces.map((w) => createElement("option", { value: w.path, key: w.path }, w.path.split("/").filter(Boolean).pop() || w.path)),
					),
					selected ? addBtn : null,
				),
				selected ? createElement("div", { className: "mm_wsPathHint" }, selected) : null,
				selectedWs?.error ? createElement("div", { className: "mm_err" }, selectedWs.error) : null,
				selected
					? [
						createElement("div", { className: "mm_groupTitle" }, t("workspaceServers")),
						wsServers.length > 0
							? createElement("div", { className: "mm_wsList" },
								wsServers.map((s) => react.createElement(WorkspaceServerRow, { t, server: s, tools: toolLists[s.id], workspacePath: selected, onChanged: refresh, onEdit: () => { setEditingName(s.name); setView("edit-ws"); }, open: expandedId === s.id, onToggle: () => toggleCard(s), key: s.name })),
							)
							: createElement("div", { className: "mm_meta" }, t("emptyWorkspace")),
						createElement("div", { className: "mm_groupTitle" }, t("globalServers")),
						servers.length > 0
							? createElement("div", { className: "mm_wsList" },
								servers.map((g) => react.createElement(GlobalMaskRow, { t, server: g, enabled: !(excludeSet.has(g.name) || disabledSet.has(g.name)), onToggleEnabled: toggleWorkspaceServer, onEdit: () => { setEditingId(g.id); setView("edit-global"); }, busy: excludeBusy, key: g.id })),
							)
							: createElement("div", { className: "mm_meta" }, t("emptyGlobal")),
					]
					: [
						createElement("div", { className: "mm_toolbar" },
							createElement("label", { className: "mm_search" },
								createElement("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
									createElement("circle", { cx: "7", cy: "7", r: "5", stroke: "currentColor", strokeWidth: "1.5" }),
									createElement("path", { d: "M11 11l3 3", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }),
								),
								createElement("input", { type: "search", value: query, placeholder: t("search"), "aria-label": t("search"), onChange: (e) => setQuery(e.target.value) }),
							),
							addBtn,
						),
						createElement("div", { className: "mm_cards" },
							filteredServers.map((s) => react.createElement(ServerRow, { t, server: s, tools: toolLists[s.id], onChanged: refresh, onEdit: () => { setEditingId(s.id); setView("edit-global"); }, open: expandedId === s.id, onToggle: () => toggleCard(s), key: s.id })),
						),
					],
			);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("mcp", { zh, en }), "dsh-mcp-manager: dictionaries");
			const t = ctx.locale.bind("mcp");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "mcp-manager",
				order: 50,
				label: () => t("sectionLabel"),
				locale: "mcp",
			}, McpContent));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
