# 💬 chat-php-ollama

Interface web de chat em **PHP**, **JavaScript (ES6+)** e **Vanilla CSS** desenvolvida para interação com modelos de linguagem (LLMs) locais ou em rede utilizando a **API nativa do Ollama** (`/api/chat`, `/api/tags`, `/api/ps`, `/api/generate`).

> **API compatível com OpenAI:** Caso queira utilizar a API da OpenAI ou servidores compatíveis com o padrão `/v1/chat/completions`, consulte o fork específico criado para essa finalidade: [**`marceloaugu/chat-php-openai`**](https://github.com/marceloaugu/chat-php-openai).

---

## 1. Apresentação

O **`chat-php-ollama`** é uma aplicação web leve em PHP para conversar com modelos hospedados no **Ollama**, aproveitando recursos específicos da sua API nativa:

* **Streaming nativo em tempo real:** Consumo do fluxo NDJSON de `/api/chat` repassado via Server-Sent Events (SSE) ao navegador.
* **Gerenciamento ativo de VRAM pela interface:** Ao alternar de modelo no seletor superior, o backend consulta `/api/ps`, descarrega automaticamente da GPU quaisquer outros modelos em execução (`"keep_alive": 0` via `/api/generate`) e pré-carrega o modelo selecionado na VRAM (`"keep_alive": -1`), evitando estouro de memória de vídeo ao alternar entre modelos.
* **Priorização de GPU (`num_gpu: 99`):** Todas as requisições de chat instruem o Ollama a alocar as camadas do modelo na GPU disponível e mantê-lo aquecido (`"keep_alive": "1h"`).
* **Suporte a Raciocínio (*Chain-of-Thought*):** Compatível tanto com o campo nativo `message.thinking` do Ollama quanto com tags `<think>...</think>` embutidas em `message.content`.
* **Telemetria detalhada do Ollama:** Exibe velocidade em `tok/s`, tempo total, contagem de tokens gerados, velocidade de avaliação do prompt (`prompt_eval_duration`) e tempo de carga do modelo em milissegundos (`load_duration`).
* **Persistência em MySQL / MariaDB e RAG simplificado:** Histórico completo por conversa, registro do modelo e métricas por mensagem, e injeção automática de contexto relevante de mensagens anteriores.

---

## 2. Objetivos

1. **Interface Genérica em PHP para o Ollama:** Fornecer uma aplicação web direta, sem dependência de frameworks pesados, pronta para conectar-se a qualquer instância do Ollama.
2. **Controle de Alocação de VRAM:** Garantir que apenas um modelo ocupe a memória de vídeo por vez ao alternar modelos pela interface web, utilizando os endpoints nativos `/api/ps` e `/api/generate`.
3. **Medição de Inferência Local:** Capturar as métricas nativas em nanossegundos fornecidas pelo Ollama (`eval_duration`, `prompt_eval_duration`, `load_duration`, `total_duration`) e persisti-las em banco de dados para acompanhamento de desempenho.

---

## 3. Arquitetura

A aplicação utiliza uma arquitetura enxuta em três camadas (Frontend SPA em HTML/CSS/JS + Backend PHP sem frameworks externos + Banco de Dados MySQL/MariaDB):

```
[Navegador: index.php + script.js + style.css]
       │
       ├── GET/POST api.php?action=...  ──► [MySQL / MariaDB (conversations, messages)]
       │                                ──► GET  {OLLAMA_HOST}/api/tags (status e modelos instalados)
       │                                ──► GET  {OLLAMA_HOST}/api/ps   (modelos ativos na VRAM/RAM)
       │                                ──► POST {OLLAMA_HOST}/api/generate (unload/load na VRAM)
       │
       └── POST chat.php (SSE Stream)   ──► [MySQL / MariaDB (RAG + persistência)]
                                        ──► POST {OLLAMA_HOST}/api/chat (NDJSON stream)
```

### Separação entre Interface PHP e Mecanismo de Inferência

A comunicação é implementada diretamente via cURL em `api.php` e `chat.php` contra a **API nativa do Ollama**:

* **Camada da Aplicação (PHP / Frontend):**
  * Conexão PDO, leitura de `.env`, criação automática de banco/tabelas e migrações (`db.php`, `schema.sql`).
  * Recuperação de contexto por palavras-chave (RAG simplificado) no histórico da conversa (`chat.php`).
  * Interface de usuário, renderização Markdown (`Marked.js`), realce de código (`Highlight.js`), seção recolhível de raciocínio e badge de métricas (`index.php`, `script.js`, `style.css`).
* **Integração com a API Nativa do Ollama:**
  * Uso dos endpoints `/api/chat`, `/api/tags`, `/api/ps` e `/api/generate`.
  * Controle de `keep_alive` (`0`, `-1`, `"1h"`) e `"options": {"num_gpu": 99}`.
  * Leitura de objetos JSON delimitados por quebra de linha (NDJSON) contendo `message.content`, `message.thinking` e o pacote final `"done": true` com tempos em nanossegundos.

### Estrutura de Diretórios e Arquivos

```text
chat-php-ollama/
├── .env.example        # Modelo de variáveis de ambiente (sem credenciais reais)
├── .gitignore          # Regras de proteção de credenciais, dumps e arquivos locais
├── Dockerfile          # Imagem Docker (PHP 8.4 + Apache + pdo_mysql + curl)
├── README.md           # Documentação técnica do projeto
├── api.php             # Endpoints JSON: histórico, /api/tags, /api/ps e troca de modelo em VRAM
├── chat.php            # Endpoint de streaming, RAG simplificado e chamada a /api/chat
├── db.php              # Leitor nativo de .env, conexão PDO e auto-migração do banco de dados
├── docker-compose.yml  # Orquestração de containers (chat-app + MariaDB 10.11)
├── index.php           # Interface principal do chat
├── schema.sql          # Esquema SQL de referência (tabelas conversations e messages)
├── script.js           # Lógica de frontend, seletor de modelos com status de VRAM, raciocínio e métricas
├── style.css           # Estilização dark mode / Glassmorphism
└── test_ollama.php     # Script utilitário para diagnóstico rápido de conectividade com /api/tags
```

---

## 4. Tecnologias

* **Backend:** PHP 8.x (extensões nativas `pdo_mysql`, `curl`, `json`, `mbstring`; sem necessidade de Composer).
* **Frontend:** HTML5, Vanilla CSS (Dark Mode / Glassmorphism) e JavaScript ES6+ (`fetch`, `ReadableStream`, `AbortController`).
* **Bibliotecas Client-Side (via CDN):**
  * [Marked.js](https://marked.js.org/) — Renderização de Markdown.
  * [Highlight.js](https://highlightjs.org/) (`11.9.0`, tema `github-dark`) — Realce de sintaxe em blocos de código.
  * [FontAwesome](https://fontawesome.com/) (`6.4.0`) e fonte **Inter** (Google Fonts).
* **Banco de Dados:** MySQL 8.0+ ou MariaDB 10.11+.
* **Mecanismo de Inferência:** **Ollama** (API nativa).

---

## 5. Requisitos

* **Ambiente Web / PHP:**
  * PHP `>= 8.0` (recomendado PHP `8.4`) com `pdo_mysql`, `curl` e `mbstring` ativos.
  * Apache ou Nginx.
  * MySQL ou MariaDB.
* **Servidor Ollama:**
  * Ollama instalado localmente ou acessível em rede (porta padrão `11434`).

---

## 6. Instalação

1. Clone o repositório no diretório do seu servidor web (ex.: `htdocs`):
   ```bash
   git clone https://github.com/marceloaugu/chat-php-ollama.git
   cd chat-php-ollama
   ```

2. Crie o arquivo `.env` a partir de `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Configure no `.env` o endereço do servidor Ollama (`OLLAMA_HOST`) e as credenciais do MySQL/MariaDB.

4. **Banco de Dados (Automático ou Manual):**
   * **Automático:** Na primeira requisição, `db.php` cria automaticamente o banco `chat_app`, as tabelas `conversations` e `messages` e aplica as migrações das colunas `model` e `metrics` (desde que o usuário do banco tenha privilégio para criação).
   * **Manual:** Se preferir inicializar manualmente:
     ```bash
     mysql -u root -p < schema.sql
     ```

### Modelos Sugeridos para Uso Local

Os modelos pré-listados na interface (`TARGET_MODELS` em `script.js`) são **apenas sugestões para uso local**, permitindo escolher opções de diferentes tamanhos (de `1B` a `9B` parâmetros) de acordo com a capacidade da sua GPU e VRAM disponível:

| Modelo | Comando de Instalação | Suporte a Raciocínio |
| :--- | :--- | :--- |
| **Llama 3 (8B)** | `ollama pull llama3` | Não |
| **Llama 3.1 (8B)** | `ollama pull llama3.1` | Não |
| **Llama 3.2 (1B)** | `ollama pull llama3.2:1b` | Não |
| **Llama 3.2 (3B)** | `ollama pull llama3.2:3b` | Não |
| **Phi-3 Mini (3.8B)** | `ollama pull phi3:mini` | Não |
| **Phi-3.5 Mini (3.8B)** | `ollama pull phi3.5` | Não |
| **Mistral v0.3 (7B)** | `ollama pull mistral:v0.3` | Não |
| **DeepSeek-R1 (1.5B)** | `ollama pull deepseek-r1:1.5b` | Sim (`<think>` / `thinking`) |
| **DeepSeek-R1 (7B)** | `ollama pull deepseek-r1:7b` | Sim (`<think>` / `thinking`) |
| **DeepSeek-R1 (8B)** | `ollama pull deepseek-r1:8b` | Sim (`<think>` / `thinking`) |
| **Gemma 2 (2B)** | `ollama pull gemma2:2b` | Não |
| **Gemma 2 (9B)** | `ollama pull gemma2:9b` | Não |
| **Qwen 2.5 (7B)** | `ollama pull qwen2.5:7b` | Não |

> Você não está restrito a essa lista: qualquer outro modelo instalado no Ollama (retornado por `/api/tags`) aparecerá automaticamente no seletor sob o grupo **Outros Modelos Instalados**.

---

## 7. Configuração

As variáveis de ambiente são carregadas automaticamente por `db.php` a partir do arquivo `.env` local ou do ambiente do sistema/container:

| Variável | Descrição | Valor Padrão (`db.php`) |
| :--- | :--- | :--- |
| `OLLAMA_HOST` | URL-base do servidor Ollama (sem barra final e sem `/api` ou `/v1`) | `http://localhost:11434` |
| `DB_HOST` | Host do banco de dados MySQL/MariaDB | `localhost` |
| `DB_NAME` | Nome do banco de dados da aplicação | `chat_app` |
| `DB_USER` | Usuário de conexão do banco de dados | `ubuntu` |
| `DB_PASS` | Senha de conexão do banco de dados | *(vazio — definir no `.env`)* |

### Parâmetros de Inferência e Gerenciamento de Recursos (`chat.php` e `api.php`)

* **Offload para GPU:** `chat.php` envia `"options": {"num_gpu": 99}` em todas as chamadas a `/api/chat` para priorizar o carregamento das camadas na GPU.
* **Retenção em Memória (`keep_alive`):**
  * Durante o chat (`chat.php`): `"keep_alive": "1h"` para manter o modelo ativo na VRAM e reduzir o *Time-To-First-Token (TTFT)* nas mensagens seguintes.
  * Na troca de modelo pelo seletor (`api.php?action=run_model`): envia `"keep_alive": 0` para descarregar imediatamente outros modelos em execução e `"keep_alive": -1` para carregar o novo modelo selecionado.
* **Janela de Contexto do Chat:** Envia as últimas **6 mensagens** da conversa + até **3 trechos** recuperados pelo RAG simplificado por palavras-chave, limpando tags `<think>...</think>` de mensagens antigas.

---

## 8. Execução

### Opção A: Servidor Web Local (Apache / XAMPP)

1. Inicie o serviço do Ollama (ex.: `ollama serve`), o Apache e o MySQL/MariaDB.
2. (Opcional) Teste a comunicação direta do PHP com o Ollama executando:
   ```bash
   php test_ollama.php
   ```
3. Acesse no navegador:
   ```text
   http://localhost/chat-php-ollama/
   ```
4. Verifique na barra lateral inferior o status **Online • Ativo: 🚀 [nome-do-modelo]**.
5. Escolha um modelo instalado no seletor superior (modelos instalados são exibidos com `✅` e modelos atualmente carregados na VRAM aparecem com `🚀 (Rodando / RAM)`).

### Opção B: Docker Compose / Easypanel

1. Para subir localmente com Docker Compose:
   ```bash
   docker compose up -d --build
   ```
2. Acesse `http://localhost:8080/index.php`.
3. Em ambientes como **Easypanel**, utilize o `Dockerfile` na raiz e defina `OLLAMA_HOST`, `DB_HOST`, `DB_NAME`, `DB_USER` e `DB_PASS` nas variáveis de ambiente do serviço.

---

## 9. Integração com APIs e Compatibilidade

### API Nativa do Ollama (`/api/*`) vs. API Compatível com OpenAI (`/v1/*`)

Este projeto foi construído especificamente para a **API nativa do Ollama**. Caso você precise integrar com a API da OpenAI ou servidores compatíveis com o formato `/v1/chat/completions`, utilize o fork específico: [**`marceloaugu/chat-php-openai`**](https://github.com/marceloaugu/chat-php-openai).

| Recurso | API Nativa do Ollama (Implementada neste projeto) | API Compatível com OpenAI ([`chat-php-openai`](https://github.com/marceloaugu/chat-php-openai)) |
| :--- | :--- | :--- |
| **Endpoint de Chat** | `POST /api/chat` | `POST /v1/chat/completions` |
| **Listagem de Modelos** | `GET /api/tags` | `GET /v1/models` |
| **Inspeção de Modelos na VRAM** | `GET /api/ps` | *Não existe no padrão OpenAI* |
| **Carga / Descarga de VRAM** | `POST /api/generate` (`keep_alive: 0` / `-1`) | *Não existe no padrão OpenAI* |
| **Formato de Streaming** | NDJSON (1 objeto JSON por linha) | SSE (`data: {...}` encerrado por `data: [DONE]`) |
| **Métricas Retornadas** | Tempos internos em nanossegundos (`eval_duration`, `load_duration`, etc.) | Contagem de tokens (`usage.prompt_tokens`, `completion_tokens`) |

### Suporte a Modelos com Raciocínio (`thinking` / `<think>`)

* Versões recentes do Ollama suportam nativamente o parâmetro `"think": true/false` no payload de `/api/chat` e separam o raciocínio no campo `json.message.thinking`.
* Alguns modelos ou versões do Ollama emitem o raciocínio diretamente dentro de `json.message.content` delimitado por tags `<think>...</think>`.
* O código deste projeto (`chat.php` e `script.js`) **trata ambos os cenários**: captura `message.thinking` quando presente e também faz o parsing em tempo real de tags `<think>...</think>` embutidas em `message.content`.

---

## 10. Exemplos de Uso (Requisições e Respostas Reais)

### 1. Troca e Pré-Carregamento de Modelo na VRAM (`api.php?action=run_model`)

Ao selecionar um modelo na interface, `api.php`:
1. Consulta `GET {OLLAMA_HOST}/api/ps` para listar modelos atualmente na VRAM.
2. Para cada modelo diferente do selecionado, envia `POST {OLLAMA_HOST}/api/generate` para liberar a VRAM:
   ```json
   {
     "model": "llama3:latest",
     "keep_alive": 0
   }
   ```
3. Carrega o modelo escolhido na VRAM:
   ```json
   {
     "model": "deepseek-r1:8b",
     "keep_alive": -1
   }
   ```

### 2. Requisição de Chat (`POST /api/chat`)

Enviada por `chat.php`:

```json
{
  "model": "deepseek-r1:8b",
  "messages": [
    {
      "role": "system",
      "content": "Você é um assistente prestativo e inteligente."
    },
    {
      "role": "user",
      "content": "Como funciona o escalonamento de camadas na GPU no Ollama?"
    }
  ],
  "stream": true,
  "think": true,
  "keep_alive": "1h",
  "options": {
    "num_gpu": 99
  }
}
```

### 3. Resposta em Streaming NDJSON do Ollama

Chunks intermediários recebidos de `/api/chat`:

```json
{"model":"deepseek-r1:8b","created_at":"2026-10-30T23:00:01.100Z","message":{"role":"assistant","content":"","thinking":"Preciso explicar o parâmetro num_gpu..."},"done":false}
{"model":"deepseek-r1:8b","created_at":"2026-10-30T23:00:01.250Z","message":{"role":"assistant","content":"O Ollama distribui as camadas (*layers*) do modelo GGUF..."},"done":false}
```

Pacote final (`"done": true`) com estatísticas em nanossegundos:

```json
{
  "model": "deepseek-r1:8b",
  "created_at": "2026-10-30T23:00:12.400Z",
  "message": {
    "role": "assistant",
    "content": ""
  },
  "done": true,
  "total_duration": 11300000000,
  "load_duration": 42000000,
  "prompt_eval_count": 28,
  "prompt_eval_duration": 450000000,
  "eval_count": 165,
  "eval_duration": 10800000000
}
```

Métricas calculadas por `chat.php` e gravadas na coluna `metrics` do banco de dados:

```json
{
  "eval_count": 165,
  "eval_duration": 10800000000,
  "total_duration": 11300000000,
  "load_duration": 42000000,
  "tok_per_sec": 15.3,
  "total_sec": 11.3,
  "eval_sec": 10.8,
  "prompt_eval_count": 28,
  "prompt_eval_duration": 450000000
}
```

---

## 11. Solução de Problemas (Troubleshooting)

* **Status exibe `Offline` na barra lateral:**
  * Verifique se o processo do Ollama está ativo (`ollama list` ou `curl http://localhost:11434/api/tags`).
  * Execute `php test_ollama.php` no terminal para verificar o código HTTP retornado ao PHP.
  * Caso o Ollama rode em outra máquina da rede local, certifique-se de que o serviço do Ollama foi iniciado com `OLLAMA_HOST=0.0.0.0:11434` no servidor de inferência e que o arquivo `.env` do PHP aponta para o IP correto.
* **Alerta `O modelo precisa ser instalado primeiro. Execute no terminal: ollama pull ...`:**
  * Os modelos listados em **Modelos Sugeridos** com o ícone `⏳ (Pull necessário)` ainda não estão baixados no servidor Ollama. Execute `ollama pull <modelo>` no servidor antes de selecioná-los.
* **Erro ao alternar modelo (`Falha ao carregar o modelo`) ou falta de memória de vídeo (`CUDA out of memory`):**
  * Verifique se a sua GPU possui VRAM suficiente para o tamanho do modelo selecionado ou se outro processo está ocupando a memória de vídeo.
* **Erro de conexão com o banco de dados:**
  * Confirme se `DB_HOST`, `DB_NAME`, `DB_USER` e `DB_PASS` estão corretamente configurados no arquivo `.env`.

---

## 12. Limitações Conhecidas

1. **Exclusividade da API Nativa do Ollama:** Este projeto consome os endpoints nativos `/api/*` do Ollama. Para utilizar endpoints compatíveis com OpenAI (`/v1/chat/completions`), utilize o fork específico [**`marceloaugu/chat-php-openai`**](https://github.com/marceloaugu/chat-php-openai).
2. **RAG Simplificado:** A recuperação de contexto baseia-se em busca textual por palavras-chave (`SQL LIKE`) nas mensagens anteriores da mesma conversa, sem indexação vetorial.
3. **Timeout de Carregamento Inicial de Modelos Grandes:** O pré-carregamento via `api.php?action=run_model` possui timeout de cURL de `60s` e o primeiro token no frontend (`script.js`) possui timeout de `30s`. Ao carregar modelos muito pesados pela primeira vez, a requisição pode atingir o tempo limite enquanto o Ollama ainda transfere os pesos para a memória.
