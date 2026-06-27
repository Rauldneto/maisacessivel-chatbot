const express = require('express');
const cors = require('cors');
// fetch nativo do Node 18
const fs = require('fs');

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
// Cache em memoria (rapido) + Firebase (persistente)
let _tokenCache = null;

async function saveToken(access, refresh) {
  _tokenCache = { access_token: access, refresh_token: refresh, ts: Date.now() };
  // Salvar no Firebase para persistir apos reinicializacao
  await fbSet('bling_token', _tokenCache);
  // Salvar em arquivo como backup local
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(_tokenCache)); } catch(e) {}
}

async function loadToken() {
  // 1. Tentar cache em memoria
  if (_tokenCache && _tokenCache.access_token) return _tokenCache;
  // 2. Tentar arquivo local
  try {
    const local = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (local && local.access_token) { _tokenCache = local; return local; }
  } catch(e) {}
  // 3. Tentar Firebase
  try {
    const fb = await fbGet('bling_token');
    if (fb && fb.access_token) { _tokenCache = fb; return fb; }
  } catch(e) {}
  return null;
}

async function getBlingToken() {
  const d = await loadToken();
  return (d && d.access_token) || process.env.BLING_MCP_TOKEN || '';
}
async function refreshBlingToken() {
  const d = await loadToken();
  if (!d || !d.refresh_token) return false;
  try {
    const cr = Buffer.from(BLING_CLIENT_ID + ':' + BLING_CLIENT_SECRET).toString('base64');
    const r = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + cr },
      body: 'grant_type=refresh_token&refresh_token=' + d.refresh_token
    });
    const j = await r.json();
    if (j.access_token) { await saveToken(j.access_token, j.refresh_token || d.refresh_token); return true; }
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
      await saveToken(j.access_token, j.refresh_token || '');
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

  // Calcular hora atual em Brasilia
  const horaAtual = horaCliente !== null ? horaCliente : 
    (() => { const n = new Date(new Date().toLocaleString('en-US', {timeZone:'America/Sao_Paulo'})); return n.getHours()*60+n.getMinutes(); })();
  const h = Math.floor(horaAtual/60);
  const saudacao = h >= 6 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';

  // APENAS instrucoes do administrador — sem texto fixo
  let prompt = (cfg.instrucoes || 'Voce e um assistente virtual. Responda em portugues brasileiro.');
  
  // Informar a hora para o Claude usar corretamente
  prompt += '\n\nINFORMAÇÃO DE HORA: Agora são ' + h + 'h (horário de Brasília). A saudação correta agora é "' + saudacao + '". Use isso ao cumprimentar.';

  // Dados complementares
  prompt += '\n\nDados da empresa: WhatsApp ' + (cfg.whatsapp||'(62) 3517-3971') + ', Site: ' + (cfg.site||'maisacessivel.com.br') + ', Endereco: ' + (cfg.endereco||'Goiania, GO') + '.';

  // Instrucao obrigatoria de usar Bling — SEMPRE
  prompt += '\n\nREGRA OBRIGATÓRIA DE CADASTRO:\n' +
    '- Quando tiver coletado nome, CPF/CNPJ e telefone do cliente, você DEVE usar a ferramenta do Bling para cadastrar o contato.\n' +
    '- Use a ferramenta createContact do Bling com os dados coletados.\n' +
    '- Somente após a ferramenta confirmar o cadastro (sucesso ou erro), informe o cliente do resultado.\n' +
    '- NUNCA diga que cadastrou sem ter usado a ferramenta. Se a ferramenta falhar, informe o cliente e peça para tentar novamente.\n' +
    '- Após cadastro confirmado, encaminhe para a equipe de vendas pelo WhatsApp ' + (cfg.whatsapp||'(62) 3517-3971') + '.';

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

// Carregar mensagem inicial com hora correta
(function(){
  var horaMin=new Date().getHours()*60+new Date().getMinutes();
  fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'__INIT__'}],horaCliente:horaMin,init:true})})
  .then(function(r){return r.json();})
  .then(function(d){
    var el=document.getElementById('msg-inicial');
    if(el&&d.reply) el.innerHTML=d.reply.replace(/\\n/g,'<br>').replace(/\\*\\*(.*?)\\*\\*/g,'<b>$1</b>');
  })
  .catch(function(){
    var el=document.getElementById('msg-inicial');
    if(el) el.innerHTML='Olá! Como posso ajudar?';
  });
})();
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
<div class="b" id="msg-inicial">...</div>
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
  // Mensagem inicial — Ace gera com hora correta seguindo instrucoes
  if (req.body.init && messages.length === 1 && messages[0].content === '__INIT__') {
    const horaCliente = req.body.horaCliente || 0;
    const systemPrompt = await buildSystemPrompt(horaCliente);
    const initMessages = [{role: 'user', content: 'Inicie o atendimento agora com a mensagem de abertura.'}];
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:'claude-haiku-4-5-20251001', max_tokens:300, system: systemPrompt, messages: initMessages})
    });
    const data = await resp.json();
    const txt = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    return res.json({ reply: txt });
  }
  if (!messages) return res.status(400).json({ error: 'invalid' });
  const token = await getBlingToken();
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

// Rota para configurar o Ace via IA
app.post('/configurar', async (req, res) => {
  const { messages, configAtual } = req.body;
  if (!messages) return res.status(400).json({ error: 'invalid' });
  try {
    const systemPrompt = `Você é um assistente especializado em configurar o chatbot "Ace" da Mais Acessível.
O usuário vai te dizer em linguagem natural o que quer que o Ace faça.
Você deve: 1) Entender o pedido, 2) Atualizar as instruções adequadamente, 3) Explicar o que foi alterado de forma clara e resumida.
A configuração atual do Ace é: ${JSON.stringify(configAtual||{}, null, 2)}.
Responda SEMPRE em português brasileiro de forma amigável.
Ao final da sua resposta, inclua as configurações ATUALIZADAS no formato: <CONFIG>${'{'}"instrucoes":"...","tom":"...","proibidas":[...],"respostas":[...]${'}'}</CONFIG>.
Inclua TODAS as configurações no JSON, não apenas as alteradas.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, system: systemPrompt, messages })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data });
    const reply = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');

    // Extrair e salvar config automaticamente
    const configMatch = reply.match(/<CONFIG>([\s\S]*?)<\/CONFIG>/);
    let novaConfig = null;
    if (configMatch) {
      try {
        novaConfig = JSON.parse(configMatch[1]);
        const atual = await fbGet('ace_config') || {};
        await fbSet('ace_config', Object.assign({}, atual, novaConfig));
      } catch(e) {}
    }
    const textoLimpo = reply.replace(/<CONFIG>[\s\S]*?<\/CONFIG>/, '').trim();
    return res.json({ reply: textoLimpo, configAtualizada: !!novaConfig });
  } catch(e) { return res.status(500).json({ error: 'Erro: ' + e.message }); }
});

app.get('/ping', (_, res) => res.json({ status: 'ok', ts: Date.now(), firebase: FIREBASE_URL }));

// Auto-ping a cada 10 minutos para nao dormir no Render free tier
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://maisacessivel-chatbot.onrender.com';
setInterval(async () => {
  try {
    await fetch(SELF_URL + '/ping');
    console.log('Auto-ping OK:', new Date().toLocaleString('pt-BR'));
  } catch(e) {
    console.log('Auto-ping falhou:', e.message);
  }
}, 10 * 60 * 1000);

if (require.main === module) {
  app.listen(PORT, () => console.log('Ace rodando porta ' + PORT));
}

module.exports = app;
