import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fs from "fs/promises";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(process.cwd(), "database.json");

async function startServer() {
  const app = express();
  
  const PORT = 3000;

  app.use(express.json());

  // Garante que o database.json existe e é válido antes de prosseguir
  const initDatabase = async () => {
    try {
      console.log(`[DB] Verificando banco de dados em: ${DB_PATH}`);
      const exists = await fs.access(DB_PATH).then(() => true).catch(() => false);
      if (!exists) {
        console.log("[DB] Arquivo database.json não encontrado, criando novo padrão...");
        await fs.writeFile(DB_PATH, JSON.stringify({ servers: [] }, null, 2));
      } else {
        const content = await fs.readFile(DB_PATH, "utf-8");
        try {
          const db = JSON.parse(content);
          if (!db.servers || !Array.isArray(db.servers)) {
             console.log("[DB] Formato inválido, corrigindo...");
             await fs.writeFile(DB_PATH, JSON.stringify({ servers: [] }, null, 2));
          }
          console.log(`[DB] Sucesso: ${db.servers?.length || 0} servidores carregados.`);
        } catch (e) {
          console.error("[DB] Arquivo corrompido, resetando...");
          await fs.writeFile(DB_PATH, JSON.stringify({ servers: [] }, null, 2));
        }
      }
    } catch (err) {
      console.error("[DB] Erro crítico na inicialização:", err);
    }
  };

  await initDatabase();

  // Servers Persistence API
  app.get("/api/servers", async (req, res) => {
    try {
      const data = await fs.readFile(DB_PATH, "utf-8");
      const db = JSON.parse(data);
      console.log(`Loading ${db.servers?.length || 0} servers from database.json`);
      res.json(db);
    } catch (error) {
      console.error("Failed to read database:", error);
      res.status(500).json({ error: "Failed to read database" });
    }
  });

  app.post("/api/servers", async (req, res) => {
    try {
      const { servers } = req.body;
      if (!Array.isArray(servers)) {
        return res.status(400).json({ error: "Invalid data format: 'servers' must be an array" });
      }
      await fs.writeFile(DB_PATH, JSON.stringify({ servers }, null, 2));
      console.log(`Saved ${servers.length} servers to database.json`);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to save to database:", error);
      res.status(500).json({ error: "Failed to save to database" });
    }
  });

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

      console.log(`Zabbix Request: ${method} to ${targetUrl}`);

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
          details: errorText,
          targetUrl
        });
      }

      const data = await response.json();
      
      // Zabbix returns 200 even for API errors
      if (data.error) {
        return res.status(400).json({
          error: data.error.message || "Zabbix API Error",
          details: data.error.data,
          code: data.error.code,
          targetUrl
        });
      }

      res.json(data);
    } catch (error: any) {
      console.error("Zabbix Proxy Error:", error.message);
      
      const isDnsError = error.message.includes("ENOTFOUND") || error.code === "ENOTFOUND";
      const isConnError = error.message.includes("ECONNREFUSED") || error.code === "ECONNREFUSED";
      
      res.status(500).json({ 
        error: isDnsError ? "DNS_NOT_FOUND" : "CONNECTION_FAILED",
        details: error.message,
        hint: isDnsError 
          ? `O endereço ${zabbixUrl} não foi encontrado. Verifique se o host está correto ou se é um endereço interno privado.`
          : "Não foi possível conectar ao servidor Zabbix. Verifique o firewall ou se o serviço está rodando.",
        targetUrl: zabbixUrl
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
