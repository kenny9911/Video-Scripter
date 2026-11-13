// A small MCP client: enough to call one tool on a remote server over Streamable HTTP, which is how a
// hosted MCP server such as Tavily's (https://mcp.tavily.com/mcp/?tavilyApiKey=…) is reached.
//
//   const { text } = await mcpCall(link, /search$/, { query: '…' }, { signal });
//
// One call is four requests: initialize, the "initialized" note, tools/list (the server says what its tools
// are called, which has changed between versions), then tools/call. The server answers each with JSON or
// with a short event stream; both are read. Nothing of the link is ever put in an error message: it may
// carry a key.

import { request, GatewayError } from '../gateway/client.mjs';

const PROTOCOL = '2025-03-26';

/** The JSON-RPC reply to request `id` out of a response body that is JSON or an event stream. */
async function replyOf(res, id) {
  if (!/text\/event-stream/i.test(res.headers.get('content-type') || '')) {
    const body = await res.json().catch(() => null);
    return Array.isArray(body) ? body.find((m) => m?.id === id) || null : body;
  }
  const decoder = new TextDecoder();
  let buf = '';
  let data = [];
  const take = () => {
    const text = data.join('\n');
    data = [];
    if (!text) return null;
    try {
      const msg = JSON.parse(text);
      return msg?.id === id ? msg : null;
    } catch {
      return null;
    }
  };
  try {
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        else if (!line) {
          const msg = take();
          if (msg) return msg;
        }
      }
    }
  } finally {
    res.body?.cancel?.().catch(() => {}); // the reply is in hand: the stream need not be read to its end
  }
  if (buf.startsWith('data:')) data.push(buf.slice(5).trimStart());
  return take();
}

/**
 * Call the first tool of the server at `link` whose name matches `pick` with `args`.
 * Returns { tool, text, structured }: the tool's name, its text content joined, and its structured content when it has any.
 */
export async function mcpCall(link, pick, args, { signal } = {}) {
  const host = new URL(link).host;
  const session = { id: '', cookies: new Map() };
  const failed = (message, status = 502) => Object.assign(new GatewayError(`${host}: ${message}`, status), { host });

  const rpc = async (method, params, id) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (session.id) headers['mcp-session-id'] = session.id;
    if (method !== 'initialize') headers['mcp-protocol-version'] = PROTOCOL;
    // A load balancer in front of the server may pin the session to one machine with a cookie.
    if (session.cookies.size) headers.cookie = [...session.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await request(link, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(id != null && { id }), method, ...(params && { params }) }), signal }, { retries: 1 });
    session.id = res.headers.get('mcp-session-id') || session.id;
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      if (at > 0) session.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    if (id == null) return void res.body?.cancel?.().catch(() => {}); // a note has no reply
    const msg = await replyOf(res, id);
    if (!msg) throw failed('the MCP server did not answer the request');
    if (msg.error) throw failed(String(msg.error.message || 'the MCP server refused the request').slice(0, 300));
    return msg.result || {};
  };

  await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'video-scripter', version: '0.1.0' } }, 1);
  await rpc('notifications/initialized').catch((err) => {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') throw err; // a server that keeps no session may refuse the note; the call still works
  });
  const tools = (await rpc('tools/list', {}, 2)).tools || [];
  const tool = tools.find((t) => pick.test(String(t?.name || '')));
  if (!tool) throw failed(`the MCP server has no tool for this (it offers: ${tools.map((t) => t.name).join(', ').slice(0, 200) || 'none'})`);
  const result = await rpc('tools/call', { name: tool.name, arguments: args }, 3);
  const text = (result.content || []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
  if (result.isError) throw failed(text.replace(/\s+/g, ' ').slice(0, 300) || 'the tool failed');
  return { tool: tool.name, text, structured: result.structuredContent || null };
}
