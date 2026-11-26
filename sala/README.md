# Sala de edição do MADB (servidor)

Servidor que retransmite as mudanças de uma arquitetura entre colegas, em tempo real,
e os cursores. Roda na Cloudflare Workers com Durable Objects (plano gratuito).
Cada sala é um Durable Object; o modelo fica guardado nele, e não há login.

## Publicar (uma vez)

Dentro desta pasta (`C:\MADB\sala`):

```
npm install
npx wrangler login          (abre o navegador para entrar na sua conta Cloudflare)
npx wrangler deploy
```

O `deploy` mostra o endereço, por exemplo `https://madb-sala.SEU-USUARIO.workers.dev`.
Troque `https://` por `wss://` e cole no MADB em **perfil (○) → Servidor de sala**.

## Testar localmente

```
npx wrangler dev --port 8787
```

Use `ws://127.0.0.1:8787` como servidor no perfil.

## Como funciona

- `GET /health` responde `ok`.
- `WebSocket /room/<id>`: entra na sala. Cada mudança de tabela, ordem ou configurações
  é guardada por tabela e repassada aos outros. A posição do cursor só é repassada, não guardada.
- Quem tiver o link pode editar. O link tem um código de 12 caracteres, difícil de adivinhar.
- Conflito: se dois colegas mexerem na mesma tabela ao mesmo tempo, vale a última gravação.

## Limites do plano gratuito

Confira os limites atuais em https://developers.cloudflare.com/durable-objects/platform/pricing/
antes de usar com muitos colegas.
