<?php
require 'db.php';

$action = $_GET['action'] ?? '';

header('Content-Type: application/json');

if ($action === 'list_conversations') {
    $stmt = $pdo->query("SELECT * FROM conversations ORDER BY created_at DESC");
    echo json_encode($stmt->fetchAll());
} 

elseif ($action === 'get_messages') {
    $conv_id = $_GET['conversation_id'] ?? 0;
    $stmt = $pdo->prepare("SELECT role, content, model, metrics, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC");
    $stmt->execute([$conv_id]);
    echo json_encode($stmt->fetchAll());
}

elseif ($action === 'new_conversation') {
    $stmt = $pdo->prepare("INSERT INTO conversations (title) VALUES ('Nova Conversa')");
    $stmt->execute();
    echo json_encode(['id' => $pdo->lastInsertId()]);
}

elseif ($action === 'delete_conversation') {
    $conv_id = $_POST['conversation_id'] ?? 0;
    $stmt = $pdo->prepare("DELETE FROM conversations WHERE id = ?");
    $stmt->execute([$conv_id]);
    echo json_encode(['success' => true]);
}

elseif ($action === 'check_status') {
    $url = "$ollama_host/api/tags";
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    echo json_encode(['online' => ($httpCode === 200)]);
}

elseif ($action === 'list_models') {
    $url = "$ollama_host/api/tags";
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200) {
        echo $response;
    } else {
        echo json_encode(['models' => []]);
    }
}

elseif ($action === 'list_running_models') {
    $url = "$ollama_host/api/ps";
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200 && $response !== false) {
        echo $response;
    } else {
        echo json_encode(['models' => []]);
    }
}

elseif ($action === 'run_model') {
    $selected_model = $_POST['model'] ?? $_GET['model'] ?? '';
    if (empty($selected_model)) {
        echo json_encode(['error' => 'Modelo não fornecido']);
        exit;
    }

    // 1. Obter modelos rodando atualmente
    $ps_url = "$ollama_host/api/ps";
    $ch = curl_init($ps_url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    $ps_response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $running_models = [];
    if ($httpCode === 200 && $ps_response !== false) {
        $ps_data = json_decode($ps_response, true);
        if (isset($ps_data['models']) && is_array($ps_data['models'])) {
            foreach ($ps_data['models'] as $m) {
                $running_models[] = $m['name'];
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
            $unload_url = "$ollama_host/api/generate";
            $unload_data = json_encode([
                "model" => $running,
                "keep_alive" => 0
            ]);

            $ch = curl_init($unload_url);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $unload_data);
            curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type:application/json'));
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
            curl_setopt($ch, CURLOPT_TIMEOUT, 5);
            curl_exec($ch);
            curl_close($ch);
            $unloaded[] = $running;
        }
    }

    // 3. Carregar o modelo selecionado na VRAM
    $load_url = "$ollama_host/api/generate";
    $load_data = json_encode([
        "model" => $selected_model,
        "keep_alive" => -1
    ]);
    $ch = curl_init($load_url);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $load_data);
    curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type:application/json'));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, 60);
    $load_response = curl_exec($ch);
    $loadCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    echo json_encode([
        'success' => ($loadCode === 200 && $load_response !== false),
        'loaded' => $selected_model,
        'unloaded' => $unloaded
    ]);
}
?>
