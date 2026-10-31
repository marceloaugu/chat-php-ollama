<?php
define('API_ALLOW_NO_DB', true);
require 'db.php';

$action = $_GET['action'] ?? '';

header('Content-Type: application/json; charset=utf-8');

/**
 * Executa requisição HTTP (via cURL se disponível, ou via stream nativo do PHP caso cURL esteja desativado no XAMPP)
 * com fallback automático entre 127.0.0.1, localhost e host.docker.internal.
 */
function ollama_request($baseHost, $path, $postData = null, $connectTimeout = 3, $timeout = 8) {
    $candidates = [$baseHost];
    if (stripos($baseHost, 'localhost') !== false) {
        $candidates[] = str_ireplace('localhost', '127.0.0.1', $baseHost);
    } elseif (strpos($baseHost, '127.0.0.1') !== false) {
        $candidates[] = str_replace('127.0.0.1', 'localhost', $baseHost);
    }
    $candidates[] = 'http://host.docker.internal:11434';
    $candidates = array_values(array_unique($candidates));

    $hasCurl = function_exists('curl_init');
    $lastHttpCode = 0;
    $lastError = '';
    $lastResponse = false;
    $usedHost = $baseHost;

    foreach ($candidates as $candidateHost) {
        $url = rtrim($candidateHost, '/') . $path;

        if ($hasCurl) {
            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $connectTimeout);
            curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
            if (defined('CURL_IPRESOLVE_V4')) {
                curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
            }
            if ($postData !== null) {
                curl_setopt($ch, CURLOPT_POST, true);
                curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
                curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            }
            $response = curl_exec($ch);
            $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);
            curl_close($ch);
        } else {
            // Fallback nativo para ambientes PHP (como XAMPP local) onde extension=curl não está ativa
            $httpOpts = [
                'method' => ($postData !== null) ? 'POST' : 'GET',
                'timeout' => $timeout,
                'ignore_errors' => true,
                'header' => "Accept: application/json\r\n"
            ];
            if ($postData !== null) {
                $httpOpts['header'] .= "Content-Type: application/json\r\n";
                $httpOpts['content'] = $postData;
            }
            $ctx = stream_context_create(['http' => $httpOpts]);
            $http_response_header = null;
            $response = @file_get_contents($url, false, $ctx);
            $httpCode = 0;
            if (isset($http_response_header) && is_array($http_response_header)) {
                foreach ($http_response_header as $hdr) {
                    if (preg_match('#^HTTP/\d+\.\d+\s+(\d+)#i', $hdr, $m)) {
                        $httpCode = (int)$m[1];
                    }
                }
            }
            $error = ($response === false) ? (error_get_last()['message'] ?? 'Falha na conexao HTTP stream') : '';
        }

        $lastHttpCode = $httpCode;
        $lastError = $error;
        $lastResponse = $response;
        $usedHost = $candidateHost;

        if ($httpCode > 0 && $response !== false) {
            break;
        }
    }

    return [
        'response' => $lastResponse,
        'http_code' => $lastHttpCode,
        'error' => $lastError,
        'host' => $usedHost
    ];
}

if ($action === 'list_conversations') {
    if (!$pdo) {
        echo json_encode([]);
        exit;
    }
    $stmt = $pdo->query("SELECT * FROM conversations ORDER BY created_at DESC");
    echo json_encode($stmt->fetchAll());
} 

elseif ($action === 'get_messages') {
    if (!$pdo) {
        echo json_encode([]);
        exit;
    }
    $conv_id = $_GET['conversation_id'] ?? 0;
    $stmt = $pdo->prepare("SELECT role, content, model, metrics, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC");
    $stmt->execute([$conv_id]);
    echo json_encode($stmt->fetchAll());
}

elseif ($action === 'new_conversation') {
    if (!$pdo) {
        echo json_encode(['id' => 0, 'error' => $db_error]);
        exit;
    }
    $stmt = $pdo->prepare("INSERT INTO conversations (title) VALUES ('Nova Conversa')");
    $stmt->execute();
    echo json_encode(['id' => $pdo->lastInsertId()]);
}

elseif ($action === 'delete_conversation') {
    if (!$pdo) {
        echo json_encode(['success' => false, 'error' => $db_error]);
        exit;
    }
    $conv_id = $_POST['conversation_id'] ?? 0;
    $stmt = $pdo->prepare("DELETE FROM conversations WHERE id = ?");
    $stmt->execute([$conv_id]);
    echo json_encode(['success' => true]);
}

elseif ($action === 'check_status') {
    $res = ollama_request($ollama_host, '/api/tags', null, 3, 5);
    $online = ($res['http_code'] === 200);
    echo json_encode([
        'online' => $online,
        'http_code' => $res['http_code'],
        'host' => $res['host'],
        'error' => $online ? null : $res['error']
    ]);
}

elseif ($action === 'list_models') {
    $res = ollama_request($ollama_host, '/api/tags', null, 3, 8);
    
    if ($res['http_code'] === 200 && $res['response'] !== false) {
        $decoded = json_decode($res['response'], true);
        if (is_array($decoded) && isset($decoded['models']) && is_array($decoded['models'])) {
            foreach ($decoded['models'] as &$m) {
                if (empty($m['name']) && !empty($m['model'])) {
                    $m['name'] = $m['model'];
                } elseif (empty($m['model']) && !empty($m['name'])) {
                    $m['model'] = $m['name'];
                }
            }
            unset($m);
            echo json_encode($decoded);
            exit;
        }
    }

    // Fallback: tenta endpoint /v1/models caso o servidor exponha formato OpenAI
    $resV1 = ollama_request($ollama_host, '/v1/models', null, 2, 5);
    if ($resV1['http_code'] === 200 && $resV1['response'] !== false) {
        $v1Data = json_decode($resV1['response'], true);
        if (isset($v1Data['data']) && is_array($v1Data['data'])) {
            $models = [];
            foreach ($v1Data['data'] as $item) {
                $id = $item['id'] ?? $item['name'] ?? null;
                if ($id) {
                    $models[] = ['name' => $id, 'model' => $id];
                }
            }
            echo json_encode(['models' => $models]);
            exit;
        }
    }

    echo json_encode([
        'models' => [],
        'http_code' => $res['http_code'],
        'host' => $res['host'],
        'error' => $res['error']
    ]);
}

elseif ($action === 'list_running_models') {
    $res = ollama_request($ollama_host, '/api/ps', null, 3, 5);
    
    if ($res['http_code'] === 200 && $res['response'] !== false) {
        $decoded = json_decode($res['response'], true);
        if (is_array($decoded) && isset($decoded['models']) && is_array($decoded['models'])) {
            foreach ($decoded['models'] as &$m) {
                if (empty($m['name']) && !empty($m['model'])) {
                    $m['name'] = $m['model'];
                }
            }
            unset($m);
            echo json_encode($decoded);
            exit;
        }
    }
    echo json_encode(['models' => []]);
}

elseif ($action === 'run_model') {
    $selected_model = $_POST['model'] ?? $_GET['model'] ?? '';
    if (empty($selected_model)) {
        echo json_encode(['error' => 'Modelo não fornecido']);
        exit;
    }

    // 1. Obter modelos rodando atualmente
    $ps_res = ollama_request($ollama_host, '/api/ps', null, 3, 5);

    $running_models = [];
    if ($ps_res['http_code'] === 200 && $ps_res['response'] !== false) {
        $ps_data = json_decode($ps_res['response'], true);
        if (isset($ps_data['models']) && is_array($ps_data['models'])) {
            foreach ($ps_data['models'] as $m) {
                $mName = $m['name'] ?? $m['model'] ?? null;
                if ($mName) {
                    $running_models[] = $mName;
                }
            }
        }
    }

    // Normalização para comparar nomes de modelos (ignora ":latest" e caixa alta/baixa)
    $normalize = function($name) {
        return strtolower(trim(str_replace(':latest', '', $name)));
    };

    $target_norm = $normalize($selected_model);
    $unloaded = [];

    // 2. Descarregar todos os outros modelos rodando
    foreach ($running_models as $running) {
        if ($normalize($running) !== $target_norm) {
            $unload_data = json_encode([
                "model" => $running,
                "keep_alive" => 0
            ]);
            ollama_request($ollama_host, '/api/generate', $unload_data, 3, 5);
            $unloaded[] = $running;
        }
    }

    // 3. Carregar o modelo selecionado na VRAM
    $load_data = json_encode([
        "model" => $selected_model,
        "keep_alive" => -1
    ]);
    $load_res = ollama_request($ollama_host, '/api/generate', $load_data, 10, 60);

    echo json_encode([
        'success' => ($load_res['http_code'] === 200 && $load_res['response'] !== false),
        'loaded' => $selected_model,
        'unloaded' => $unloaded,
        'http_code' => $load_res['http_code'],
        'error' => $load_res['error']
    ]);
}
?>
