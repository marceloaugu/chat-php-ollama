<?php
$ollama_host = $_ENV['OLLAMA_HOST'] ?? getenv('OLLAMA_HOST') ?: 'http://localhost:11434';
$ollama_host = rtrim($ollama_host, '/');
$url = "$ollama_host/api/tags";
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
$info = curl_getinfo($ch);
curl_close($ch);

echo "HTTP Code: " . $info['http_code'] . "\n";
echo "Response: " . $response . "\n";
?>
