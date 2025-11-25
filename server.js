const express = require("express");
const multer = require("multer");
require("dotenv").config();
const OpenAI = require("openai");
const fs = require("fs");

const app = express();
const upload = multer({ dest: "uploads/" });

// Verifica se a chave da API está configurada
if (!process.env.OPENAI_API_KEY) {
  console.error("ERRO: OPENAI_API_KEY não encontrada no arquivo .env");
  console.error("Por favor, crie um arquivo .env com: OPENAI_API_KEY=sua_chave_aqui");
} else {
  console.log("✓ Chave da API OpenAI carregada com sucesso");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.static("."));
app.use("/imagens", express.static("imagens"));

app.post("/identificar", upload.single("imagem"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ erro: "Nenhuma imagem enviada." });
    }

    const imgPath = req.file.path;
    console.log("Imagem recebida:", req.file.originalname, "Tipo:", req.file.mimetype);

    const imageBuffer = fs.readFileSync(imgPath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";

    const prompt = `
Você é um botânico especialista. Analise a imagem e, se for realmente uma planta, retorne APENAS um JSON válido,
sem markdown, comentários ou qualquer texto fora do JSON, seguindo rigorosamente a estrutura:
{
  "nome": "Nome científico completo (gênero + espécie) + um nome popular",
  "confianca": 0.0,
  "caracteristicas": [
    "característica 1 (máx. 3 linhas)",
    "característica 2 (máx. 3 linhas)",
    "característica 3 (máx. 3 linhas)"
  ],
  "localidade": "Regiões ou países onde ocorre naturalmente",
  "ambiente": "Tipo de ambiente natural (ex.: floresta úmida, cerrado, campo rupestre)",
  "cultivo": "Resumo rápido de como cultivar (máx. 2 linhas)",
  "manejo": "Práticas essenciais de manejo (máx. 2 linhas)",
  "rega": "Frequência aproximada em dias (ex.: regar a cada 2 dias)",
  "sol": "Preferência de luz (pleno sol, meia-sombra ou sombra)",
  "clima": "Clima ideal (temperatura, umidade, estação) em até 3 linhas"
}
REGRAS OBRIGATÓRIAS:
1) 'confianca' deve ser um número entre 0 e 1 (ex.: 0.87 = 87%). Nunca deixe esse campo vazio.
2) É PROIBIDO escrever termos como "não informado", "desconhecido", "indisponível" ou equivalentes. Caso não tenha certeza, use o seu conhecimento botânico para estimar a resposta mais provável.
3) Todos os campos devem conter texto objetivo e específico (sem respostas vagas ou genéricas).
4) Características devem descrever aspectos visuais, anatômicos ou ecológicos; máximo 3 itens.
5) O campo 'rega' precisa mencionar explicitamente o intervalo em dias.
6) Retorne apenas o JSON puro, sem explicações adicionais.
7) Caso a imagem NÃO seja de uma planta, responda exatamente com o texto "NAO_PLANTA" (sem JSON).
    `;

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Image}` }
            }
          ]
        }
      ],
      max_tokens: 800
    });

    fs.unlinkSync(imgPath);

    const conteudoBruto = response.choices?.[0]?.message?.content;
    if (!conteudoBruto) {
      throw new Error("Resposta inválida da IA. Conteúdo vazio.");
    }

    let respostaTexto = "";
    if (typeof conteudoBruto === "string") {
      respostaTexto = conteudoBruto.trim();
    } else if (Array.isArray(conteudoBruto)) {
      respostaTexto = conteudoBruto
        .map((parte) => parte.text || parte)
        .join(" ")
        .trim();
    } else if (typeof conteudoBruto === "object" && conteudoBruto.text) {
      respostaTexto = String(conteudoBruto.text).trim();
    }

    if (!respostaTexto) {
      throw new Error("Resposta inválida da IA. Sem texto utilizável.");
    }
    console.log("Resposta completa da IA:", respostaTexto.substring(0, 500) + "...");

    const textoMinusculo = respostaTexto.toLowerCase();
    if (
      respostaTexto.includes("NAO_PLANTA") ||
      textoMinusculo.includes("não é uma planta") ||
      textoMinusculo.includes("não parece ser uma planta") ||
      textoMinusculo.includes("não consigo identificar") ||
      textoMinusculo.includes("não consigo ajudar") ||
      textoMinusculo.includes("não é possível identificar")
    ) {
      return res.json({
        erro: "A imagem enviada não parece conter uma planta. Tente outra foto."
      });
    }

    let dadosPlanta;
    try {
      const jsonMatch = respostaTexto.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("JSON não encontrado");

      dadosPlanta = JSON.parse(jsonMatch[0]);
      console.log("JSON parseado com sucesso. Características:", dadosPlanta.caracteristicas?.length || 0);

      const camposObrigatorios = [
        "nome",
        "confianca",
        "localidade",
        "ambiente",
        "cultivo",
        "manejo",
        "rega",
        "sol",
        "clima"
      ];

      const palavrasProibidas = [
        "não informado",
        "nao informado",
        "desconhecido",
        "indisponível",
        "indisponivel",
        "sem informação",
        "sem informacao",
        "não disponível",
        "nao disponivel"
      ];

      const ehStringInvalida = (texto = "") => {
        if (typeof texto !== "string") return false;
        const normalizado = texto.trim().toLowerCase();
        if (!normalizado) return true;
        return palavrasProibidas.some((palavra) => normalizado.includes(palavra));
      };

    const buscarDetalhesPorNome = async (nome) => {
        const promptTexto = `
Com base em seu conhecimento botânico sobre "${nome}", forneça APENAS um JSON válido com os campos:
{
  "localidade": "Regiões ou países onde ocorre naturalmente",
  "ambiente": "Tipo de ambiente natural (ex.: floresta úmida, cerrado, campo rupestre, restinga etc.)",
  "cultivo": "Resumo rápido de cultivo (máx. 2 linhas)",
  "manejo": "Boas práticas de manejo (máx. 2 linhas)",
  "rega": "Frequência aproximada em dias (ex.: regar a cada 3 dias)",
  "sol": "Preferência de luz (pleno sol, meia-sombra ou sombra)",
  "clima": "Clima ideal (temperatura, umidade e estações favoráveis) em até 3 linhas"
}
Regras:
- Nunca use frases como "não informado", "desconhecido" ou equivalentes.
- Se não houver dados exatos, forneça a estimativa mais plausível baseada no gênero/espécie.
- Seja específico e objetivo.
        `;

        const resposta = await client.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: promptTexto }]
            }
          ],
          max_tokens: 600
        });

        const texto = resposta.choices?.[0]?.message?.content?.trim() || "";
        const jsonMatch = texto.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        return JSON.parse(jsonMatch[0]);
      };

      const validarCampos = (dados) => {
        const faltando = [];
        camposObrigatorios.forEach((campo) => {
          const valor = dados[campo];
          if (valor === undefined || valor === null) return faltando.push(campo);
          if (campo === "confianca") {
            const numero = Number(valor);
            if (Number.isNaN(numero) || numero < 0 || numero > 1) faltando.push(campo);
            return;
          }
          if (typeof valor === "string") {
            if (!valor.trim() || ehStringInvalida(valor)) faltando.push(campo);
          }
        });

        if (
          !Array.isArray(dados.caracteristicas) ||
          dados.caracteristicas.length < 3 ||
          dados.caracteristicas.some(
            (car) => typeof car !== "string" || !car.trim() || ehStringInvalida(car)
          )
        ) {
          faltando.push("caracteristicas");
        }

        return { ok: faltando.length === 0, faltando };
      };

      let validacao = validarCampos(dadosPlanta);

      if (!validacao.ok) {
        return res.json({
          erro: "A IA não conseguiu retornar todas as informações necessárias. Tente enviar outra imagem."
        });
      }
    } catch (parseError) {
      console.error("Erro ao parsear JSON:", parseError);
      console.error("Resposta que causou erro:", respostaTexto);
      return res.json({
        erro: "Não foi possível interpretar a resposta da IA. Tente novamente."
      });
    }

    // Normaliza campos
    const limparTexto = (valor) => (typeof valor === "string" ? valor.trim() : valor);

    const resultado = {
      nome: limparTexto(dadosPlanta.nome) || "Planta identificada",
      confianca: Math.min(Math.max(Number(dadosPlanta.confianca) || 0, 0), 1),
      caracteristicas: (dadosPlanta.caracteristicas || [])
        .slice(0, 3)
        .map((texto) => limparTexto(texto) || "Informação indisponível"),
      localidade: limparTexto(dadosPlanta.localidade) || "Informação indisponível",
      ambiente: limparTexto(dadosPlanta.ambiente) || "Informação indisponível",
      cultivo: limparTexto(dadosPlanta.cultivo) || "Informação indisponível",
      manejo: limparTexto(dadosPlanta.manejo) || "Informação indisponível",
      rega: limparTexto(dadosPlanta.rega) || "Informação indisponível",
      sol: limparTexto(dadosPlanta.sol) || "Informação indisponível",
      clima: limparTexto(dadosPlanta.clima) || "Informação indisponível"
    };

    if (resultado.confianca < 0.35) {
      return res.json({
        erro: "A imagem enviada não parece conter uma planta reconhecida. Tente outra foto mais clara."
      });
    }

    res.json({ resultado });
  } catch (err) {
    console.error("ERRO AO ANALISAR:");
    console.error("Mensagem:", err.message);
    console.error("Status:", err.status);
    console.error("Código:", err.code);
    if (err.response) {
      console.error("Response data:", err.response.data);
      console.error("Response status:", err.response.status);
    }
    if (err.error) {
      console.error("Error object:", err.error);
    }

    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {
        console.error("Erro ao remover arquivo temporário:", unlinkErr);
      }
    }

    let mensagemErro = "Erro ao analisar imagem.";
    if (err.status === 401 || err.message?.includes("401")) {
      mensagemErro = "Erro de autenticação. Verifique se sua chave da API OpenAI está correta no arquivo .env";
    } else if (err.status === 429 || err.message?.includes("429")) {
      mensagemErro = "Limite de requisições excedido. Tente novamente mais tarde.";
    } else if (err.message) {
      mensagemErro = `Erro: ${err.message}`;
    }

    res.json({ erro: mensagemErro });
  }
});

app.listen(3000, () =>
  console.log("Servidor rodando em http://localhost:3000")
);
