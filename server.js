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

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json());

// ── FIREBASE ──
async function fbGet(path) {
  try { const r = await fetch(`${FIREBASE_URL}/${path}.json`); return await r.json(); } catch(e) { return null; }
}
async function fbSet(path, data) {
  try { await fetch(`${FIREBASE_URL}/${path}.json`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) }); return true; } catch(e) { return false; }
}

// ── BLING TOKEN ──
let _tokenCache = null;
async function saveToken(access, refresh) {
  _tokenCache = { access_token: access, refresh_token: refresh, ts: Date.now() };
  await fbSet('bling_token', _tokenCache);
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(_tokenCache)); } catch(e) {}
}
async function loadToken() {
  if (_tokenCache && _tokenCache.access_token) return _tokenCache;
  try { const local = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); if (local?.access_token) { _tokenCache = local; return local; } } catch(e) {}
  try { const fb = await fbGet('bling_token'); if (fb?.access_token) { _tokenCache = fb; return fb; } } catch(e) {}
  return null;
}
async function getBlingToken() {
  const d = await loadToken();
  return (d?.access_token) || '';
}
async function refreshBlingToken() {
  const d = await loadToken();
  if (!d?.refresh_token) return false;
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

// ── BLING API DIRETA ──
async function blingCadastrarContato(dados) {
  let token = await getBlingToken();
  if (!token) return { ok: false, erro: 'Token não disponível' };

  const body = {
    nome: dados.nome,
    tipo: dados.tipo === 'PJ' ? 'J' : 'F',
    email: dados.email || '',
    telefone: dados.telefone || '',
    celular: dados.celular || dados.telefone || '',
    cpfCnpj: dados.cpfCnpj || '',
    cep: dados.cep || '',
    situacao: 'A'
  };

  const chamar = async (tk) => fetch('https://www.bling.com.br/Api/v3/contatos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
    body: JSON.stringify(body)
  });

  let resp = await chamar(token);
  // Se token expirou, renovar e tentar de novo
  if (resp.status === 401) {
    const ok = await refreshBlingToken();
    if (ok) { token = await getBlingToken(); resp = await chamar(token); }
  }

  const json = await resp.json();
  if (resp.ok && json?.data?.id) {
    return { ok: true, id: json.data.id, dados: json.data };
  }
  return { ok: false, erro: JSON.stringify(json).substring(0, 200) };
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

// ── CONFIG E LEADS ──
const DEFAULT_CONFIG = {
  tom: 'amigavel', whatsapp: '556235173971', site: 'maisacessivel.com.br',
  endereco: 'Goiânia, GO', horarioIni: '08:00', horarioFim: '18:00',
  msgForaHorario: 'Nosso horário é seg-sex 8h às 18h. Deixe nome e WhatsApp que retornamos em breve!',
  proibidas: [], respostas: [], capturaLeads: true
};
app.get('/config', async (_, res) => res.json(await fbGet('ace_config') || DEFAULT_CONFIG));
app.post('/config', async (req, res) => {
  const atual = await fbGet('ace_config') || DEFAULT_CONFIG;
  await fbSet('ace_config', Object.assign({}, atual, req.body));
  res.json({ ok: true });
});
app.get('/leads', async (_, res) => {
  const leads = await fbGet('ace_leads') || [];
  res.json(Array.isArray(leads) ? leads : Object.values(leads));
});

// ── CONFIGURAR COM IA ──
app.post('/configurar', async (req, res) => {
  const { messages, configAtual } = req.body;
  if (!messages) return res.status(400).json({ error: 'invalid' });
  try {
    const systemPrompt = `Você é um assistente especializado em configurar o chatbot "Ace" da Mais Acessível.
O usuário vai dizer o que quer que o Ace faça. Você deve entender e atualizar as configurações.
Configuração atual: ${JSON.stringify(configAtual||{})}.
Responda em português. No final inclua: <CONFIG>{"instrucoes":"...","tom":"...","proibidas":[...],"respostas":[...]}</CONFIG>`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, system: systemPrompt, messages })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    const reply = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    const configMatch = reply.match(/<CONFIG>([\s\S]*?)<\/CONFIG>/);
    let configAtualizada = false;
    if (configMatch) {
      try {
        const nova = JSON.parse(configMatch[1]);
        const atual = await fbGet('ace_config') || DEFAULT_CONFIG;
        await fbSet('ace_config', Object.assign({}, atual, nova));
        configAtualizada = true;
      } catch(e) {}
    }
    res.json({ reply: reply.replace(/<CONFIG>[\s\S]*?<\/CONFIG>/, '').trim(), configAtualizada });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SYSTEM PROMPT ──
async function buildSystemPrompt(horaCliente) {
  const cfg = await fbGet('ace_config') || DEFAULT_CONFIG;
  const h = horaCliente !== null && horaCliente !== undefined ? Math.floor(horaCliente/60) :
    new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'})).getHours();
  const saudacao = h >= 6 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';

  let prompt = (cfg.instrucoes || 'Você é o Ace, assistente virtual da Mais Acessível. Responda em português brasileiro.');
  prompt += `\n\nHorário atual: ${h}h. Saudação correta: "${saudacao}".`;
  prompt += `\nDados: WhatsApp ${cfg.whatsapp||'(62) 3517-3971'}, Site: ${cfg.site||'maisacessivel.com.br'}, Endereço: ${cfg.endereco||'Goiânia, GO'}.`;

  if (cfg.proibidas?.length > 0) prompt += `\nPALAVRAS PROIBIDAS: ${cfg.proibidas.join(', ')}`;
  if (cfg.respostas?.length > 0) {
    const rr = cfg.respostas.filter(r=>r.pergunta&&r.resposta).map(r=>`"${r.pergunta}" → "${r.resposta}"`).join('; ');
    if (rr) prompt += `\nRESPOSTAS RÁPIDAS: ${rr}`;
  }

  // Instrucao de cadastro via endpoint /cadastrar
  prompt += `\n\nCRÍTICO — CADASTRO:
Quando tiver coletado nome, CPF/CNPJ e telefone do cliente, você DEVE encerrar sua resposta com exatamente este bloco JSON (sem markdown):
<CADASTRAR>{"nome":"...","tipo":"PF ou PJ","cpfCnpj":"...","telefone":"...","cep":"...","email":"..."}</CADASTRAR>
O sistema vai cadastrar automaticamente e te informar o resultado. Aguarde a confirmação antes de dizer que o cadastro foi feito.`;

  if (cfg.horarioIni && cfg.horarioFim) {
    const ini = parseInt(cfg.horarioIni)*60+parseInt(cfg.horarioIni.split(':')[1]);
    const fim = parseInt(cfg.horarioFim)*60+parseInt(cfg.horarioFim.split(':')[1]);
    if (h*60 < ini || h*60 > fim) prompt += `\nFORA DO HORÁRIO: "${cfg.msgForaHorario}"`;
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
  var horaMin=new Date().getHours()*60+new Date().getMinutes();
  fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:H,horaCliente:horaMin})})
  .then(function(r){return r.json();})
  .then(function(d){
    l.remove();
    var rep=d.reply||'Erro, tente novamente.';
    am(rep,'b');
    H.push({role:'assistant',content:rep});
    if(d.cadastro){
      var status=document.createElement('div');
      status.style.cssText='background:'+(d.cadastro.ok?'#d1fae5':'#fee2e2')+';color:'+(d.cadastro.ok?'#065f46':'#dc2626')+';padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;margin-top:4px;max-width:82%;align-self:flex-start';
      status.textContent=d.cadastro.ok?'✅ Cadastrado no Bling! ID: '+d.cadastro.id:'❌ Erro no cadastro: '+d.cadastro.erro;
      document.getElementById('msgs').appendChild(status);
      document.getElementById('msgs').scrollTop=9999;
    }
  })
  .catch(function(){l.remove();am('Erro de conexão.','b');});
}
document.getElementById('sb').onclick=enviar;
document.getElementById('inp').onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();enviar();}};

// Carregar mensagem inicial
(function(){
  var horaMin=new Date().getHours()*60+new Date().getMinutes();
  fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'__INIT__'}],horaCliente:horaMin,init:true})})
  .then(function(r){return r.json();})
  .then(function(d){var el=document.getElementById('msg-inicial');if(el&&d.reply)el.innerHTML=d.reply.replace(/\\n/g,'<br>').replace(/\\*\\*(.*?)\\*\\*/g,'<b>$1</b>');})
  .catch(function(){var el=document.getElementById('msg-inicial');if(el)el.innerHTML='Olá! Como posso ajudar?';});
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
#msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px}
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
<div id="msgs"><div class="b" id="msg-inicial">...</div></div>
<div id="ia">
<input id="inp" type="text" placeholder="Digite aqui...">
<button id="sb" type="button">&#10148;</button>
</div>
<script src="/chat.js"></script>
</body>
</html>`;

app.get('/', (_, res) => res.setHeader('Content-Type','text/html').send(HTML));

app.post('/chat', async (req, res) => {
  const { messages, horaCliente, init } = req.body;
  if (!messages) return res.status(400).json({ error: 'invalid' });

  const systemPrompt = await buildSystemPrompt(horaCliente);

  // Mensagem inicial
  if (init && messages[0]?.content === '__INIT__') {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: systemPrompt, messages: [{role:'user',content:'Inicie o atendimento com a mensagem de abertura.'}] })
      });
      const data = await r.json();
      const txt = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
      return res.json({ reply: txt });
    } catch(e) { return res.json({ reply: 'Olá! Como posso ajudar?' }); }
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: systemPrompt, messages })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });

    const txt = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');

    // Detectar bloco de cadastro — suporta <CADASTRAR> e <tool_call>
    let cadastroMatch = txt.match(/<CADASTRAR>([\s\S]*?)<\/CADASTRAR>/);
    let toolCallMatch = txt.match(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/);
    let cadastroResult = null;
    let replyLimpo = txt
      .replace(/<CADASTRAR>[\s\S]*?<\/CADASTRAR>/, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/, '')
      .trim();

    let dadosCadastro = null;
    if (cadastroMatch) {
      try { dadosCadastro = JSON.parse(cadastroMatch[1]); } catch(e) {}
    } else if (toolCallMatch) {
      try {
        const args = JSON.parse(toolCallMatch[1]);
        dadosCadastro = {
          nome: args.nome || args.nomeContato || '',
          tipo: args.tipoPessoa === 'J' ? 'PJ' : 'PF',
          cpfCnpj: args.cpf || args.cnpj || args.cpfCnpj || '',
          telefone: args.celular || args.telefone || '',
          cep: args.cep || '',
          email: args.email || ''
        };
      } catch(e) {}
    }

    if (dadosCadastro && dadosCadastro.nome) {
      try {
        cadastroResult = await blingCadastrarContato(dadosCadastro);
        if (cadastroResult.ok) {
          const leads = await fbGet('ace_leads') || [];
          const arr = Array.isArray(leads) ? leads : Object.values(leads);
          arr.unshift({ ...dadosCadastro, blingId: cadastroResult.id, data: new Date().toLocaleString('pt-BR') });
          await fbSet('ace_leads', arr.slice(0,500));
        }
      } catch(e) { cadastroResult = { ok: false, erro: e.message }; }
    }

    return res.json({ reply: replyLimpo, cadastro: cadastroResult });
  } catch(e) { return res.status(500).json({ error: e.message }); }
});

// Auto-ping para nao dormir
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://maisacessivel-chatbot.onrender.com';
setInterval(async () => {
  try { await fetch(SELF_URL + '/ping'); } catch(e) {}
}, 10 * 60 * 1000);

app.get('/ping', (_, res) => res.json({ status: 'ok', ts: Date.now() }));
app.listen(PORT, () => console.log('Ace rodando porta ' + PORT));
