import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fs from "fs/promises";
import multer from "multer";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(process.cwd(), "database.json");
const IMG_DIR = path.resolve(process.cwd(), "img");
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

// Helper para converter base64 em arquivo de imagem no disco na pasta /img
async function processAndSaveBase64Image(dataUrl: string): Promise<string> {
  if (!dataUrl) return '';
  if (dataUrl.startsWith('/img/') || dataUrl.startsWith('/uploads/') || dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
    return dataUrl;
  }
  const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
  if (!matches) {
    return dataUrl;
  }
  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const filename = `img-${Date.now()}-${Math.floor(Math.random() * 1000000)}.${ext}`;
  const filepath = path.join(IMG_DIR, filename);
  await fs.writeFile(filepath, buffer);
  return `/img/${filename}`;
}

async function startServer() {
  const app = express();
  
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Configuração do Multer para upload de arquivos na pasta /img
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMG_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `img-${Date.now()}-${Math.floor(Math.random() * 1000000)}${ext}`);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

  // Garante que o database.json e as pastas /img e /uploads existem
  const initDatabase = async () => {
    try {
      await fs.mkdir(IMG_DIR, { recursive: true });
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      console.log(`[DB] Pasta de imagens /img pronta em: ${IMG_DIR}`);

      const exists = await fs.access(DB_PATH).then(() => true).catch(() => false);
      if (!exists) {
        console.log("[DB] Criando database.json inicial...");
        await fs.writeFile(DB_PATH, JSON.stringify({ servers: [] }, null, 2));
      } else {
        const content = await fs.readFile(DB_PATH, "utf-8");
        try {
          const db = JSON.parse(content);
          if (!db.servers || !Array.isArray(db.servers)) {
             await fs.writeFile(DB_PATH, JSON.stringify({ servers: [] }, null, 2));
          } else {
            // Migrar quaisquer imagens base64 antigas para a pasta /img
            let modified = false;
            for (const server of db.servers) {
              if (server.images && Array.isArray(server.images)) {
                for (let i = 0; i < server.images.length; i++) {
                  if (server.images[i].url && server.images[i].url.startsWith('data:image')) {
                    server.images[i].url = await processAndSaveBase64Image(server.images[i].url);
                    modified = true;
                  }
                }
              }
            }
            if (modified) {
              await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
              console.log("[DB] Imagens convertidas para a pasta /img com sucesso!");
            }
          }
          console.log(`[DB] Banco de dados carregado com sucesso.`);
        } catch (e) {
          console.error("[DB] Arquivo corrompido, resetando...");
          await fs.writeFile(DB_PATH, JSON.stringify({ servers: [] }, null, 2));
        }
      }
    } catch (err) {
      console.error("[DB] Erro na inicialização do banco:", err);
    }
  };

  await initDatabase();

  // Servir imagens enviadas como arquivos estáticos através de /img e /uploads
  app.use("/img", express.static(IMG_DIR));
  app.use("/uploads", express.static(UPLOADS_DIR));

  // Servers Persistence API
  app.get("/api/servers", async (req, res) => {
    try {
      const data = await fs.readFile(DB_PATH, "utf-8");
      const db = JSON.parse(data);
      res.json(db);
    } catch (error) {
      console.error("Failed to read database:", error);
      res.status(500).json({ error: "Failed to read database" });
    }
  });

  // Salvar ou atualizar conjunto total de servidores
  app.post("/api/servers", async (req, res) => {
    try {
      const { servers } = req.body;
      if (!Array.isArray(servers)) {
        return res.status(400).json({ error: "Invalid data format: 'servers' must be an array" });
      }

      // Converter quaisquer imagens base64 para arquivos em disco
      for (const server of servers) {
        if (server.images && Array.isArray(server.images)) {
          for (let i = 0; i < server.images.length; i++) {
            if (server.images[i].url && server.images[i].url.startsWith('data:image')) {
              server.images[i].url = await processAndSaveBase64Image(server.images[i].url);
            }
          }
        }
      }

      await fs.writeFile(DB_PATH, JSON.stringify({ servers }, null, 2));
      console.log(`Saved ${servers.length} servers to database.json`);
      res.json({ success: true, servers });
    } catch (error) {
      console.error("Failed to save to database:", error);
      res.status(500).json({ error: "Failed to save to database" });
    }
  });

  // Salvar Anotações & Checklist de um Servidor Específico (Levíssimo e ultra-rápido)
  app.put("/api/servers/:serverId/notes", async (req, res) => {
    try {
      const { serverId } = req.params;
      const { noteText, notes } = req.body;

      const data = await fs.readFile(DB_PATH, "utf-8");
      const db = JSON.parse(data);
      if (!db.servers) db.servers = [];

      const serverIndex = db.servers.findIndex((s: any) => s.id === serverId);
      if (serverIndex === -1) {
        return res.status(404).json({ error: "Servidor não encontrado" });
      }

      if (noteText !== undefined) {
        db.servers[serverIndex].noteText = noteText;
      }
      if (notes !== undefined) {
        db.servers[serverIndex].notes = notes;
      }

      await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
      console.log(`Anotações atualizadas no servidor ${serverId}`);
      res.json({ success: true, server: db.servers[serverIndex] });
    } catch (error) {
      console.error("Erro ao salvar anotações:", error);
      res.status(500).json({ error: "Falha ao salvar anotações" });
    }
  });

  // Upload de Imagem de um Servidor Específico
  app.post("/api/servers/:serverId/images", upload.single('file'), async (req, res) => {
    try {
      const { serverId } = req.params;
      let imageUrl = '';

      if (req.file) {
        imageUrl = `/img/${req.file.filename}`;
      } else if (req.body.imageBase64) {
        imageUrl = await processAndSaveBase64Image(req.body.imageBase64);
      } else {
        return res.status(400).json({ error: "Nenhuma imagem foi fornecida" });
      }

      const data = await fs.readFile(DB_PATH, "utf-8");
      const db = JSON.parse(data);
      if (!db.servers) db.servers = [];

      const serverIndex = db.servers.findIndex((s: any) => s.id === serverId);
      if (serverIndex === -1) {
        return res.status(404).json({ error: "Servidor não encontrado" });
      }

      const newImage = {
        id: Date.now().toString(),
        url: imageUrl
      };

      if (!db.servers[serverIndex].images) {
        db.servers[serverIndex].images = [];
      }
      db.servers[serverIndex].images.push(newImage);

      await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
      console.log(`Nova imagem ${newImage.id} adicionada ao servidor ${serverId}: ${imageUrl}`);

      res.json({ success: true, image: newImage, server: db.servers[serverIndex] });
    } catch (error) {
      console.error("Erro ao salvar imagem:", error);
      res.status(500).json({ error: "Falha ao salvar imagem" });
    }
  });

  // Deletar Imagem de um Servidor
  app.delete("/api/servers/:serverId/images/:imageId", async (req, res) => {
    try {
      const { serverId, imageId } = req.params;

      const data = await fs.readFile(DB_PATH, "utf-8");
      const db = JSON.parse(data);
      if (!db.servers) db.servers = [];

      const serverIndex = db.servers.findIndex((s: any) => s.id === serverId);
      if (serverIndex === -1) {
        return res.status(404).json({ error: "Servidor não encontrado" });
      }

      const server = db.servers[serverIndex];
      const imageToDelete = (server.images || []).find((img: any) => img.id === imageId);

      if (imageToDelete) {
        server.images = server.images.filter((img: any) => img.id !== imageId);
        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));

        // Apagar o arquivo do disco se estiver em /img/ ou /uploads/
        if (imageToDelete.url) {
          if (imageToDelete.url.startsWith('/img/')) {
            const filename = path.basename(imageToDelete.url);
            const filepath = path.join(IMG_DIR, filename);
            fs.unlink(filepath).catch(() => {});
          } else if (imageToDelete.url.startsWith('/uploads/')) {
            const filename = path.basename(imageToDelete.url);
            const filepath = path.join(UPLOADS_DIR, filename);
            fs.unlink(filepath).catch(() => {});
          }
        }
      }

      res.json({ success: true, server });
    } catch (error) {
      console.error("Erro ao deletar imagem:", error);
      res.status(500).json({ error: "Falha ao deletar imagem" });
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
