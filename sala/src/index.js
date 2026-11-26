// Servidor de sala do MADB. Retransmite mudanças do modelo e a posição dos cursores.
// Não interpreta o modelo: guarda tabelas por id e repassa para os outros colegas.

const ROOM_RE = /^\/room\/([A-Za-z0-9_-]{12,64})$/;
const MAX_TABLE_CHARS = 200000; // por tabela
const MAX_TABLES = 2000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    const m = url.pathname.match(ROOM_RE);
    if (!m) return new Response('não encontrado', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('esperado WebSocket', { status: 426 });
    }
    const id = env.ROOMS.idFromName(m[1]);
    return env.ROOMS.get(id).fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    this.loaded = null;
  }

  // Carrega a sala do armazenamento uma vez por instância.
  load() {
    if (!this.loaded) {
      this.loaded = (async () => {
        const meta = (await this.state.storage.get('meta')) || null;
        const order = (await this.state.storage.get('order')) || [];
        const tables = {};
        const list = await this.state.storage.list({ prefix: 't:' });
        for (const [k, v] of list) tables[k.slice(2)] = v;
        return { meta, order, tables };
      })();
    }
    return this.loaded;
  }

  async fetch(request) {
    const doc = await this.load();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'state', state: doc }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const doc = await this.load();
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); }
    catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'patch') {
      const set = msg.set && typeof msg.set === 'object' ? msg.set : {};
      const del = Array.isArray(msg.del) ? msg.del.filter((x) => typeof x === 'string') : [];
      const ids = Object.keys(set);
      if (Object.keys(doc.tables).length + ids.length > MAX_TABLES) return;
      const puts = {};
      for (const id of ids) {
        if (typeof id !== 'string' || id.length > 80) return;
        const size = JSON.stringify(set[id]).length;
        if (size > MAX_TABLE_CHARS) return;
        puts['t:' + id] = set[id];
        doc.tables[id] = set[id];
      }
      for (const id of del) {
        await this.state.storage.delete('t:' + id);
        delete doc.tables[id];
      }
      if (Array.isArray(msg.order)) {
        doc.order = msg.order.filter((x) => typeof x === 'string').slice(0, MAX_TABLES);
        puts.order = doc.order;
      }
      if (msg.meta && typeof msg.meta === 'object') {
        doc.meta = msg.meta;
        puts.meta = doc.meta;
      }
      const entries = Object.entries(puts);
      for (let i = 0; i < entries.length; i += 100) {
        await this.state.storage.put(Object.fromEntries(entries.slice(i, i + 100)));
      }
      this.broadcast(ws, JSON.stringify(msg));
      return;
    }

    if (msg.type === 'cur') {
      // posição do cursor: só repassa, não guarda
      if (typeof msg.id === 'string') ws.serializeAttachment({ id: msg.id });
      this.broadcast(ws, JSON.stringify(msg));
    }
  }

  webSocketClose(ws) {
    const a = ws.deserializeAttachment && ws.deserializeAttachment();
    if (a && a.id) this.broadcast(ws, JSON.stringify({ type: 'leave', id: a.id }));
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }

  broadcast(from, data) {
    for (const ws of this.state.getWebSockets()) {
      if (ws === from) continue;
      try { ws.send(data); } catch { /* conexão caída: ignora */ }
    }
  }
}
