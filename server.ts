import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Zabbix Proxy API
  app.post("/api/zabbix", async (req, res) => {
    const { method, params } = req.body;
    
    const zabbixUrl = process.env.ZABBIX_URL;
    const zabbixToken = process.env.ZABBIX_API_TOKEN;

    if (!zabbixUrl || !zabbixToken) {
      return res.status(500).json({ 
        error: "Zabbix configuration is missing in environment variables (ZABBIX_URL or ZABBIX_API_TOKEN)." 
      });
    }

    try {
      // Ensure the URL is clean and has a protocol
      let baseUrl = zabbixUrl.trim();
      if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
        baseUrl = "https://" + baseUrl;
      }

      // Check if the user already provided the endpoint
      let targetUrl = baseUrl;
      if (!targetUrl.toLowerCase().endsWith("api_jsonrpc.php")) {
        targetUrl = targetUrl.replace(/\/$/, "") + "/api_jsonrpc.php";
      }

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json-rpc",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method,
          params: {
            ...params,
          },
          auth: zabbixToken,
          id: Date.now(),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          error: `Zabbix Server returned HTTP ${response.status}`,
          details: errorText
        });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Zabbix API Error:", error);
      res.status(500).json({ 
        error: "Erro de conexão com o servidor Zabbix.",
        details: error.message,
        cause: error.cause?.message || error.code || "Conexão recusada ou DNS não resolvido."
      });
    }
  });

  // Get current config (masked)
  app.get("/api/config", (req, res) => {
    res.json({
      hasZabbixUrl: !!process.env.ZABBIX_URL,
      hasZabbixToken: !!process.env.ZABBIX_API_TOKEN,
      hostName: process.env.ZABBIX_HOST_NAME || "Not Set",
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
