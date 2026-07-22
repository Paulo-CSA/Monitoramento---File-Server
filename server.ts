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
const IMG_DIR = path.resolve(process.cwd(), "img");

async function processAndSaveBase64Images(servers: any[]) {
  if (!Array.isArray(servers)) return servers;
  try {
    await fs.mkdir(IMG_DIR, { recursive: true });
    for (const server of servers) {
      if (Array.isArray(server.images)) {
        for (const img of server.images) {
          if (img && typeof img.url === "string" && img.url.startsWith("data:image/")) {
            const commaIndex = img.url.indexOf(",");
            if (commaIndex !== -1) {
              const header = img.url.substring(0, commaIndex);
              const base64Data = img.url.substring(commaIndex + 1);

              let ext = "png";
              const mimeMatch = header.match(/data:image\/([^;]+);/);
              if (mimeMatch) {
                const mime = mimeMatch[1].toLowerCase();
                if (mime === "jpeg" || mime === "jpg") ext = "jpg";
                else if (mime === "png") ext = "png";
                else if (mime === "gif") ext = "gif";
                else if (mime === "webp") ext = "webp";
                else if (mime.includes("svg")) ext = "svg";
              }

              const buffer = Buffer.from(base64Data, "base64");
              const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
              const filePath = path.join(IMG_DIR, filename);
              await fs.writeFile(filePath, buffer);
              img.url = `/img/${filename}`;
              console.log(`[IMG] Base64 salvo em /img: ${img.url}`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[IMG] Erro ao processar imagens base64:", err);
  }
  return servers;
}

async function startServer() {
  const app = express();
  
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Serve static files from /img directory
  app.use("/img", express.static(IMG_DIR));

  // Garante que a pasta /img e o database.json existem e são válidos
  const initDatabase = async () => {
    try {
      await fs.mkdir(IMG_DIR, { recursive: true });
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
          } else {
             // Process any existing base64 images to save into /img folder
             const cleanedServers = await processAndSaveBase64Images(db.servers);
             await fs.writeFile(DB_PATH, JSON.stringify({ servers: cleanedServers }, null, 2));
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

  // Upload Image Endpoint
  app.post("/api/upload-image", async (req, res) => {
    try {
      const { image } = req.body;
      if (!image || typeof image !== "string") {
        return res.status(400).json({ error: "Nenhuma imagem enviada" });
      }

      if (image.startsWith("/img/")) {
        return res.json({ success: true, url: image, id: Date.now().toString() });
      }

      const commaIndex = image.indexOf(",");
      if (!image.startsWith("data:image/") || commaIndex === -1) {
        return res.status(400).json({ error: "Formato de imagem base64 inválido" });
      }

      const header = image.substring(0, commaIndex);
      const base64Data = image.substring(commaIndex + 1);

      let ext = "png";
      const mimeMatch = header.match(/data:image\/([^;]+);/);
      if (mimeMatch) {
        const mime = mimeMatch[1].toLowerCase();
        if (mime === "jpeg" || mime === "jpg") ext = "jpg";
        else if (mime === "png") ext = "png";
        else if (mime === "gif") ext = "gif";
        else if (mime === "webp") ext = "webp";
        else if (mime.includes("svg")) ext = "svg";
      }

      const buffer = Buffer.from(base64Data, "base64");

      await fs.mkdir(IMG_DIR, { recursive: true });

      const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      const filePath = path.join(IMG_DIR, filename);

      await fs.writeFile(filePath, buffer);
      const imageUrl = `/img/${filename}`;

      console.log(`[IMG] Imagem salva no disco em /img: ${filePath}`);
      return res.json({ success: true, url: imageUrl, id: Date.now().toString() });
    } catch (error: any) {
      console.error("[IMG] Erro ao salvar imagem:", error);
      return res.status(500).json({ error: "Erro interno ao salvar imagem no servidor" });
    }
  });

  // Delete Image Endpoint
  app.post("/api/delete-image", async (req, res) => {
    try {
      const { url } = req.body;
      if (url && typeof url === "string" && url.startsWith("/img/")) {
        const filename = path.basename(url);
        const filePath = path.join(IMG_DIR, filename);
        await fs.unlink(filePath).catch(() => {});
        console.log(`[IMG] Imagem apagada do disco: ${filePath}`);
      }
      res.json({ success: true });
    } catch (e) {
      res.json({ success: true });
    }
  });

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
      let { servers } = req.body;
      if (!Array.isArray(servers)) {
        return res.status(400).json({ error: "Invalid data format: 'servers' must be an array" });
      }
      servers = await processAndSaveBase64Images(servers);
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
