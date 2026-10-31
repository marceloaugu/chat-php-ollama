let currentConversationId = null;
let currentAbortController = null;
let currentTypewriterTask = null;
let installedModelsGlobal = [];
let reasoningEnabled = localStorage.getItem('reasoningEnabled') !== 'false'; // Padrão: ativado

const TARGET_MODELS = [
    { name: 'Llama 3 (8B)', id: 'llama3', reasoning: false },
    { name: 'Llama 3.1 (8B)', id: 'llama3.1', reasoning: false },
    { name: 'Llama 3.2 (1B)', id: 'llama3.2:1b', reasoning: false },
    { name: 'Llama 3.2 (3B)', id: 'llama3.2:3b', reasoning: false },
    { name: 'Phi-3 Mini (3.8B)', id: 'phi3:mini', reasoning: false },
    { name: 'Phi-3.5 Mini (3.8B)', id: 'phi3.5', reasoning: false },
    { name: 'Mistral v0.3 (7B)', id: 'mistral:v0.3', reasoning: false },
    { name: 'DeepSeek-R1 (1.5B)', id: 'deepseek-r1:1.5b', reasoning: true },
    { name: 'DeepSeek-R1 (7B)', id: 'deepseek-r1:7b', reasoning: true },
    { name: 'DeepSeek-R1 (8B)', id: 'deepseek-r1:8b', reasoning: true },
    { name: 'Gemma 2 (2B)', id: 'gemma2:2b', reasoning: false },
    { name: 'Gemma 2 (9B)', id: 'gemma2:9b', reasoning: false },
    { name: 'Qwen 2.5 (7B)', id: 'qwen2.5:7b', reasoning: false }
];

function isReasoningModel(modelId) {
    if (!modelId) return false;
    const name = modelId.toLowerCase().trim();
    
    // Verifica explicitamente na lista pré-configurada
    const target = TARGET_MODELS.find(t => t.id.toLowerCase() === name || t.id.toLowerCase().replace(/:latest$/, '') === name.replace(/:latest$/, ''));
    if (target && typeof target.reasoning === 'boolean') {
        return target.reasoning;
    }
    
    // Padrões conhecidos de modelos com raciocínio integrado (Chain-of-Thought)
    return name.includes('deepseek-r1') ||
           name.includes('qwq') ||
           name.includes('marco-o1') ||
           name.includes('reasoner') ||
           name.includes('reasoning') ||
           /\br1\b/.test(name) ||
           /\bo[13]\b/.test(name);
}

function updateReasoningUI() {
    const btn = document.getElementById('think-toggle-btn');
    const label = document.getElementById('think-toggle-label');
    if (!btn || !label) return;
    
    const select = document.getElementById('model-select');
    const currentModel = select ? select.value : '';
    const supportsReasoning = isReasoningModel(currentModel);
    
    if (!supportsReasoning) {
        // Modelo não suporta raciocínio -> oculta o seletor da interface
        btn.style.display = 'none';
        btn.disabled = true;
        return;
    }
    
    // Modelo suporta raciocínio -> exibe o botão e aplica o estado ativo/inativo
    btn.style.display = 'inline-flex';
    btn.disabled = false;
    
    if (reasoningEnabled) {
        btn.classList.add('active');
        btn.title = "Raciocínio ativado (Chain-of-Thought). Clique para desativar e obter respostas diretas e rápidas.";
        label.innerText = "Raciocínio ON";
    } else {
        btn.classList.remove('active');
        btn.title = "Raciocínio desativado. Clique para ativar o processo de pensamento.";
        label.innerText = "Raciocínio OFF";
    }
}

function toggleReasoning() {
    reasoningEnabled = !reasoningEnabled;
    localStorage.setItem('reasoningEnabled', reasoningEnabled ? 'true' : 'false');
    updateReasoningUI();
}

const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="white"><path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.109zM6.637 10.07l7.494-7.494-4.747 4.747L6.637 10.07z"/></svg>';
const STOP_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="white"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMarkdown(text) {
    return DOMPurify.sanitize(marked.parse(text));
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

async function createNewChat() {
    const res = await fetch('api.php?action=new_conversation');
    const data = await res.json();
    currentConversationId = data.id;
    document.getElementById('chat-messages').innerHTML = '';
    loadHistory();
}

async function loadHistory() {
    const res = await fetch('api.php?action=list_conversations');
    const data = await res.json();
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    data.forEach(chat => {
        const item = document.createElement('div');
        item.className = `history-item ${chat.id == currentConversationId ? 'active' : ''}`;
        item.innerText = chat.title;
        item.onclick = () => selectChat(chat.id);
        list.appendChild(item);
    });
}

async function selectChat(id) {
    currentConversationId = id;
    loadHistory();
    const res = await fetch(`api.php?action=get_messages&conversation_id=${id}`);
    const messages = await res.json();
    const chatBox = document.getElementById('chat-messages');
    chatBox.innerHTML = '';
    messages.forEach(msg => {
        let metricsObj = null;
        if (msg.metrics) {
            try {
                metricsObj = JSON.parse(msg.metrics);
            } catch (e) {
                metricsObj = null;
            }
        }
        addMessage(msg.role, msg.content, false, metricsObj);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
}

function parseThoughtAndContent(rawText) {
    if (!rawText) return { thought: '', content: '', hasThought: false };
    
    // Suporte para tags <think>...</think>
    const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
    const match = rawText.match(thinkRegex);
    if (match) {
        const thought = match[1].trim();
        const content = rawText.replace(thinkRegex, '').trim();
        return { thought, content, hasThought: true };
    }
    
    // Suporte para tag <think> ainda aberta
    const openThinkRegex = /<think>([\s\S]*)$/i;
    const openMatch = rawText.match(openThinkRegex);
    if (openMatch) {
        const thought = openMatch[1].trim();
        const content = rawText.replace(openThinkRegex, '').trim();
        return { thought, content, hasThought: true };
    }
    
    return { thought: '', content: rawText, hasThought: false };
}

function toggleThought(headerEl) {
    const container = headerEl.closest('.thought-container');
    if (!container) return;
    container.classList.toggle('is-collapsed');
}

function applyCodeBlockFeatures(container) {
    container.querySelectorAll('pre').forEach((pre) => {
        const code = pre.querySelector('code');
        if (code && !pre.parentElement.classList.contains('code-wrapper')) {
            hljs.highlightElement(code);

            const wrapper = document.createElement('div');
            wrapper.className = 'code-wrapper';
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);

            const btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg> Copiar';
            btn.onclick = () => copyToClipboard(code.innerText, btn);
            wrapper.appendChild(btn);
        }
    });
}

function renderMetricsHtml(metrics, isLive = false, liveData = null) {
    if (isLive) {
        const speed = liveData && liveData.tokPerSec ? liveData.tokPerSec : '0.0';
        const time = liveData && liveData.elapsedSec ? liveData.elapsedSec : '0.0';
        const tokens = liveData && liveData.tokens ? liveData.tokens : 0;
        return `
            <div class="message-metrics-container">
                <div class="message-metrics is-live">
                    <span class="metric-live-dot" title="Gerando em tempo real"></span>
                    <span class="metric-item speed">
                        ⚡ <span class="metric-val">${speed}</span> <span class="metric-label">tok/s</span>
                    </span>
                    <span class="metric-divider">•</span>
                    <span class="metric-item time">
                        ⏱️ <span class="metric-val">${time}</span><span class="metric-label">s</span>
                    </span>
                    <span class="metric-divider">•</span>
                    <span class="metric-item tokens">
                        📊 <span class="metric-val">${tokens}</span> <span class="metric-label">tokens</span>
                    </span>
                </div>
            </div>`;
    }

    if (!metrics) return '';

    let m = metrics;
    if (typeof m === 'string') {
        try { m = JSON.parse(m); } catch (e) { return ''; }
    }
    if (!m) return '';

    const speed = m.tok_per_sec || (m.eval_duration > 0 ? (m.eval_count / (m.eval_duration / 1e9)).toFixed(1) : '0.0');
    const time = m.total_sec || (m.total_duration ? (m.total_duration / 1e9).toFixed(1) : (m.eval_sec || '0.0'));
    const tokens = m.eval_count || 0;
    
    const promptSpeed = (m.prompt_eval_duration > 0) ? (m.prompt_eval_count / (m.prompt_eval_duration / 1e9)).toFixed(1) : null;
    const promptTokens = m.prompt_eval_count || 0;
    const loadMs = m.load_duration ? Math.round(m.load_duration / 1e6) : null;

    let tooltipRows = `
        <div class="tooltip-row"><span>Velocidade de geração:</span> <span>${speed} tok/s</span></div>
        <div class="tooltip-row"><span>Tempo decorrido:</span> <span>${time}s</span></div>
        <div class="tooltip-row"><span>Tokens de resposta:</span> <span>${tokens} tokens</span></div>
    `;
    if (promptTokens > 0) {
        tooltipRows += `<div class="tooltip-row"><span>Prompt avaliado:</span> <span>${promptTokens} tokens ${promptSpeed ? `(${promptSpeed} tok/s)` : ''}</span></div>`;
    }
    if (loadMs !== null && loadMs > 0) {
        tooltipRows += `<div class="tooltip-row"><span>Carga do modelo:</span> <span>${loadMs} ms</span></div>`;
    }

    return `
        <div class="message-metrics-container">
            <div class="message-metrics">
                <span class="metric-item speed" title="Velocidade de geração">
                    ⚡ <span class="metric-val">${speed}</span> <span class="metric-label">tok/s</span>
                </span>
                <span class="metric-divider">•</span>
                <span class="metric-item time" title="Tempo total">
                    ⏱️ <span class="metric-val">${time}</span><span class="metric-label">s</span>
                </span>
                <span class="metric-divider">•</span>
                <span class="metric-item tokens" title="Total de tokens gerados">
                    📊 <span class="metric-val">${tokens}</span> <span class="metric-label">tokens</span>
                </span>
                <div class="metrics-tooltip">
                    <div class="tooltip-title"><i class="fa-solid fa-gauge-high"></i> Desempenho do Modelo</div>
                    ${tooltipRows}
                </div>
            </div>
        </div>`;
}

function addMessage(role, content, isStreaming = false, metrics = null) {
    const chatBox = document.getElementById('chat-messages');
    let msgDiv;

    if (isStreaming) {
        msgDiv = document.getElementById('streaming-ai-msg');
    }

    if (!msgDiv) {
        msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;
        if (isStreaming) msgDiv.id = 'streaming-ai-msg';
        chatBox.appendChild(msgDiv);
    }

    if (role === 'user') {
        let bubble = msgDiv.querySelector('.bubble');
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.className = 'bubble';
            msgDiv.appendChild(bubble);
        }
        bubble.innerText = content;
        chatBox.scrollTop = chatBox.scrollHeight;
        return msgDiv;
    }

    // Role: Assistant
    if (isStreaming) {
        let thoughtContainer = msgDiv.querySelector('.thought-container');
        let bubble = msgDiv.querySelector('.bubble');
        let metricsWrap = msgDiv.querySelector('.message-metrics-wrap');

        if (!thoughtContainer) {
            thoughtContainer = document.createElement('div');
            thoughtContainer.className = 'thought-container is-collapsed';
            thoughtContainer.style.display = 'none'; // Fica oculto até haver pensamento
            thoughtContainer.innerHTML = `
                <div class="thought-header" onclick="toggleThought(this)">
                    <div class="thought-header-left">
                        <i class="fa-solid fa-brain thought-icon"></i>
                        <span class="thought-status">Pensando...</span>
                        <span class="thought-timer" style="display:none;">0.0s</span>
                    </div>
                    <i class="fa-solid fa-chevron-down thought-chevron"></i>
                </div>
                <div class="thought-body">
                    <div class="thought-content"></div>
                </div>`;
            msgDiv.appendChild(thoughtContainer);
        }

        if (!bubble) {
            bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.innerHTML = `
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>`;
            msgDiv.appendChild(bubble);
        }

        if (!metricsWrap) {
            metricsWrap = document.createElement('div');
            metricsWrap.className = 'message-metrics-wrap';
            metricsWrap.innerHTML = renderMetricsHtml(null, true, { tokPerSec: '0.0', elapsedSec: '0.0', tokens: 0 });
            msgDiv.appendChild(metricsWrap);
        }

        chatBox.scrollTop = chatBox.scrollHeight;
        return msgDiv;
    }

    // Mensagem não streaming (carregada do histórico)
    msgDiv.innerHTML = '';
    
    // Extrai possível raciocínio <think>...</think>
    const parsed = parseThoughtAndContent(content);

    if (parsed.hasThought && parsed.thought) {
        const thoughtContainer = document.createElement('div');
        thoughtContainer.className = 'thought-container is-collapsed';
        thoughtContainer.innerHTML = `
            <div class="thought-header" onclick="toggleThought(this)">
                <div class="thought-header-left">
                    <i class="fa-solid fa-brain thought-icon"></i>
                    <span class="thought-status">Processo de raciocínio</span>
                </div>
                <i class="fa-solid fa-chevron-down thought-chevron"></i>
            </div>
            <div class="thought-body">
                <div class="thought-content">${renderMarkdown(parsed.thought)}</div>
            </div>`;
        msgDiv.appendChild(thoughtContainer);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderMarkdown(parsed.content || (parsed.hasThought ? '' : content));
    msgDiv.appendChild(bubble);

    // Destaca códigos e adiciona botão de copiar
    applyCodeBlockFeatures(msgDiv);

    // Adiciona pill de métricas se houver
    if (metrics) {
        const metricsWrap = document.createElement('div');
        metricsWrap.className = 'message-metrics-wrap';
        metricsWrap.innerHTML = renderMetricsHtml(metrics);
        msgDiv.appendChild(metricsWrap);
    }

    chatBox.scrollTop = chatBox.scrollHeight;
    return msgDiv;
}

async function copyToClipboard(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
        const originalHTML = btn.innerHTML;
        btn.innerHTML = 'Copiado!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('copied');
        }, 2000);
    } catch (err) {
        console.error('Falha ao copiar:', err);
    }
}

function finalizeChat() {
    const sendBtn = document.getElementById('send-btn');
    sendBtn.classList.remove('stop-btn');
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.onclick = enviar;
    sendBtn.disabled = false;
    currentAbortController = null;
    loadHistory(); // Atualiza título se necessário
}

function stopResponse() {
    if (currentAbortController) {
        currentAbortController.abort();
    }
    finalizeChat();
}

async function enviar() {
    const input = document.getElementById('msg-input');
    const msg = input.value.trim();
    if (!msg || !currentConversationId) return;

    input.value = '';
    input.style.height = 'auto';
    addMessage('user', msg);

    const sendBtn = document.getElementById('send-btn');
    
    // Configura o botão como STOP (com pequeno delay para evitar abort acidental em clique duplo)
    sendBtn.classList.add('stop-btn');
    sendBtn.innerHTML = STOP_ICON;
    sendBtn.onclick = null;
    setTimeout(() => {
        if (currentAbortController) {
            sendBtn.onclick = stopResponse;
        }
    }, 400);

    const abortController = new AbortController();
    currentAbortController = abortController;

    let fullAiThinking = "";
    let fullAiContent = "";
    let inEmbeddedThink = false;
    let isThinking = false;
    let hasThought = false;
    let thinkingStartTime = null;
    let streamStartTime = performance.now();
    let firstTokenTime = null;
    let streamTokens = 0;
    let finalOllamaMetrics = null;

    let aiMsgDiv = addMessage('assistant', "", true);
    let isStreamActive = true;
    let timeoutReached = false;

    // Atualizador em tempo real das métricas e temporizadores
    const liveStatsInterval = setInterval(() => {
        if (!isStreamActive) {
            clearInterval(liveStatsInterval);
            return;
        }
        const now = performance.now();
        const elapsedSec = ((now - streamStartTime) / 1000).toFixed(1);
        
        let tokPerSec = "0.0";
        if (firstTokenTime) {
            const genDuration = (now - firstTokenTime) / 1000;
            if (genDuration > 0.05 && streamTokens > 0) {
                tokPerSec = (streamTokens / genDuration).toFixed(1);
            }
        }

        const metricsWrap = aiMsgDiv.querySelector('.message-metrics-wrap');
        if (metricsWrap) {
            metricsWrap.innerHTML = renderMetricsHtml(null, true, {
                tokPerSec: tokPerSec,
                elapsedSec: elapsedSec,
                tokens: streamTokens
            });
        }

        // Se estiver pensando, atualiza o cronômetro do pensamento
        if (isThinking && thinkingStartTime) {
            const thoughtEl = aiMsgDiv.querySelector('.thought-container');
            const timerEl = thoughtEl ? thoughtEl.querySelector('.thought-timer') : null;
            if (timerEl) {
                const thinkSec = ((now - thinkingStartTime) / 1000).toFixed(1);
                timerEl.innerText = `${thinkSec}s`;
            }
        }
    }, 100);

    let partialLine = ""; // Buffer para linhas incompletas

    if (abortController.signal.aborted) return;

    try {
        const selectedModel = document.getElementById('model-select').value;
        const shouldThink = isReasoningModel(selectedModel) && reasoningEnabled;

        const response = await fetch('chat.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `prompt=${encodeURIComponent(msg)}&conversation_id=${currentConversationId}&model=${encodeURIComponent(selectedModel)}&think=${shouldThink ? '1' : '0'}`,
            signal: abortController.signal
        });

        if (!response.ok) throw new Error("Erro na requisição ao servidor");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let timeoutId = setTimeout(() => {
            if (fullAiContent === "" && fullAiThinking === "" && isStreamActive) {
                timeoutReached = true;
                isStreamActive = false;
                clearInterval(liveStatsInterval);
                aiMsgDiv.querySelector('.bubble').innerHTML = "⚠️ O servidor demorou muito para responder. Por favor, verifique se o Ollama está ativo e tente novamente.";
                finalizeChat();
            }
        }, 30000);

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done || timeoutReached) break;

                // Recebendo dados -> renova/limpa o timeout
                clearTimeout(timeoutId);

                const chunk = decoder.decode(value, { stream: true });
                const lines = (partialLine + chunk).split('\n');
                partialLine = lines.pop(); // Guarda a última parte (incompleta)

                for (const line of lines) {
                    if (!line.trim() || line.startsWith(':')) continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.error) {
                            aiMsgDiv.querySelector('.bubble').innerHTML = "❌ " + escapeHtml(json.error);
                            timeoutReached = true;
                            break;
                        }

                        if (json.message) {
                            // 1. Processa pensamento do modelo (Ollama nativo: message.thinking)
                            if (json.message.thinking) {
                                if (!firstTokenTime) firstTokenTime = performance.now();
                                
                                if (!isThinking) {
                                    isThinking = true;
                                    hasThought = true;
                                    thinkingStartTime = performance.now();

                                    const thoughtEl = aiMsgDiv.querySelector('.thought-container');
                                    if (thoughtEl) {
                                        thoughtEl.style.display = 'block';
                                        thoughtEl.classList.remove('is-collapsed');
                                        thoughtEl.classList.add('is-thinking');
                                        const timerEl = thoughtEl.querySelector('.thought-timer');
                                        if (timerEl) timerEl.style.display = 'inline-block';
                                        const statusEl = thoughtEl.querySelector('.thought-status');
                                        if (statusEl) statusEl.innerText = 'Pensando...';
                                    }
                                    const bubble = aiMsgDiv.querySelector('.bubble');
                                    if (bubble && bubble.querySelector('.typing-indicator')) {
                                        bubble.innerHTML = '';
                                    }
                                }

                                fullAiThinking += json.message.thinking;
                                streamTokens++;

                                const thoughtContent = aiMsgDiv.querySelector('.thought-content');
                                if (thoughtContent) {
                                    thoughtContent.innerHTML = renderMarkdown(fullAiThinking);
                                    const thoughtBody = aiMsgDiv.querySelector('.thought-body');
                                    if (thoughtBody) thoughtBody.scrollTop = thoughtBody.scrollHeight;
                                }
                            }

                            // 2. Processa resposta do modelo (message.content)
                            if (json.message.content) {
                                if (!firstTokenTime) firstTokenTime = performance.now();

                                // Se o pensamento estava ativo e começou a resposta, encerra o estado pensando
                                if (isThinking) {
                                    isThinking = false;
                                    const thoughtEl = aiMsgDiv.querySelector('.thought-container');
                                    if (thoughtEl) {
                                        thoughtEl.classList.remove('is-thinking');
                                        const dur = ((performance.now() - (thinkingStartTime || streamStartTime)) / 1000).toFixed(1);
                                        const statusEl = thoughtEl.querySelector('.thought-status');
                                        if (statusEl) statusEl.innerText = `Pensou por ${dur}s`;
                                        const timerEl = thoughtEl.querySelector('.thought-timer');
                                        if (timerEl) timerEl.style.display = 'none';
                                    }
                                }

                                // Suporte para modelos que inserem tags <think> dentro de content
                                const rawChunk = json.message.content;
                                if (rawChunk.includes('<think>') || inEmbeddedThink) {
                                    let processChunk = rawChunk;
                                    if (processChunk.includes('<think>')) {
                                        inEmbeddedThink = true;
                                        isThinking = true;
                                        hasThought = true;
                                        thinkingStartTime = performance.now();
                                        const thoughtEl = aiMsgDiv.querySelector('.thought-container');
                                        if (thoughtEl) {
                                            thoughtEl.style.display = 'block';
                                            thoughtEl.classList.remove('is-collapsed');
                                            thoughtEl.classList.add('is-thinking');
                                        }
                                        const parts = processChunk.split('<think>');
                                        fullAiContent += parts[0];
                                        processChunk = parts[1] || '';
                                    }
                                    if (processChunk.includes('</think>')) {
                                        inEmbeddedThink = false;
                                        isThinking = false;
                                        const parts = processChunk.split('</think>');
                                        fullAiThinking += parts[0];
                                        fullAiContent += parts[1] || '';

                                        const thoughtEl = aiMsgDiv.querySelector('.thought-container');
                                        if (thoughtEl) {
                                            thoughtEl.classList.remove('is-thinking');
                                            const dur = ((performance.now() - (thinkingStartTime || streamStartTime)) / 1000).toFixed(1);
                                            const statusEl = thoughtEl.querySelector('.thought-status');
                                            if (statusEl) statusEl.innerText = `Pensou por ${dur}s`;
                                        }
                                    } else {
                                        fullAiThinking += processChunk;
                                    }

                                    const thoughtContent = aiMsgDiv.querySelector('.thought-content');
                                    if (thoughtContent) {
                                        thoughtContent.innerHTML = renderMarkdown(fullAiThinking);
                                    }
                                } else {
                                    fullAiContent += rawChunk;
                                }

                                streamTokens++;

                                const bubble = aiMsgDiv.querySelector('.bubble');
                                if (bubble) {
                                    bubble.innerHTML = renderMarkdown(fullAiContent);
                                    applyCodeBlockFeatures(aiMsgDiv);
                                }
                            }
                        }

                        // 3. Captura estatísticas finais do Ollama quando done: true
                        if (json.done) {
                            finalOllamaMetrics = json;
                        }

                        const chatBox = document.getElementById('chat-messages');
                        if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;

                    } catch (e) {
                        console.warn("Falha ao processar linha JSON:", line);
                    }
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log("Resposta cancelada pelo usuário");
            } else {
                console.error("Stream error:", err);
                if (fullAiContent === "" && fullAiThinking === "") {
                    aiMsgDiv.querySelector('.bubble').innerHTML = "❌ Ocorreu um erro ao ler o stream do servidor.";
                }
            }
        } finally {
            isStreamActive = false;
            clearInterval(liveStatsInterval);

            // Finaliza estado de pensamento se ainda estiver marcado como ativo
            if (isThinking) {
                isThinking = false;
                const thoughtEl = aiMsgDiv.querySelector('.thought-container');
                if (thoughtEl) {
                    thoughtEl.classList.remove('is-thinking');
                    const dur = ((performance.now() - (thinkingStartTime || streamStartTime)) / 1000).toFixed(1);
                    const statusEl = thoughtEl.querySelector('.thought-status');
                    if (statusEl) statusEl.innerText = `Pensou por ${dur}s`;
                    const timerEl = thoughtEl.querySelector('.thought-timer');
                    if (timerEl) timerEl.style.display = 'none';
                }
            }

            // Garante renderização final completa do Markdown
            const bubble = aiMsgDiv.querySelector('.bubble');
            if (bubble && fullAiContent !== "") {
                bubble.innerHTML = renderMarkdown(fullAiContent);
                applyCodeBlockFeatures(aiMsgDiv);
            }

            const thoughtContent = aiMsgDiv.querySelector('.thought-content');
            if (thoughtContent && fullAiThinking !== "") {
                thoughtContent.innerHTML = renderMarkdown(fullAiThinking);
            }

            // Calcula e exibe as métricas de performance consolidadas
            const now = performance.now();
            let consolidatedMetrics = null;

            if (finalOllamaMetrics && finalOllamaMetrics.eval_count) {
                const evalCount = finalOllamaMetrics.eval_count;
                const evalDuration = finalOllamaMetrics.eval_duration || 0;
                const totalDuration = finalOllamaMetrics.total_duration || 0;
                const tokPerSec = (evalDuration > 0) ? (evalCount / (evalDuration / 1e9)).toFixed(1) : "0.0";
                const totalSec = (totalDuration > 0) ? (totalDuration / 1e9).toFixed(1) : ((now - streamStartTime) / 1000).toFixed(1);

                consolidatedMetrics = {
                    eval_count: evalCount,
                    eval_duration: evalDuration,
                    total_duration: totalDuration,
                    tok_per_sec: tokPerSec,
                    total_sec: totalSec,
                    prompt_eval_count: finalOllamaMetrics.prompt_eval_count || 0,
                    prompt_eval_duration: finalOllamaMetrics.prompt_eval_duration || 0,
                    load_duration: finalOllamaMetrics.load_duration || 0
                };
            } else {
                // Fallback para métricas calculadas no cliente
                const totalDurationSec = ((now - streamStartTime) / 1000).toFixed(1);
                const genDuration = firstTokenTime ? (now - firstTokenTime) / 1000 : parseFloat(totalDurationSec);
                const tokPerSec = (genDuration > 0.05 && streamTokens > 0) ? (streamTokens / genDuration).toFixed(1) : "0.0";

                consolidatedMetrics = {
                    eval_count: streamTokens,
                    tok_per_sec: tokPerSec,
                    total_sec: totalDurationSec
                };
            }

            const metricsWrap = aiMsgDiv.querySelector('.message-metrics-wrap');
            if (metricsWrap) {
                metricsWrap.innerHTML = renderMetricsHtml(consolidatedMetrics);
            }

            aiMsgDiv.removeAttribute('id');
            finalizeChat();
        }

    } catch (globalErr) {
        isStreamActive = false;
        clearInterval(liveStatsInterval);
        if (globalErr.name !== 'AbortError') {
            console.error("Global fetch error:", globalErr);
            aiMsgDiv.querySelector('.bubble').innerHTML = "❌ Erro crítico: " + escapeHtml(globalErr.message);
            finalizeChat();
        }
    }
}

async function checkServiceStatus() {
    try {
        const res = await fetch('api.php?action=check_status');
        const data = await res.json();
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');

        if (data.online) {
            dot.className = 'status-dot online';
            
            // Buscar modelo ativo rodando na VRAM
            try {
                const runningRes = await fetch('api.php?action=list_running_models');
                const runningData = await runningRes.json();
                const runningModels = runningData.models || [];
                
                if (runningModels.length > 0) {
                    const activeModelNames = runningModels.map(m => m.name.replace(':latest', '')).join(', ');
                    text.innerHTML = `Online <span style="font-size: 11px; opacity: 0.8; margin-left: 5px;">• Ativo: 🚀 <b>${escapeHtml(activeModelNames)}</b></span>`;
                } else {
                    text.innerHTML = 'Online <span style="font-size: 11px; opacity: 0.6; margin-left: 5px;">• Nenhum ativo</span>';
                }
            } catch (err) {
                text.innerText = 'Online';
            }
        } else {
            dot.className = 'status-dot offline';
            text.innerText = 'Offline';
        }
    } catch (e) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');
        if (dot) dot.className = 'status-dot offline';
        if (text) text.innerText = 'Erro de Conexão';
    }
}

async function fetchModels() {
    try {
        const modelsRes = await fetch('api.php?action=list_models');
        const data = await modelsRes.json();

        let runningData = { models: [] };
        try {
            const runningRes = await fetch('api.php?action=list_running_models');
            if (runningRes.ok) {
                runningData = await runningRes.json();
            }
        } catch (runErr) {
            console.warn("Aviso ao consultar /api/ps:", runErr);
        }

        const select = document.getElementById('model-select');
        
        const rawModels = Array.isArray(data.models) ? data.models : (Array.isArray(data.data) ? data.data : []);
        const installedModels = rawModels
            .map(m => (typeof m === 'string' ? m : (m.name || m.model || m.id || '')))
            .filter(Boolean);
        const runningModels = (runningData.models || [])
            .map(m => (typeof m === 'string' ? m : (m.name || m.model || m.id || '')))
            .filter(Boolean);
        
        installedModelsGlobal = installedModels;
        
        const normalizeModel = (modelId) => (modelId || '').toLowerCase().trim().replace(/:latest$/, '');

        // Função auxiliar para verificar se o modelo está instalado (ignorando o sufixo :latest)
        const checkInstalled = (modelId) => {
            const cleanTarget = normalizeModel(modelId);
            return installedModels.some(m => normalizeModel(m) === cleanTarget);
        };

        // Função auxiliar para verificar se o modelo está rodando
        const checkRunning = (modelId) => {
            const cleanTarget = normalizeModel(modelId);
            return runningModels.some(m => normalizeModel(m) === cleanTarget);
        };

        select.innerHTML = '';

        // 1. Modelos efetivamente instalados no Ollama (exibidos no topo!)
        const chatCapableInstalledModels = installedModels.filter(m => !m.toLowerCase().includes('embed'));
        if (installedModels.length > 0) {
            const installedGroup = document.createElement('optgroup');
            installedGroup.label = `Modelos Instalados no Ollama (${installedModels.length})`;
            installedModels.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                const matchedTarget = TARGET_MODELS.find(t => normalizeModel(t.id) === normalizeModel(m));
                const displayName = matchedTarget ? `${matchedTarget.name} [${m}]` : m;
                const isRunning = checkRunning(m);
                const isReasoning = isReasoningModel(m);
                const reasonBadge = isReasoning ? ' 🧠' : '';

                if (isRunning) {
                    opt.innerText = `${displayName}${reasonBadge} 🚀 (Rodando / VRAM)`;
                    opt.style.fontWeight = 'bold';
                    opt.style.color = '#3fb950';
                } else {
                    opt.innerText = `${displayName}${reasonBadge} ✅ (Instalado)`;
                }
                installedGroup.appendChild(opt);
            });
            select.appendChild(installedGroup);
        }

        // 2. Modelos Sugeridos que ainda não estão instalados
        const uninstalledTargets = TARGET_MODELS.filter(target => !checkInstalled(target.id));
        if (uninstalledTargets.length > 0) {
            const targetGroup = document.createElement('optgroup');
            targetGroup.label = installedModels.length > 0 ? "Modelos Sugeridos (Pull necessário)" : "Modelos Sugeridos (Nenhum modelo detectado no Ollama)";
            
            uninstalledTargets.forEach(target => {
                const opt = document.createElement('option');
                opt.value = target.id;
                opt.innerText = `${target.name} ⏳ (Pull necessário)`;
                opt.style.color = '#888';
                targetGroup.appendChild(opt);
            });
            select.appendChild(targetGroup);
        }

        // Seleciona modelo ativo na VRAM, ou último selecionado (se instalado), ou primeiro instalado
        const lastModel = localStorage.getItem('selectedModel');
        const activeRunning = runningModels.find(m => !m.toLowerCase().includes('embed'));
        if (lastModel && checkInstalled(lastModel)) {
            const exactMatch = installedModels.find(m => normalizeModel(m) === normalizeModel(lastModel));
            select.value = exactMatch || lastModel;
        } else if (activeRunning && Array.from(select.options).some(o => o.value === activeRunning)) {
            select.value = activeRunning;
        } else if (chatCapableInstalledModels.length > 0) {
            select.value = chatCapableInstalledModels[0];
        } else if (installedModels.length > 0) {
            select.value = installedModels[0];
        }
        updateReasoningUI();
    } catch (e) {
        console.error("Erro ao buscar modelos:", e);
        document.getElementById('model-select').innerHTML = '<option value="phi3:mini">Erro ao carregar modelos</option>';
        updateReasoningUI();
    }
}

// Save and activate selection
document.getElementById('model-select').addEventListener('change', async (e) => {
    const selectedModel = e.target.value;
    updateReasoningUI();
    
    // Normalização para comparar nomes
    const normalize = (name) => name.toLowerCase().trim().replace(/:latest$/, '');
    const isInstalled = installedModelsGlobal.some(m => normalize(m) === normalize(selectedModel));
    
    if (!isInstalled) {
        // Encontra o nome amigável do modelo
        const target = TARGET_MODELS.find(t => normalize(t.id) === normalize(selectedModel));
        const friendlyName = target ? target.name : selectedModel;
        
        // Alerta o usuário e desfaz a seleção
        alert(`⚠️ O modelo "${friendlyName}" precisa ser instalado primeiro.\nExecute no terminal: ollama pull ${selectedModel}`);
        
        // Restaura a seleção anterior usando o valor salvo no localStorage
        const lastModel = localStorage.getItem('selectedModel');
        if (lastModel) {
            e.target.value = lastModel;
        } else {
            // Recarrega modelos
            fetchModels();
        }
        updateReasoningUI();
        return;
    }
    
    const select = e.target;
    const sendBtn = document.getElementById('send-btn');
    const msgInput = document.getElementById('msg-input');
    const statusText = document.getElementById('status-text');
    
    // Bloquear UI temporariamente
    select.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    if (msgInput) msgInput.disabled = true;
    
    statusText.innerHTML = `<span style="color: #fbbf24;"><i class="fa-solid fa-spinner fa-spin" style="margin-right: 5px;"></i> Inicializando <b>${escapeHtml(selectedModel)}</b>...</span>`;
    
    try {
        const formData = new FormData();
        formData.append('model', selectedModel);
        
        const res = await fetch('api.php?action=run_model', {
            method: 'POST',
            body: formData
        });
        const result = await res.json();
        
        if (result.success) {
            localStorage.setItem('selectedModel', selectedModel);
            // Sucesso!
            statusText.innerHTML = `<span style="color: #3fb950;"><i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i> Ativo: 🚀 <b>${escapeHtml(selectedModel)}</b></span>`;
            
            // Adiciona um pequeno delay visual e atualiza a lista de modelos para mostrar o foguete
            setTimeout(async () => {
                await fetchModels();
                await checkServiceStatus();
            }, 1000);
        } else {
            throw new Error(result.error || "Erro desconhecido ao carregar modelo");
        }
    } catch (err) {
        console.error("Erro ao ativar modelo:", err);
        alert(`❌ Falha ao carregar o modelo "${selectedModel}". Verifique se o Ollama está rodando.`);
        // Desfaz seleção
        const lastModel = localStorage.getItem('selectedModel');
        if (lastModel) select.value = lastModel;
        updateReasoningUI();
        checkServiceStatus();
    } finally {
        // Desbloquear UI
        select.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        if (msgInput) msgInput.disabled = false;
        updateReasoningUI();
    }
});

// Initialize
(async () => {
    updateReasoningUI();
    checkServiceStatus();
    fetchModels();
    setInterval(checkServiceStatus, 5000);

    const res = await fetch('api.php?action=list_conversations');
    const data = await res.json();
    if (data.length > 0) {
        selectChat(data[0].id);
    } else {
        createNewChat();
    }
})();

document.getElementById('msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviar();
    }
});
