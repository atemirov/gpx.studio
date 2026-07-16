# Деплой сайта (nginx + TLS)

Схема: `haproxy` (порт 443, SNI-роутинг, см. `infra/haproxy/`) → passthrough сырого TLS на
`127.0.0.1:8443` → здесь `nginx` (Docker, `network_mode: host`) терминирует TLS, отдаёт
`website/build` и проксирует `/routing/` на self-hosted BRouter (`infra/brouter/`).

## 1. Первый выпуск сертификата (Let's Encrypt, HTTP-01)

Порт 80 на VPS свободен (haproxy его не занимает) — используем standalone-режим certbot.
DNS `gpx.atemirov.ru` должен уже указывать на IP сервера.

```bash
sudo docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  certbot/certbot certonly --standalone \
  -d gpx.atemirov.ru \
  --non-interactive --agree-tos -m <твой-email>
```

Сертификат появится в `/etc/letsencrypt/live/gpx.atemirov.ru/` — именно туда смотрит
`nginx.conf` (смонтирован в контейнер `gpx_nginx` как `/etc/letsencrypt:ro`).

## 2. Обновление сертификата (cron)

Let's Encrypt сертификаты живут 90 дней. Порт 80 свободен и во время обновления — конфликтов
с haproxy/nginx нет (nginx слушает только 127.0.0.1:8443, наружу порт 80 никем не занят).

```
0 4 * * *  docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt -v /var/lib/letsencrypt:/var/lib/letsencrypt certbot/certbot renew --quiet && docker restart gpx_nginx
```

## 3. Деплой статики сайта

Пока нет CI/CD (Фаза 5) — вручную:

```bash
# локально
cd website && npm run build
rsync -avz --delete build/ atemirov@176.123.164.99:/opt/gpx-deploy/www/

# на VPS, один раз
cd /opt/gpx-deploy && docker compose up -d
```

## 4. Проверка

```bash
curl -sI https://gpx.atemirov.ru/          # ожидается 200, сертификат валиден
curl -s https://gpx.atemirov.ru/routing/brouter?lonlats=36.98,56.86|34.96,57.04&profile=trekking&format=geojson
```
