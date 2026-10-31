<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat - Ollama</title>
    <!-- Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <!-- Markdown & Syntax Highlighting -->
    <script src="https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.4/purify.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <!-- FontAwesome Icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <link rel="stylesheet" href="style.css?v=<?php echo time(); ?>">
</head>
<body>

    <aside id="sidebar">
        <button id="new-chat-btn" onclick="createNewChat()">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="white"><path d="M8 0a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2H9v6a1 1 0 1 1-2 0V9H1a1 1 0 1 1 0-2h6V1a1 1 0 0 1 1-1z"/></svg>
            Nova Conversa
        </button>
        <div id="history-list"></div>
        
        <div id="status-container">
            <div id="status-dot" class="status-dot"></div>
            <span id="status-text">Verificando serviço...</span>
        </div>
    </aside>

    <main id="main-chat">
        <header id="chat-header">
            <div class="header-controls">
                <div class="model-selector-container">
                    <select id="model-select">
                        <option value="phi3:mini">Carregando modelos...</option>
                    </select>
                </div>
                <button id="think-toggle-btn" class="think-toggle-btn active" onclick="toggleReasoning()" title="Clique para alternar entre respostas com raciocínio ou respostas diretas">
                    <i class="fa-solid fa-brain"></i>
                    <span id="think-toggle-label">Raciocínio ON</span>
                </button>
            </div>
        </header>
        <div id="chat-messages"></div>
        
        <div id="input-container">
            <div class="input-box">
                <textarea id="msg-input" placeholder="Envie uma mensagem..." rows="1" oninput="autoResize(this)"></textarea>
                <button id="send-btn" onclick="enviar()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="white"><path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.109zM6.637 10.07l7.494-7.494-4.747 4.747L6.637 10.07z"/></svg>
                </button>
            </div>
        </div>
    </main>

    <script src="script.js?v=<?php echo time(); ?>"></script>
</body>
</html>