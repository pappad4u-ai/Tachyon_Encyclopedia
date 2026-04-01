console.log("LOADING THE CURRENT SERVER.JS FILE");
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const BC_STORE_URL = (process.env.BC_STORE_URL || "").trim();
const BC_API_URL = (process.env.BC_API_URL || "").trim();
const BC_ACCESS_TOKEN = (process.env.BC_ACCESS_TOKEN || "").trim();

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

if (!BC_API_URL) {
  console.error("Missing BC_API_URL in .env");
  process.exit(1);
}

if (!BC_ACCESS_TOKEN) {
  console.error("Missing BC_ACCESS_TOKEN in .env");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const BC_HEADERS = {
  "X-Auth-Token": BC_ACCESS_TOKEN,
  Accept: "application/json",
  "Content-Type": "application/json",
};

console.log("BC token first 6:", BC_ACCESS_TOKEN.slice(0, 6));
console.log("BC token length:", BC_ACCESS_TOKEN.length);
console.log("BC API URL:", BC_API_URL);

async function searchBigCommerce(query) {
  const url = `${BC_API_URL}/catalog/products`;
  const response = await axios.get(url, {
    headers: BC_HEADERS,
    params: {
      keyword: query,
      is_visible: true,
      limit: 5,
    },
  });

  return response?.data?.data || [];
}

function simplifyProducts(products) {
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    calculated_price: p.calculated_price,
    sku: p.sku,
    custom_url: p.custom_url?.url || "",
    brand_name: p.brand_name || "",
  }));
}

app.get("/", (req, res) => {
  res.send("Tachyon chat middleware is running.");
});

app.get("/bc-test", async (req, res) => {
  try {
    const response = await axios.get(`${BC_API_URL}/catalog/products?limit=1`, {
      headers: BC_HEADERS,
    });

    res.json({
      ok: true,
      count: response?.data?.data?.length || 0,
      firstProduct: response?.data?.data?.[0]?.name || null,
    });
  } catch (error) {
    res.status(error?.response?.status || 500).json({
      ok: false,
      details: error?.response?.data || error.message,
    });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body?.message;

    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({
        error: 'Request body must include a string field named "message".',
      });
    }

    const products = await searchBigCommerce(userMessage);
    const cleanProducts = simplifyProducts(products);

    const productText =
      cleanProducts.length > 0
        ? cleanProducts
            .map((p, index) => {
              const price = p.calculated_price ?? p.price ?? "N/A";
              const url = p.custom_url ? `${BC_STORE_URL}${p.custom_url}` : "";

              return [
                `${index + 1}. ${p.name}`,
                `Price: ${price}`,
                p.brand_name ? `Brand: ${p.brand_name}` : "",
                p.sku ? `SKU: ${p.sku}` : "",
                url ? `URL: ${url}` : "",
              ]
                .filter(Boolean)
                .join("\n");
            })
            .join("\n\n")
        : "No matching products were found in BigCommerce.";

    const prompt = `
You are a store assistant for a tachyon product shop.

Customer message:
${userMessage}

Matched products:
${productText}

Instructions:
- Answer clearly and helpfully.
- If products were found, recommend the most relevant ones.
- Mention product names exactly as provided.
- Do not invent products.
- If no products were found, say that clearly and invite a narrower search.
- Keep the answer concise and friendly.
`.trim();

    const aiResponse = await openai.responses.create({
      model: OPENAI_MODEL,
      input: prompt,
    });

    const reply =
      aiResponse.output_text ||
      "I found some products, but I could not format a response.";

    return res.json({
      reply,
      products: cleanProducts,
    });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || error.message || "Unknown error";

    console.error("CHAT ERROR:", details);

    return res.status(status).json({
      error: "Something went wrong.",
      details,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});