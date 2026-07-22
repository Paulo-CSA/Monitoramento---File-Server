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
const PUBLIC_UPLOADS = path.resolve(process.cwd(), "public/uploads");
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

// Helper: salva string base64 em arquivo físico na pasta public/uploads/
async function saveBase64ImageToDisk(base64Data: string): Promise<string> {
  if (!base64Data || typeof base64Data !== 'string') return base64Data;
  if (!base64Data.startsWith('data:image')) return base64Data;

  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  let buffer: Buffer;
  let extension = "jpg";

  if (matches && matches.length === 3) {
    buffer = Buffer.from(matches[2], "base64");
    if (matches[1].includes("png")) extension = "png";
    if (matches[1].includes("webp")) extension = "webp";
  } else {
    buffer = Buffer.from(base64Data, "base64");
  }

  const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${extension}`;
  
  await fs.mkdir(PUBLIC_UPLOADS, { recursive: true }).catch(() => {});
  await fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});

  await fs.writeFile(path.join(PUBLIC_UPLOADS, filename), buffer);
  await fs.writeFile(path.join(UPLOADS_DIR, filename), buffer).catch(() => {});

  console.log(`[Disk Storage] Salva imagem base64 convertida em /uploads/${filename}`);
  return `/uploads/${filename}`;
}

// Helper: garante que nenhum objeto de servidor mantenha strings Base64 gigantes no banco
async function sanitizeServerImages(servers: any[]): Promise<any[]> {
  if (!Array.isArray(servers)) return [];
  const cleanServers = [];
  for (const server of servers) {
    const cleanServer = { ...server };
    if (Array.isArray(cleanServer.images)) {
      const cleanImages = [];
      for (const img of cleanServer.images) {
        if (img && img.url && img.url.startsWith('data:image')) {
          const newUrl = await saveBase64ImageToDisk(img.url);
          cleanImages.push({ ...img, url: newUrl });
        } else {
          cleanImages.push(img);
        }
      }
      cleanServer.images = cleanImages;
    }
    cleanServers.push(cleanServer);
  }
  return cleanServers;
}

async function startServer() {
  const app = express();
  
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Garante diretórios de uploads e provê rotas estáticas
  await fs.mkdir(PUBLIC_UPLOADS, { recursive: true }).catch(() => {});
  await fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});
  
  app.use("/public/uploads", express.static(PUBLIC_UPLOADS));
  app.use("/uploads", express.static(PUBLIC_UPLOADS));
  app.use("/uploads", express.static(UPLOADS_DIR));
  app.use("/api/uploads", express.static(PUBLIC_UPLOADS));
  app.use("/api/uploads", express.static(UPLOADS_DIR));

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
          let db = JSON.parse(content);
          if (!db.servers || !Array.isArray(db.servers)) {
            console.log("[DB] Formato inválido, corrigindo...");
            db = { servers: [] };
          } else {
            // Migra/limpa imagens base64 antigas para arquivos físicos
            db.servers = await sanitizeServerImages(db.servers);
          }
          await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
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
      const cleanServers = await sanitizeServerImages(servers);
      await fs.writeFile(DB_PATH, JSON.stringify({ servers: cleanServers }, null, 2));
      console.log(`Saved ${cleanServers.length} servers to database.json`);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to save to database:", error);
      res.status(500).json({ error: "Failed to save to database" });
    }
  });

  // Image Upload API (Suporta tanto envio binário quanto Base64)
  app.post("/api/upload", express.raw({ type: ["image/*", "application/octet-stream"], limit: "50mb" }), async (req, res) => {
    try {
      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
        await fs.writeFile(path.join(PUBLIC_UPLOADS, filename), req.body);
        await fs.writeFile(path.join(UPLOADS_DIR, filename), req.body).catch(() => {});
        console.log(`[Upload Direct Binary] Imagem salva: ${filename}`);
        return res.json({ success: true, url: `/uploads/${filename}` });
      }

      const { imageData } = req.body || {};
      if (imageData && typeof imageData === "string") {
        const url = await saveBase64ImageToDisk(imageData);
        return res.json({ success: true, url });
      }

      res.status(400).json({ error: "Formato de imagem inválido" });
    } catch (error) {
      console.error("[Upload Error]", error);
      res.status(500).json({ error: "Falha ao salvar imagem no servidor" });
    }
  });

  app.delete("/api/upload/:filename", async (req, res) => {
    try {
      const { filename } = req.params;
      const safeFilename = path.basename(filename);
      await fs.unlink(path.join(PUBLIC_UPLOADS, safeFilename)).catch(() => {});
      await fs.unlink(path.join(UPLOADS_DIR, safeFilename)).catch(() => {});
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete file" });
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
