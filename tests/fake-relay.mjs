// An in-memory stand-in for ntfy.sh, shared by every simulated phone that
// installs it, so tests can post and pull shared maps without the network.
export function createRelay() {
  const topics = new Map();      // topic -> [{ id, time, event, topic, message }]
  const listeners = new Map();   // topic -> Set of EventSource fakes
  let seq = 0;
  const topicOf = (url) => new URL(url).pathname.split('/')[1];

  function install(window) {
    window.fetch = async (url, options = {}) => {
      const u = new URL(String(url));
      if (u.hostname !== 'ntfy.sh') throw new Error(`unexpected request to ${u.hostname}`);
      const topic = topicOf(u);
      const posts = topics.get(topic) || [];
      const respond = (status, body) => ({
        ok: status >= 200 && status < 300, status,
        text: async () => body, json: async () => JSON.parse(body)
      });
      if ((options.method || 'GET') === 'POST') {
        const msg = { id: `m${++seq}`, time: Math.floor(Date.now() / 1000) + seq, event: 'message', topic, message: String(options.body) };
        posts.push(msg);
        topics.set(topic, posts);
        for (const es of listeners.get(topic) || []) setTimeout(() => es.onmessage && es.onmessage({ data: JSON.stringify(msg) }), 0);
        return respond(200, JSON.stringify(msg));
      }
      if (u.pathname.endsWith('/json')) return respond(200, posts.map((p) => JSON.stringify(p)).join('\n'));
      return respond(404, '');
    };
    window.EventSource = class FakeEventSource {
      constructor(url) {
        this.topic = topicOf(url);
        if (!listeners.has(this.topic)) listeners.set(this.topic, new Set());
        listeners.get(this.topic).add(this);
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      close() { listeners.get(this.topic).delete(this); }
    };
  }

  return { install, topics, posts: (topic) => topics.get(topic) || [] };
}
