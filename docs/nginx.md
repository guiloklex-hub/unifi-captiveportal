# Proxy reverso nginx + HTTPS

Colocar o portal atrás de um nginx é o arranjo recomendado em produção:

- **IP real do cliente** (`X-Real-IP`): rate limit, logs e a descoberta do MAC por IP
  (acesso via QR code / portal aberto sem MAC) dependem dele. Sem proxy, o IP é
  parcialmente falsificável (ver README §15.4).
- **HTTPS no painel** (cookie de sessão `Secure`).
- **Login social** (Google/Microsoft) exige `PUBLIC_PORTAL_URL` em HTTPS.

## Pontos de atenção

1. A UniFi redireciona o convidado para **`http://IP_DO_PORTAL/guest/s/<site>/`**.
   Mantenha a porta **80 servindo o portal** — não force HTTPS para `/guest`,
   `/portal` e `/api/portal`: antes de autorizado, o dispositivo pode não conseguir
   validar o certificado ou resolver o nome. Força HTTPS só no painel (`/admin`).
2. Preserve o cabeçalho **`Host`**: a proteção CSRF do painel compara
   `Origin`/`Referer` com o `Host` recebido.
3. Informe **`X-Forwarded-Proto`**: os redirecionamentos do painel usam esse valor.
4. Com nginx na mesma máquina, o Node passa a escutar só em `127.0.0.1:3000`, para
   ninguém contornar o proxy:
   - **PM2** — em `ecosystem.config.js`, troque `script: "npm", args: "start"` por
     `script: "node_modules/.bin/next", args: "start -p 3000 -H 127.0.0.1"`.
   - **Docker** — em `docker-compose.yml`, use `ports: ["127.0.0.1:3000:3000"]`.
5. Coloque o **nome do host HTTPS** (ex.: `wifi.suaempresa.com.br`) no walled garden
   da UniFi se for usar o login social — o callback OAuth volta para ele.

## Exemplo

```nginx
# /etc/nginx/sites-available/captive-portal
upstream captive_portal {
    server 127.0.0.1:3000;
    keepalive 16;
}

# Cabeçalhos repassados ao Next.js (inclua em cada location).
# proxy_set_header Host              $host;
# proxy_set_header X-Real-IP         $remote_addr;
# proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
# proxy_set_header X-Forwarded-Proto $scheme;

server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 6m;   # uploads de logo/fundo (limite do app: 5 MB)

    # Painel administrativo → sempre HTTPS
    location /admin      { return 301 https://wifi.suaempresa.com.br$request_uri; }
    location /api/admin  { return 301 https://wifi.suaempresa.com.br$request_uri; }

    # Portal do convidado (HTTP, é para cá que a UniFi redireciona)
    location / {
        proxy_pass http://captive_portal;
        proxy_http_version 1.1;
        proxy_set_header Connection        "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    http2 on;
    server_name wifi.suaempresa.com.br;

    ssl_certificate     /etc/letsencrypt/live/wifi.suaempresa.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wifi.suaempresa.com.br/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 6m;

    location / {
        proxy_pass http://captive_portal;
        proxy_http_version 1.1;
        proxy_set_header Connection        "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ative e obtenha o certificado:

```bash
sudo ln -s /etc/nginx/sites-available/captive-portal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d wifi.suaempresa.com.br
```

## `.env` correspondente

```bash
COOKIE_SECURE="true"                                 # painel só por HTTPS
PUBLIC_PORTAL_URL="https://wifi.suaempresa.com.br"   # QR codes, login social
```

E na UniFi (**External Portal Server**), continue usando o **IP** do servidor — a porta 80
agora é atendida pelo nginx.

## Cloudflare / outro proxy na frente

O portal também aceita `CF-Connecting-IP`. Se houver mais de um proxy, garanta que o
último (o que fala com o Node) sobrescreva `X-Real-IP` com o IP do cliente — o portal
confia nele antes de `X-Forwarded-For`.
