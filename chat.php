<?php
// Desativa compressão do Apache/PHP e desliga buffers que atrasam o stream
@ini_set('zlib.output_compression', 'Off');
@ini_set('output_buffering', 'Off');
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', '1');
}

require 'db.php';

set_time_limit(0);

$prompt = $_POST['prompt'] ?? '';
$conversation_id = $_POST['conversation_id'] ?? null;

if (!$prompt || !$conversation_id) {
    header('Content-Type: application/json');
    echo json_encode(["error" => "Prompt ou ID da conversa ausentes"]);
    exit;
}

// 1. Recuperar contexto relevante (RAG Simplificado)
// Extrai palavras-chave simples do prompt (palavras com mais de 3 letras)
$words = explode(' ', preg_replace('/[^a-zA-Z0-9áàâãéèêíïóôõöúçñ ]/u', '', $prompt));
$keywords = array_filter($words, function($w) { return mb_strlen($w) > 3; });

$context_extra = "";
if (!empty($keywords)) {
    $clauses = [];
    $params = []; // Inicializa vazio para não duplicar parâmetros
    foreach ($keywords as $word) {
        $clauses[] = "content LIKE ?";
        $params[] = "%$word%";
    }
    
    // Busca mensagens antigas (exceto as muito recentes) que batem com as palavras-chave
    $sql_rag = "SELECT content FROM messages 
                WHERE conversation_id = ? 
                AND content != ?
                AND (" . implode(" OR ", $clauses) . ") 
                ORDER BY created_at DESC LIMIT 3";
    
    $stmt_rag = $pdo->prepare($sql_rag);
    // Passa os parâmetros na ordem correta: conv_id, prompt, e depois as keywords
    $stmt_rag->execute(array_merge([$conversation_id, $prompt], $params));
    $related_messages = $stmt_rag->fetchAll(PDO::FETCH_COLUMN);
    
    if (!empty($related_messages)) {
        $cleaned_related = [];
        foreach ($related_messages as $rm) {
            $cleaned = trim(preg_replace('/<think>[\s\S]*?<\/think>/i', '', $rm));
            if (!empty($cleaned)) {
                $cleaned_related[] = $cleaned;
            }
        }
        if (!empty($cleaned_related)) {
            $context_extra = "Informações relevantes de mensagens anteriores:\n- " . implode("\n- ", $cleaned_related) . "\n\n";
        }
    }
}

// 2. Recuperar o modelo selecionado
$model = $_POST['model'] ?? 'phi3:mini';

// 3. Salva a mensagem do usuário no banco
$stmt = $pdo->prepare("INSERT INTO messages (conversation_id, role, model, content) VALUES (?, 'user', ?, ?)");
$stmt->execute([$conversation_id, $model, $prompt]);

// Atualiza o título da conversa se for a primeira mensagem
$stmt_title = $pdo->prepare("UPDATE conversations SET title = SUBSTRING(?, 1, 30) WHERE id = ? AND title = 'Nova Conversa'");
$stmt_title->execute([$prompt, $conversation_id]);

// 3. Recuperar histórico recente (últimas 6 mensagens / 3 turnos para manter baixa latência de prompt eval)
$stmt_hist = $pdo->prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 6");
$stmt_hist->execute([$conversation_id]);
$history = array_reverse($stmt_hist->fetchAll());

// Parâmetro para ativar ou desativar o raciocínio (Chain-of-Thought)
$think_param = $_POST['think'] ?? '1';
$think_enabled = ($think_param === '1' || $think_param === 'true');

// 4. Montar o payload para /api/chat
$messages = [];
// Injeta o RAG como mensagem de sistema se houver algo relevante
if (!empty($context_extra)) {
    $messages[] = ["role" => "system", "content" => "Você é um assistente útil. Use estas " . $context_extra];
} else if ($think_enabled) {
    $messages[] = ["role" => "system", "content" => "Você é um assistente prestativo e inteligente."];
} else {
    $messages[] = ["role" => "system", "content" => "Você é um assistente útil e direto ao ponto. Responda de forma concisa e sem raciocínio prévio."];
}

foreach ($history as $msg) {
    // Remove tags de pensamento de mensagens antigas no histórico para economizar contexto
    $clean_content = preg_replace('/<think>[\s\S]*?<\/think>/i', '', $msg['content']);
    $clean_content = trim($clean_content);
    $messages[] = ["role" => $msg['role'], "content" => !empty($clean_content) ? $clean_content : $msg['content']];
}

$url = "$ollama_host/api/chat";
$data = [
    "model" => $model,
    "messages" => $messages,
    "stream" => true,
    "keep_alive" => "1h", // Mantém o modelo ativo na VRAM para TTFT imediato
    "options" => [
        "num_gpu" => 99 // Garante que as camadas sejam enviadas para a GPU
    ]
];
if ($think_enabled) {
    $data["think"] = true;
}

// Configura cabeçalhos para streaming imediato (desativa buffers de proxies e Apache)
header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache, no-transform');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');
header('Content-Encoding: none');

// Descarrega buffers pré-existentes do PHP
while (ob_get_level() > 0) {
    ob_end_clean();
}
ob_implicit_flush(1);

// Envia padding inicial SSE para forçar o Apache/Nginx a abrir a conexão de streaming de imediato
echo ":" . str_repeat(" ", 2048) . "\n\n";
flush();

$full_thinking = "";
$full_content = "";
$final_metrics = null;
$buffer = "";

$processStreamChunk = function($chunk) use (&$full_thinking, &$full_content, &$final_metrics, &$buffer) {
    echo $chunk;
    if (ob_get_level() > 0) ob_flush();
    flush();
    
    $buffer .= $chunk;
    $lines = explode("\n", $buffer);
    $buffer = array_pop($lines); // Guarda a parte final incompleta
    
    foreach ($lines as $line) {
        $line = trim($line);
        if (!empty($line)) {
            $json = json_decode($line, true);
            if ($json) {
                if (isset($json['message']['thinking']) && $json['message']['thinking'] !== '') {
                    $full_thinking .= $json['message']['thinking'];
                }
                if (isset($json['message']['content']) && $json['message']['content'] !== '') {
                    $full_content .= $json['message']['content'];
                }
                if (!empty($json['done'])) {
                    $eval_count = $json['eval_count'] ?? 0;
                    $eval_duration = $json['eval_duration'] ?? 0;
                    $total_duration = $json['total_duration'] ?? 0;
                    $prompt_eval_count = $json['prompt_eval_count'] ?? 0;
                    $prompt_eval_duration = $json['prompt_eval_duration'] ?? 0;
                    $load_duration = $json['load_duration'] ?? 0;
                    
                    $tok_per_sec = ($eval_duration > 0) ? round(($eval_count / ($eval_duration / 1e9)), 1) : 0;
                    $total_sec = round($total_duration / 1e9, 2);
                    $eval_sec = round($eval_duration / 1e9, 2);
                    
                    $final_metrics = json_encode([
                        'eval_count' => $eval_count,
                        'eval_duration' => $eval_duration,
                        'total_duration' => $total_duration,
                        'load_duration' => $load_duration,
                        'tok_per_sec' => $tok_per_sec,
                        'total_sec' => $total_sec,
                        'eval_sec' => $eval_sec,
                        'prompt_eval_count' => $prompt_eval_count,
                        'prompt_eval_duration' => $prompt_eval_duration
                    ]);
                }
            }
        }
    }
    return strlen($chunk);
};

$payloadJson = json_encode($data);

if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payloadJson);
    curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type:application/json'));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5); // Timeout de 5s para conectar
    if (defined('CURL_IPRESOLVE_V4')) {
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    curl_setopt($ch, CURLOPT_TCP_NODELAY, 1);     // Envia pacotes imediatamente sem atraso de Nagle
    curl_setopt($ch, CURLOPT_BUFFERSIZE, 128);    // Envia cada token assim que chegar
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $chunk) use ($processStreamChunk) {
        return $processStreamChunk($chunk);
    });

    $exec_result = curl_exec($ch);

    if ($exec_result === false) {
        $error = curl_error($ch);
        echo json_encode(["error" => "O servidor está offline: $error"]) . "\n";
    }

    curl_close($ch);
} else {
    // Fallback nativo via stream HTTP quando extension=curl não está ativa no PHP (ex: XAMPP local)
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nAccept: application/x-ndjson\r\n",
            'content' => $payloadJson,
            'timeout' => 180,
            'ignore_errors' => true
        ]
    ]);
    $fp = @fopen($url, 'r', false, $ctx);
    if ($fp === false) {
        $err = error_get_last()['message'] ?? 'Falha ao conectar ao Ollama';
        echo json_encode(["error" => "O servidor está offline: $err"]) . "\n";
        flush();
    } else {
        stream_set_timeout($fp, 180);
        while (!feof($fp)) {
            $line = fgets($fp, 8192);
            if ($line === false) {
                break;
            }
            $processStreamChunk($line);
        }
        fclose($fp);
    }
}

// 5. Salva a resposta da IA no banco
$full_response = "";
if (!empty($full_thinking)) {
    if (strpos($full_content, '<think>') === false) {
        $full_response = "<think>\n" . trim($full_thinking) . "\n</think>\n\n" . $full_content;
    } else {
        $full_response = $full_content;
    }
} else {
    $full_response = $full_content;
}

if (!empty($full_response)) {
    try {
        $stmt = $pdo->prepare("INSERT INTO messages (conversation_id, role, model, content, metrics) VALUES (?, 'assistant', ?, ?, ?)");
        $stmt->execute([$conversation_id, $model, $full_response, $final_metrics]);
    } catch (\PDOException $e) {
        $stmt = $pdo->prepare("INSERT INTO messages (conversation_id, role, model, content) VALUES (?, 'assistant', ?, ?)");
        $stmt->execute([$conversation_id, $model, $full_response]);
    }
}
?>
