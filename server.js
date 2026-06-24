import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BLING_MCP_TOKEN = process.env.BLING_MCP_TOKEN;

app.use(cors());
app.use(express.json());

const SYSTEM_PROMPT = `Você é o Ace, assistente virtual da Mais Acessível (maisacessivel.com.br), distribuidora de produtos de acessibilidade há 6 anos em Goiânia-GO.

PRODUTOS: barras de apoio, piso tátil, placas Braille, alarmes PCD, sanitários adaptados, materiais de construção acessíveis.

SEU OBJETIVO:
1. Cumprimentar o cliente e coletar: nome, WhatsApp ou email, categoria de produto de interesse, descrição da necessidade.
2. Usar a ferramenta do Bling para cadastrar o contato e consultar disponibilidade de produtos quando perguntado.
3. Ao final do atendimento, gerar um resumo e informar que a equipe entrará em contato.

REGRAS:
- Seja simpático, objetivo e profissional.
- Responda SEMPRE em português brasileiro.
- Não invente preços ou prazos — diga que a equipe confirmará.
- Se o cliente perguntar sobre produto específico, use o Bling para verificar estoque.`;

const CHAT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ace - Mais Acessível</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', sans-serif; background: #f0f4f8; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
#header { background: #1a2f5a; color: #fff; padding: 12px 16px; display: flex; align-items: center; gap: 10px; }
#header .info h3 { font-size: 15px; font-weight: 600; }
#header .info p { font-size: 11px; color: #a0b4cc; }
#test-banner { background: #fff3cd; color: #856404; text-align: center; padding: 6px 12px; font-size: 12px; font-weight: 600; border-bottom: 1px solid #ffc107; }
#messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.msg { max-width: 82%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.5; }
.msg.bot { background: #fff; color: #222; border-bottom-left-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); align-self: flex-start; }
.msg.user { background: #FF6B00; color: #fff; border-bottom-right-radius: 4px; align-self: flex-end; }
.msg.loading { background: #fff; color: #888; font-style: italic; align-self: flex-start; }
#input-area { display: flex; padding: 12px; background: #fff; border-top: 1px solid #e0e0e0; gap: 8px; }
#user-input { flex: 1; border: 1px solid #ddd; border-radius: 24px; padding: 10px 16px; font-size: 14px; outline: none; }
#user-input:focus { border-color: #FF6B00; }
#send-btn { background: #FF6B00; color: #fff; border: none; border-radius: 50%; width: 42px; height: 42px; font-size: 18px; cursor: pointer; }
#send-btn:hover { background: #e55d00; }
#lock-screen { position: fixed; inset: 0; background: #1a2f5a; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; gap: 16px; padding: 32px; }
#lock-screen .logo { font-size: 48px; }
#lock-screen h2 { color: #fff; font-size: 18px; text-align: center; }
#lock-screen .sub { color: #a0b4cc; font-size: 13px; text-align: center; }
#lock-screen .badge { background: #ffc107; color: #333; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 12px; }
#pwd-input { width: 100%; max-width: 280px; padding: 12px 16px; border-radius: 24px; border: 2px solid #2d4a7a; background: #243660; color: #fff; font-size: 15px; outline: none; text-align: center; }
#pwd-input:focus { border-color: #FF6B00; }
#enter-btn { background: #FF6B00; color: #fff; border: none; border-radius: 24px; padding: 12px 32px; font-size: 15px; font-weight: 600; cursor: pointer; width: 100%; max-width: 280px; }
#enter-btn:hover { background: #e55d00; }
#pwd-error { color: #ff6b6b; font-size: 13px; display: none; }
</style>
</head>
<body>

<div id="lock-screen">
  <div class="logo">♿</div>
  <span class="badge">🔧 EM TESTE</span>
  <h2>Ace — Assistente da Mais Acessível</h2>
  <p class="sub">Este chatbot está em fase de testes.<br>Digite a senha para continuar.</p>
  <input id="pwd-input" type="password" placeholder="Digite a senha..." />
  <div id="pwd-error">❌ Senha incorreta. Tente novamente.</div>
  <button id="enter-btn" type="button">Entrar</button>
</div>

<div id="header" style="display:none">
  <div style="width:36px;height:36px;border-radius:50%;background:#FF6B00;display:flex;align-items:center;justify-content:center;font-size:18px;">♿</div>
  <div class="info"><h3>Ace</h3><p>Assistente da Mais Acessível</p></div>
</div>
<div id="test-banner" style="display:none">🔧 Versão em teste — seu feedback é bem-vindo!</div>
<div id="messages" style="display:none;flex-direction:column">
  <div class="msg bot">Olá! 👋 Sou o <strong>Ace</strong>, assistente virtual da <strong>Mais Acessível</strong>. Posso ajudar com barras de apoio, piso tátil, placas Braille e muito mais!<br><br>Qual é o seu nome?</div>
</div>
<div id="input-area" style="display:none">
  <input id="user-input" type="text" placeholder="Digite sua mensagem..." />
  <button id="send-btn" type="button">➤</button>
</div>

<script>
function unlock() {
  var val = document.getElementById('pwd-input').value;
  if (val === 'Tendfer@2019') {
    document.getElementById('lock-screen').style.display = 'none';
    document.getElementById('header').style.display = 'flex';
    document.getElementById('test-banner').style.display = 'block';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('input-area').style.display = 'flex';
  } else {
    document.getElementById('pwd-error').style.display = 'block';
    document.getElementById('pwd-input').value = '';
    document.getElementById('pwd-input').focus();
  }
}

document.getElementById('enter-btn').addEventListener('click', unlock);
document.getElementById('pwd-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); unlock(); }
});

var msgs = document.getElementById('messages');
var input = document.getElementById('user-input');
var history = [];

function addMsg(text, role) {
  var d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : role === 'loading' ? 'loading' : 'bot');
  d.innerHTML = text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}

async function send() {
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg(text, 'user');
  history.push({ role: 'user', content: text });
  var loading = addMsg('Ace está digitando...', 'loading');
  try {
    var res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history })
    });
    var data = await res.json();
    loading.remove();
    var reply = data.reply || 'Desculpe, tente novamente.';
    addMsg(reply, 'bot');
    history.push({ role: 'assistant', content: reply });
  } catch(e) {
    loading.remove();
    addMsg('Erro de conexão. Tente novamente.', 'bot');
  }
}

document.getElementById('send-btn').addEventListener('click', send);
document.getElementById('user-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') send();
});
</script>
</body>
</html>`;

app.get("/", (_req, res) => res.setHeader('Content-Type','text/html').status(200).send(CHAT_HTML));

app.post("/chat", async (req, res) => {
const { messages } = req.body;
if (!messages || !Array.isArray(messages)) {
return res.status(400).json({ error: "messages inválido" });
}
try {
const response = await fetch("https://api.anthropic.com/v1/messages", {
method: "POST",
headers: {
"Content-Type": "application/json",
"x-api-key": ANTHROPIC_API_KEY,
"anthropic-version": "2023-06-01",
"anthropic-beta": "mcp-client-2025-04-04"
},
body: JSON.stringify({
model: "claude-sonnet-4-6",
max_tokens: 1024,
system: SYSTEM_PROMPT,
messages,
mcp_servers: [
{
type: "url",
url: "https://mcp.bling.com.br/mcp",
name: "bling",
authorization_token: BLING_MCP_TOKEN
}
]
})
});
const data = await response.json();
if (!response.ok) return res.status(response.status).json({ error: data });
var blingContactId = null;
var textBlocks = (data.content || []).filter(function(b){ return b.type === "text"; }).map(function(b){ return b.text; }).join("\n");
for (var i = 0; i < (data.content || []).length; i++) {
var block = data.content[i];
if (block.type === "mcp_tool_result") {
try { var p = JSON.parse(block.content?.[0]?.text || ""); if (p?.data?.id) { blingContactId = p.data.id; break; } } catch(e) {}
}
}
var toolsUsed = (data.content || []).filter(function(b){ return b.type === "mcp_tool_use"; }).map(function(b){ return b.name; });
return res.json({ reply: textBlocks, blingContactId: blingContactId, toolsUsed: toolsUsed, stop_reason: data.stop_reason });
} catch (err) {
return res.status(500).json({ error: "Erro interno do servidor." });
}
});

app.get("/ping", (_req, res) => res.json({ status: "ok", ts: Date.now() }));
app.listen(PORT, () => console.log(`✅ Ace backend rodando na porta ${PORT}`));
