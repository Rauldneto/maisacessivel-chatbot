import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join('/tmp', 'bling_token.json');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BLING_CLIENT_ID = '9b8d0f84647fc866c3aeff20d44d56453a6f5365';
const BLING_CLIENT_SECRET = 'f56cb491d377cd30e57f0a8b775ba399e54371fb9639795f2bc1bf1ace62';
const BLING_REDIRECT_URI = 'https://maisacessivel-chatbot.onrender.com/callback';

function saveToken(access, refresh) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: access, refresh_token: refresh, saved_at: Date.now() })); } catch(e) {}
}

function loadToken() {
  try { const d = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); return d; } catch(e) { return null; }
}

function getBlingToken() {
  const saved = loadToken();
  if (saved && saved.access_token) return saved.access_token;
  return process.env.BLING_MCP_TOKEN || '';
}

async function refreshBlingToken() {
  const saved = loadToken();
  if (!saved || !saved.refresh_token) return false;
  try {
    const credentials = Buffer.from(BLING_CLIENT_ID + ':' + BLING_CLIENT_SECRET).toString('base64');
    const response = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + credentials },
      body: 'grant_type=refresh_token&refresh_token=' + saved.refresh_token
    });
    const data = await response.json();
    if (data.access_token) { saveToken(data.access_token, data.refresh_token || saved.refresh_token); return true; }
    return false;
  } catch(e) { return false; }
}

app.use(cors());
app.use(express.json());

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('Erro: code nao encontrado');
  try {
    const credentials = Buffer.from(BLING_CLIENT_ID + ':' + BLING_CLIENT_SECRET).toString('base64');
    const response = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + credentials },
      body: 'grant_type=authorization_code&code=' + code + '&redirect_uri=' + encodeURIComponent(BLING_REDIRECT_URI)
    });
    const data = await response.json();
    if (data.access_token) {
      saveToken(data.access_token, data.refresh_token || '');
      return res.send('<h2 style="font-family:sans-serif;color:green;text-align:center;margin-top:40px">✅ Token renovado e salvo! Pode fechar e usar o chatbot.</h2>');
    } else {
      return res.send('<h2 style="font-family:sans-serif;color:red;text-align:center;margin-top:40px">❌ Erro: ' + JSON.stringify(data) + '</h2>');
    }
  } catch(err) { return res.send('Erro: ' + err.message); }
});

app.get('/renovar-token', (_req, res) => {
  res.redirect('https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=' + BLING_CLIENT_ID + '&state=chatbotace');
});

const SYSTEM_PROMPT = `Você é o Ace, assistente virtual da Mais Acessível (maisacessivel.com.br), distribuidora de produtos de acessibilidade há 6 anos em Goiânia-GO.

PRODUTOS: barras de apoio, piso tátil, placas Braille, alarmes PCD, sanitários adaptados, materiais de construção acessíveis.

SEU OBJETIVO:
1. Cumprimentar o cliente e coletar: nome, WhatsApp ou email, categoria de produto de interesse, descrição da necessidade.
2. Usar a ferramenta do Bling para cadastrar o contato e consultar disponibilidade de produtos quando perguntado.
3. Ao final do atendimento, gerar um resumo e informar que a equipe entrará em contato.

REGRAS:
- Seja simpático, objetivo e profissional.
- Responda SEMPRE em português brasileiro.
- Não invente preços ou prazos - diga que a equipe confirmará.
- Se o cliente perguntar sobre produto específico, use o Bling para verificar estoque.`;

const CHAT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ace - Mais Acessível</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', sans-serif; background: #f0f4f8; display: flex; flex-direction: column; height: 100vh; }
#header { background: #1a2f5a; color: #fff; padding: 12px 16px; display: flex; align-items: center; gap: 10px; }
#header .info h3 { font-size: 15px; font-weight: 600; }
#header .info p { font-size: 11px; color: #a0b4cc; }
#test-banner { background: #fff3cd; color: #856404; text-align: center; padding: 6px 12px; font-size: 12px; font-weight: 600; }
#messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.msg { max-width: 82%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.5; }
.msg.bot { background: #fff; color: #222; border-bottom-left-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); align-self: flex-start; }
.msg.user { background: #FF6B00; color: #fff; border-bottom-right-radius: 4px; align-self: flex-end; }
.msg.loading { background: #fff; color: #888; font-style: italic; align-self: flex-start; }
#input-area { display: flex; padding: 12px; background: #fff; border-top: 1px solid #e0e0e0; gap: 8px; }
#user-input { flex: 1; border: 1px solid #ddd; border-radius: 24px; padding: 10px 16px; font-size: 14px; outline: none; }
#user-input:focus { border-color: #FF6B00; }
#send-btn { background: #FF6B00; color: #fff; border: none; border-radius: 50%; width: 42px; height: 42px; font-size: 18px; cursor: pointer; }
</style>
</head>
<body>
<div id="header">
  <div style="width:36px;height:36px;border-radius:50%;background:#FF6B00;display:flex;align-items:center;justify-content:center;font-size:18px;">♿</div>
  <div class="info"><h3>Ace</h3><p>Assistente da Mais Acessível</p></div>
</div>
<div id="test-banner">🔧 Versão em teste</div>
<div id="messages">
  <div class="msg bot">Olá! 👋 Sou o <strong>Ace</strong>, assistente virtual da <strong>Mais Acessível</strong>. Posso ajudar com barras de apoio, piso tátil, placas Braille e muito mais!<br><br>Qual é o seu nome?</div>
</div>
<div id="input-area">
  <input id="user-input" type="text" placeholder="Digite sua mensagem..." autofocus />
  <button id="send-btn" type="button">➤</button>
</div>
<script>
var msgs = document.getElementById('messages');
var input = document.getElementById('user-input');
var history = [];
function addMsg(text, role) {
  var d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : role === 'loading' ? 'loading' : 'bot');
  d.innerHTML = text.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
}
async function send() {
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg(text, 'user');
  history.push({role:'user', content:text});
  var loading = addMsg('Ace está digitando...', 'loading');
  try {
    var res = await fetch('/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({messages:history})});
    var data = await res.json();
    loading.remove();
    addMsg(data.reply || 'Desculpe, tente novamente.', 'bot');
    history.push({role:'assistant', content: data.reply || ''});
  } catch(e) { loading.remove(); addMsg('Erro de conexão.', 'bot'); }
}
document.getElementById('send-btn').addEventListener('click', send);
input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); send(); } });
</script>
</body>
</html>`;

app.get('/', (_req, res) => res.setHeader('Content-Type','text/html').send(CHAT_HTML));

app.post('/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({error:'invalid'});
  let token = getBlingToken();
  try {
    const callAPI = async (t) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-beta':'mcp-client-2025-04-04'},
      body: JSON.stringify({model:'claude-sonnet-4-6', max_tokens:1024, system:SYSTEM_PROMPT, messages, mcp_servers:[{type:'url',url:'https://mcp.bling.com.br/mcp',name:'bling',authorization_token:t}]})
    });
    let response = await callAPI(token);
    let data = await response.json();
    if (!response.ok && data?.error?.message?.includes('Authentication error')) {
      const refreshed = await refreshBlingToken();
      if (refreshed) { token = getBlingToken(); response = await callAPI(token); data = await response.json(); }
    }
    if (!response.ok) return res.status(response.status).json({error: data});
    const textBlocks = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
    return res.json({reply: textBlocks, stop_reason: data.stop_reason});
  } catch(err) { return res.status(500).json({error:'Erro interno.'}); }
});

app.get('/ping', (_req, res) => res.json({status:'ok', ts:Date.now()}));
app.listen(PORT, () => console.log('✅ Ace rodando na porta ' + PORT));
