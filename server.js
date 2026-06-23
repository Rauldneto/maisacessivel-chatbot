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
    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    // Extrai texto e ID de contato Bling se criado
    let blingContactId = null;
    const textBlocks = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    for (const block of (data.content || [])) {
      if (block.type === "mcp_tool_result") {
        try {
          const parsed = JSON.parse(block.content?.[0]?.text || "");
          if (parsed?.data?.id) { blingContactId = parsed.data.id; break; }
        } catch {}
      }
    }

    const toolsUsed = (data.content || []).filter(b => b.type === "mcp_tool_use").map(b => b.name);
    return res.json({ reply: textBlocks, blingContactId, toolsUsed, stop_reason: data.stop_reason });
  } catch (err) {
    return res.status(500).json({ error: "Erro interno do servidor." });
  }
});

app.get("/ping", (_req, res) => res.json({ status: "ok", ts: Date.now() }));
app.listen(PORT, () => console.log(`✅ Ace backend rodando na porta ${PORT}`));
