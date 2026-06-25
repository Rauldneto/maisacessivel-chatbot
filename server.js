import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json());

const SYSTEM_PROMPT = 'Voce eh o Ace, assistente virtual da Mais Acessivel (maisacessivel.com.br), distribuidora de produtos de acessibilidade ha 6 anos em Goiania-GO. PRODUTOS: barras de apoio, piso tatil, placas Braille, alarmes PCD, sanitarios adaptados. Colete nome e contato do cliente. Responda sempre em portugues brasileiro.';

// Servir o JS do chatbot como arquivo separado
app.get('/chat.js', (_, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
var H=[];
function am(t,c){
  var d=document.createElement('div');
  d.className=c;
  d.innerHTML=t.replace(/\\n/g,'<br>');
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
  var l=am('Ace esta digitando...','l');
  fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:H})})
  .then(function(r){return r.json();})
  .then(function(d){
    l.remove();
    am(d.reply||'Erro, tente novamente.','b');
    H.push({role:'assistant',content:d.reply||''});
  })
  .catch(function(){
    l.remove();
    am('Erro de conexao.','b');
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
<title>Ace - Mais Acessivel</title>
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
<div><h3 style="font-size:15px">Ace</h3><p style="font-size:11px;color:#a0b4cc">Assistente da Mais Acessivel</p></div>
</div>
<div id="bn">&#128295; Versao em teste</div>
<div id="msgs">
<div class="b">Ola! Sou o <b>Ace</b>, assistente da <b>Mais Acessivel</b>. Posso ajudar com barras de apoio, piso tatil, Braille e mais!<br><br>Qual e o seu nome?</div>
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
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data });
    const txt = (data.content || [])
      .filter(function(b){ return b.type === 'text'; })
      .map(function(b){ return b.text; })
      .join('\n');
    return res.json({ reply: txt });
  } catch (e) {
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/ping', (_, res) => res.json({ status: 'ok', ts: Date.now() }));
app.listen(PORT, () => console.log('Ace rodando porta ' + PORT));
