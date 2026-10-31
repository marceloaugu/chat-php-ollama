FROM php:8.4-apache

# Instala dependências do sistema e extensões do PHP necessárias
RUN apt-get update && apt-get install -y \
    libcurl4-openssl-dev \
    pkg-config \
    libssl-dev \
    && docker-php-ext-install pdo_mysql curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Habilita o mod_rewrite do Apache
RUN a2enmod rewrite

# Define diretório de trabalho
WORKDIR /var/www/html

# Copia os arquivos do projeto para o container
COPY . /var/www/html/

# Ajusta permissões dos arquivos para o Apache
RUN chown -R www-data:www-data /var/www/html

EXPOSE 80
