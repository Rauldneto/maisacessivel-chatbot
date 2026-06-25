import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BLING_CLIENT_ID = '9b8d0f84647fc866c3aeff20d44d56453a6f5365';
const BLING_CLIENT_SECRET = 'f56cb491d377cd30e57f0a8b775ba399e54371fb9639795f2bc1bf1ace62';
const BLING_REDIRECT_URI = 'https://maisacessivel-chatbot.onrender.com/callback';
const TOKEN_FILE = '/tmp/bling_token.json';

app.use(cors());
app.use(express.json());

// ── TOKEN HELPERS ──
function saveToken(access, refresh) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: access, refresh_token: refresh, ts: Date.now() })); } catch(e) {}
}
function loadToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch(e) { return null; }
}
function getBlingToken() {
  const d = loadToken();
  return (d && d.access_token) || process.env.BLING_MCP_TOKEN || '';
}
async function refreshBlingToken() {
  const d = loadToken();
  if (!d || !d.refresh_token) return false;
  try {
    const cr = Buffer.from(BLING_CLIENT_ID + ':' + BLING_CLIENT_SECRET).toString('base64');
    const r = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + cr },
      body: 'grant_type=refresh_token&refresh_token=' + d.refresh_token
    });
    const j = await r.json();
    if (j.access_token) { saveToken(j.access_token, j.refresh_token || d.refresh_token); return true; }
    return false;
  } catch(e) { return false; }
}

// ── OAUTH ROUTES ──
app.get('/renovar-token', (_, res) => {
  res.redirect('https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=' + BLING_CLIENT_ID + '&state=chatbotace');
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('Erro: code não encontrado');
  try {
    const cr = Buffer.from(BLING_CLIENT_ID + ':' + BLING_CLIENT_SECRET).toString('base64');
    const r = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + cr },
      body: 'grant_type=authorization_code&code=' + code + '&redirect_uri=' + encodeURIComponent(BLING_REDIRECT_URI)
    });
    const j = await r.json();
    if (j.access_token) {
      saveToken(j.access_token, j.refresh_token || '');
      return res.send('<h2 style="font-family:sans-serif;color:green;text-align:center;padding:40px">✅ Token do Bling salvo com sucesso!<br><br><a href="https://maisacessivel-chatbot.onrender.com" style="color:#FF6B00">Abrir o Ace →</a></h2>');
    }
    return res.send('<pre>Erro: ' + JSON.stringify(j) + '</pre>');
  } catch(e) { return res.send('Erro: ' + e.message); }
});

// ── SYSTEM PROMPT ──
const SYSTEM_PROMPT = `Você é o Ace, assistente virtual da Mais Acessível (maisacessivel.com.br), distribuidora de produtos de acessibilidade há 6 anos em Goiânia-GO. WhatsApp: (62) 3517-3971.

PRODUTOS: barras de apoio, piso tátil, placas Braille, alarmes PCD, sanitários adaptados.

FLUXO DE ATENDIMENTO:
1. Cumprimente e pergunte o nome do cliente
2. Pergunte o WhatsApp ou email para contato
3. Pergunte qual produto ou necessidade tem interesse
4. Tente cadastrar o contato no Bling usando a ferramenta disponível
5. Consulte produtos/estoque no Bling se o cliente perguntar sobre disponibilidade
6. Ao final, informe que a equipe entrará em contato e passe o WhatsApp (62) 3517-3971

REGRAS:
- Responda SEMPRE em português brasileiro
- Seja simpático, objetivo e profissional
- Não invente preços ou prazos — diga que a equipe confirmará
- Se der erro no Bling, continue o atendimento normalmente`;

// ── HTML DO CHATBOT ──
app.get('/chat.js', (_, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
var H=[];
function am(t,c){
  var d=document.createElement('div');
  d.className=c;
  d.innerHTML=t.replace(/\\n/g,'<br>').replace(/\\*\\*(.*?)\\*\\*/g,'<b>$1</b>');
  var m=document.getElementById('msgs');
  m.appendChild(d);
  m.scrollTop=9999;
  return d;
}
function enviar(){
  var inp=document.getElementById('inp');
  var t=inp.value.trim();
  if(!t)return;
  inp.value='';
  am(t,'u');
  H.push({role:'user',content:t});
  var l=am('Ace está digitando...','l');
  fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:H})})
  .then(function(r){return r.json();})
  .then(function(d){
    l.remove();
    am(d.reply||'Erro, tente novamente.','b');
    H.push({role:'assistant',content:d.reply||''});
  })
  .catch(function(){
    l.remove();
    am('Erro de conexão. Tente novamente.','b');
  });
}
document.getElementById('sb').onclick=enviar;
document.getElementById('inp').onkeydown=function(e){
  if(e.key==='Enter'){e.preventDefault();enviar();}
};
  `);
});

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ace - Mais Acessível</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Segoe UI,sans-serif;background:#f0f4f8;display:flex;flex-direction:column;height:100vh}
#hd{background:#1a2f5a;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px}
#bn{background:#fff3cd;color:#856404;text-align:center;padding:6px;font-size:12px;font-weight:600}
#msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.b,.u,.l{max-width:82%;padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.5}
.b{background:#fff;color:#222;border-bottom-left-radius:4px;align-self:flex-start;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.u{background:#FF6B00;color:#fff;border-bottom-right-radius:4px;align-self:flex-end}
.l{background:#fff;color:#888;font-style:italic;align-self:flex-start}
#ia{display:flex;padding:12px;background:#fff;border-top:1px solid #e0e0e0;gap:8px}
#inp{flex:1;border:1px solid #ddd;border-radius:24px;padding:10px 16px;font-size:14px;outline:none}
#inp:focus{border-color:#FF6B00}
#sb{background:#FF6B00;color:#fff;border:none;border-radius:50%;width:42px;height:42px;font-size:18px;cursor:pointer}
</style>
</head>
<body>
<div id="hd">
<div style="width:36px;height:36px;border-radius:50%;background:#FF6B00;display:flex;align-items:center;justify-content:center;font-size:18px">&#9855;</div>
<div><h3 style="font-size:15px">Ace</h3><p style="font-size:11px;color:#a0b4cc">Assistente da Mais Acessível</p></div>
</div>
<div id="bn">&#128295; Versão em teste</div>
<div id="msgs">
<div class="b">Olá! 👋 Sou o <b>Ace</b>, assistente da <b>Mais Acessível</b>. Posso ajudar com barras de apoio, piso tátil, Braille e muito mais!<br><br>Qual é o seu nome?</div>
</div>
<div id="ia">
<input id="inp" type="text" placeholder="Digite aqui...">
<button id="sb" type="button">&#10148;</button>
</div>
<script src="/chat.js"></script>
</body>
</html>`;

app.get('/', (_, res) => res.setHeader('Content-Type', 'text/html').send(HTML));

// ── CHAT ENDPOINT ──
app.post('/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'invalid' });
  let token = getBlingToken();
  try {
    const callAPI = async (t) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
        mcp_servers: [{ type: 'url', url: 'https://mcp.bling.com.br/mcp', name: 'bling', authorization_token: t }]
      })
    });
    let resp = await callAPI(token);
    let data = await resp.json();
    // Se token expirou, tenta refresh automatico
    if (!resp.ok && JSON.stringify(data).includes('Authentication')) {
      const refreshed = await refreshBlingToken();
      if (refreshed) { token = getBlingToken(); resp = await callAPI(token); data = await resp.json(); }
    }
    if (!resp.ok) return res.status(resp.status).json({ error: data });
    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const toolsUsed = (data.content || []).filter(b => b.type === 'mcp_tool_use').map(b => b.name);
    return res.json({ reply: txt, toolsUsed });
  } catch(e) { return res.status(500).json({ error: 'Erro interno' }); }
});

app.get('/ping', (_, res) => res.json({ status: 'ok', ts: Date.now() }));
app.listen(PORT, () => console.log('Ace rodando porta ' + PORT));
