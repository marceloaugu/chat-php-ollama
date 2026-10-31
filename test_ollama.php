<?php
define('API_ALLOW_NO_DB', true);
require 'db.php';

header('Content-Type: text/plain; charset=utf-8');

$url = "$ollama_host/api/tags";
$has_curl = function_exists('curl_init');

echo "OLLAMA_HOST: " . $ollama_host . "\n";
echo "URL testada: " . $url . "\n";
echo "Extensao cURL ativa no PHP: " . ($has_curl ? "SIM" : "NAO (usando fallback nativo stream HTTP)") . "\n";

if ($has_curl) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    if (defined('CURL_IPRESOLVE_V4')) {
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    $response = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
} else {
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 10,
            'ignore_errors' => true
        ]
    ]);
    $response = @file_get_contents($url, false, $ctx);
    $httpCode = 0;
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $hdr) {
            if (preg_match('#^HTTP/\d+\.\d+\s+(\d+)#i', $hdr, $m)) {
                $httpCode = (int)$m[1];
            }
        }
    }
    $error = ($response === false) ? (error_get_last()['message'] ?? 'Falha na conexao via stream') : '';
}

echo "HTTP Code: " . $httpCode . "\n";
if ($error) {
    echo "Error: " . $error . "\n";
}
echo "Response: " . $response . "\n";
?>
