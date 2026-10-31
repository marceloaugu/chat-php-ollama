<?php
// Carrega variáveis do arquivo .env se existir (sem dependência externa)
if (file_exists(__DIR__ . '/.env')) {
    $env_lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($env_lines as $line) {
        $line = trim($line);
        if ($line === '' || strpos($line, '#') === 0) continue;
        if (strpos($line, '=') !== false) {
            list($key, $val) = explode('=', $line, 2);
            $key = trim($key);
            $val = trim($val, " \t\n\r\0\x0B\"'");
            putenv("$key=$val");
            $_ENV[$key] = $val;
            $_SERVER[$key] = $val;
        }
    }
}

$host = $_ENV['DB_HOST'] ?? getenv('DB_HOST') ?: 'localhost';
$db   = $_ENV['DB_NAME'] ?? getenv('DB_NAME') ?: 'chat_app';
$user = $_ENV['DB_USER'] ?? getenv('DB_USER') ?: 'ubuntu';
$pass = $_ENV['DB_PASS'] ?? getenv('DB_PASS') ?: '';
if ($pass === false || $pass === null) {
    $pass = '';
}
$charset = 'utf8mb4';

$ollama_host = $_ENV['OLLAMA_HOST'] ?? getenv('OLLAMA_HOST') ?: 'http://127.0.0.1:11434';
$ollama_host = rtrim(trim($ollama_host), '/');
// Remove sufixos acidentais /api ou /v1 caso tenham sido incluídos na variável OLLAMA_HOST
$ollama_host = preg_replace('#/(api|v1)$#i', '', $ollama_host);

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

$pdo = null;
$db_error = null;

/**
 * Conecta ao MySQL/MariaDB e inicializa o banco caso ainda não exista.
 */
function connect_and_setup_db($host, $db, $user, $pass, $charset, $options) {
    try {
        $dsn = "mysql:host=$host;dbname=$db;charset=$charset";
        return new PDO($dsn, $user, $pass, $options);
    } catch (\PDOException $e) {
        // Se o erro for de acesso negado (1045), propaga para tentar credencial alternativa
        if ((int)$e->getCode() === 1045 || strpos($e->getMessage(), '1045') !== false) {
            throw $e;
        }
        $dsn_setup = "mysql:host=$host;charset=$charset";
        $pdo = new PDO($dsn_setup, $user, $pass, $options);
        $pdo->exec("CREATE DATABASE IF NOT EXISTS `$db` CHARACTER SET $charset COLLATE utf8mb4_unicode_ci");
        $pdo->exec("USE `$db`");
        return $pdo;
    }
}

try {
     try {
         $pdo = connect_and_setup_db($host, $db, $user, $pass, $charset, $options);
     } catch (\PDOException $authEx) {
         // Fallback automático para ambiente XAMPP local (root sem senha)
         if ($user !== 'root' && ($host === 'localhost' || $host === '127.0.0.1')) {
             $pdo = connect_and_setup_db($host, $db, 'root', '', $charset, $options);
         } else {
             throw $authEx;
         }
     }
     
     // Cria tabela conversations se não existir
     $pdo->exec("CREATE TABLE IF NOT EXISTS conversations (
         id INT AUTO_INCREMENT PRIMARY KEY,
         title VARCHAR(255) DEFAULT 'Nova Conversa',
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     )");
     
     // Cria tabela messages se não existir
     $pdo->exec("CREATE TABLE IF NOT EXISTS messages (
         id INT AUTO_INCREMENT PRIMARY KEY,
         conversation_id INT,
         role ENUM('user', 'assistant') NOT NULL,
         model VARCHAR(50) DEFAULT NULL,
         content TEXT NOT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
     )");
     
     // Garante que a coluna 'model' existe na tabela 'messages' (caso seja um banco antigo já existente)
     $stmt = $pdo->query("SHOW COLUMNS FROM messages LIKE 'model'");
     if (!$stmt->fetch()) {
         $pdo->exec("ALTER TABLE messages ADD COLUMN model VARCHAR(50) DEFAULT NULL AFTER role");
     }
     
     // Garante que a coluna 'metrics' existe na tabela 'messages' para armazenar tokens/s e tempo
     $stmt_m = $pdo->query("SHOW COLUMNS FROM messages LIKE 'metrics'");
     if (!$stmt_m->fetch()) {
         $pdo->exec("ALTER TABLE messages ADD COLUMN metrics TEXT DEFAULT NULL AFTER content");
     }
     
} catch (\PDOException $e) {
     $db_error = $e->getMessage();
     if (!defined('API_ALLOW_NO_DB')) {
         die("Erro ao conectar ou configurar o banco de dados: " . $db_error);
     }
}
?>
