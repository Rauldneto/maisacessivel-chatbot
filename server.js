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
const FIREBASE_URL = 'https://maisacessivel-1d0ad-default-rtdb.firebaseio.com';

app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.options('*', cors());
app.use(express.json());

// ── FIREBASE HELPERS ──
async function fbGet(path) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`);
    return await r.json();
  } catch(e) { return null; }
}
async function fbSet(path, data) {
  try {
    await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return true;
  } catch(e) { return false; }
}

// ── BLING TOKEN ──
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

// ── OAUTH BLING ──
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
      return res.send('<h2 style="font-family:sans-serif;color:green;text-align:center;padding:40px">✅ Token do Bling salvo!<br><br><a href="https://maisacessivel-chatbot.onrender.com">Abrir o Ace →</a></h2>');
    }
    return res.send('<pre>Erro: ' + JSON.stringify(j) + '</pre>');
  } catch(e) { return res.send('Erro: ' + e.message); }
});

// ── CONFIG E LEADS (Firebase) ──
const DEFAULT_CONFIG = {
  instrucoes: '',
  tom: 'amigavel',
  whatsapp: '556235173971',
  site: 'maisacessivel.com.br',
  endereco: 'Goiânia, GO',
  horarioIni: '08:00',
  horarioFim: '18:00',
  msgBoasVindas: '',
  msgForaHorario: 'Olá! Nosso horário é seg-sex 8h às 18h. Deixe nome e WhatsApp que retornamos em breve!',
  proibidas: [],
  respostas: [],
  capturaLeads: true
};

app.get('/config', async (_, res) => {
  const cfg = await fbGet('ace_config') || DEFAULT_CONFIG;
  res.json(cfg);
});
app.post('/config', async (req, res) => {
  const atual = await fbGet('ace_config') || DEFAULT_CONFIG;
  const novo = Object.assign({}, atual, req.body);
  await fbSet('ace_config', novo);
  res.json({ ok: true });
});
app.get('/leads', async (_, res) => {
  const leads = await fbGet('ace_leads') || [];
  res.json(Array.isArray(leads) ? leads : Object.values(leads));
});

// ── SYSTEM PROMPT DINAMICO ──
async function buildSystemPrompt(horaCliente) {
  const cfg = await fbGet('ace_config') || DEFAULT_CONFIG;

  // APENAS instrucoes do administrador — sem texto fixo
  let prompt = cfg.instrucoes || 'Voce e um assistente virtual. Responda em portugues brasileiro.';

  // Dados complementares
  prompt += '\n\nDados da empresa: WhatsApp ' + (cfg.whatsapp||'(62) 3517-3971') + ', Site: ' + (cfg.site||'maisacessivel.com.br') + ', Endereco: ' + (cfg.endereco||'Goiania, GO') + '.';

  if (cfg.proibidas && cfg.proibidas.length > 0) {
    prompt += '\n\nPALAVRAS PROIBIDAS — NUNCA use: ' + cfg.proibidas.join(', ');
  }
  if (cfg.respostas && cfg.respostas.length > 0) {
    const rr = cfg.respostas.filter(function(r){return r.pergunta && r.resposta;}).map(function(r){return '- "' + r.pergunta + '" -> "' + r.resposta + '"';}).join('\n');
    if (rr) prompt += '\n\nRESPOSTAS RAPIDAS — use exatamente estas:\n' + rr;
  }
  if (cfg.horarioIni && cfg.horarioFim) {
    const hora = horaCliente !== null ? horaCliente : new Date(new Date().toLocaleString('en-US', {timeZone:'America/Sao_Paulo'})).getHours() * 60 + new Date(new Date().toLocaleString('en-US', {timeZone:'America/Sao_Paulo'})).getMinutes();
    const ini = parseInt(cfg.horarioIni.split(':')[0]) * 60 + parseInt(cfg.horarioIni.split(':')[1]);
    const fim = parseInt(cfg.horarioFim.split(':')[0]) * 60 + parseInt(cfg.horarioFim.split(':')[1]);
    if (hora < ini || hora > fim) {
      prompt += '\n\nFORA DO HORARIO: Informe ao cliente: "' + cfg.msgForaHorario + '"';
    }
  }
  return prompt;
}

// ── CHAT ──
app.get('/chat.js', (_, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
var H=[];
function am(t,c){
  var d=document.createElement('div');d.className=c;
  d.innerHTML=t.replace(/\\n/g,'<br>').replace(/\\*\\*(.*?)\\*\\*/g,'<b>$1</b>');
  var m=document.getElementById('msgs');m.appendChild(d);m.scrollTop=9999;return d;
}
function enviar(){
  var inp=document.getElementById('inp');
  var t=inp.value.trim();if(!t)return;inp.value='';
  am(t,'u');H.push({role:'user',content:t});
  var l=am('Ace está digitando...','l');
  var agora=new Date();var horaMin=agora.getHours()*60+agora.getMinutes();
  fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:H,horaCliente:horaMin})})
  .then(function(r){return r.json();})
  .then(function(d){l.remove();am(d.reply||'Erro, tente novamente.','b');H.push({role:'assistant',content:d.reply||''});})
  .catch(function(){l.remove();am('Erro de conexão.','b');});
}
document.getElementById('sb').onclick=enviar;
document.getElementById('inp').onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();enviar();}};
  `);
});

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
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
<div class="b">Olá! 👋 Sou o <b>Ace</b>, assistente da <b>Mais Acessível</b>. Somos o maior distribuidor de produtos para acessibilidade da região Centro Oeste e Norte do país!<br><br>Qual é o seu nome?</div>
</div>
<div id="ia">
<input id="inp" type="text" placeholder="Digite aqui...">
<button id="sb" type="button">&#10148;</button>
</div>
<script src="/chat.js"></script>
</body>
</html>`;

app.get('/', (_, res) => res.setHeader('Content-Type','text/html').send(HTML));

app.post('/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'invalid' });
  const token = getBlingToken();
  const useBling = token && token.length > 20;
  const horaCliente = req.body.horaCliente || null;
  const systemPrompt = await buildSystemPrompt(horaCliente);

  const buildBody = (t, withBling) => {
    const body = { model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: systemPrompt, messages };
    if (withBling) body.mcp_servers = [{ type: 'url', url: 'https://mcp.bling.com.br/mcp', name: 'bling', authorization_token: t }];
    return body;
  };
  const callAPI = async (body) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'mcp-client-2025-04-04' },
    body: JSON.stringify(body)
  });

  try {
    let resp = await callAPI(buildBody(token, useBling));
    let data = await resp.json();
    if (!resp.ok && JSON.stringify(data).includes('Authentication')) {
      const ok = await refreshBlingToken();
      resp = await callAPI(buildBody(ok ? getBlingToken() : null, ok));
      data = await resp.json();
      if (!resp.ok) { resp = await callAPI(buildBody(null, false)); data = await resp.json(); }
    }
    if (!resp.ok) return res.status(resp.status).json({ error: data });
    const txt = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');

    // Captura de lead no Firebase
    const cfg = await fbGet('ace_config') || DEFAULT_CONFIG;
    if (cfg.capturaLeads && messages.length >= 3) {
      const conv = messages.map(m => m.content).join(' ');
      const wppMatch = conv.match(/\b(?:55)?\s*\(?\d{2}\)?\s*9?\d{4}[\s\-]?\d{4}\b/);
      if (wppMatch) {
        const leads = await fbGet('ace_leads') || [];
        const arr = Array.isArray(leads) ? leads : Object.values(leads);
        if (!arr.some(l => l.whatsapp === wppMatch[0])) {
          arr.unshift({ nome: messages[0].content.substring(0,40), whatsapp: wppMatch[0], interesse: 'chat site', data: new Date().toLocaleString('pt-BR') });
          await fbSet('ace_leads', arr.slice(0,500));
        }
      }
    }
    return res.json({ reply: txt });
  } catch(e) { return res.status(500).json({ error: 'Erro: ' + e.message }); }
});

app.get('/ping', (_, res) => res.json({ status: 'ok', ts: Date.now(), firebase: FIREBASE_URL }));
app.listen(PORT, () => console.log('Ace rodando porta ' + PORT));
