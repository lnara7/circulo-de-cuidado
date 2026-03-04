const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Permitir acesso às fotos
app.use("/uploads", express.static("uploads"));

// ==========================
// CONFIGURAÇÃO POSTGRESQL (NUVEM)
// ==========================
const pool = new Pool({
  connectionString: "postgresql://postgres.mesuwyojkbjwziqrbour:H4DPoNOfIUnzs7bF@aws-1-us-east-1.pooler.supabase.com:6543/postgres",
  ssl: {
    rejectUnauthorized: false
  }
});

// ==========================
// INICIALIZAÇÃO DO BANCO
// ==========================
const initDB = async () => {
  try {
    // 👇 ADICIONE ESTA LINHA TEMPORARIAMENTE 👇
    // await pool.query("DROP TABLE IF EXISTS chats_favoritos, mensagens, agendamentos, notificacoes, pedidos, disponibilidades, users CASCADE ");
    // 👆 ELA VAI APAGAR O BANCO ANTIGO 👆
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        cpf TEXT NOT NULL UNIQUE,
        data_nascimento DATE NOT NULL,
        senha TEXT NOT NULL,
        foto TEXT,
        horas INTEGER DEFAULT 0,
        cuidados INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS disponibilidades (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        data DATE NOT NULL,
        periodo TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        solicitante_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        data DATE NOT NULL,
        periodo TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notificacoes (
        id SERIAL PRIMARY KEY,
        remetente_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        destinatario_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL, 
        data DATE NOT NULL,
        periodo TEXT NOT NULL,
        status TEXT DEFAULT 'pendente',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agendamentos (
        id SERIAL PRIMARY KEY,
        cuidadora_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        mae_cuidada_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        data DATE NOT NULL,
        periodo TEXT NOT NULL,
        status TEXT DEFAULT 'agendado',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS mensagens (
        id SERIAL PRIMARY KEY,
        remetente_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        destinatario_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        conteudo TEXT NOT NULL,
        tipo TEXT DEFAULT 'texto', -- Pode ser 'texto', 'audio' ou 'proposta'
        lida BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chats_favoritos (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        contato_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, contato_id)
      );
    `);

    console.log("✅ Banco conectado e tabelas prontas.");
  } catch (error) {
    console.error("❌ Erro ao iniciar banco:", error.message);
  }
};

initDB();

// ==========================
// MULTER PARA UPLOAD
// ==========================
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, "user_" + req.body.user_id + "_" + Date.now() + ext);
  }
});

const upload = multer({ storage: storage });

// ==========================
// REGISTRO
// ==========================
app.post("/register", async (req, res) => {
  const { nome, cpf, data_nascimento, senha } = req.body;

  try {
    const check = await pool.query("SELECT id FROM users WHERE cpf = $1", [cpf]);
    if (check.rows.length > 0) return res.status(400).json({ erro: "CPF já está em uso." });

    const hash = await bcrypt.hash(senha, 10);
    await pool.query("INSERT INTO users (nome, cpf, data_nascimento, senha) VALUES ($1, $2, $3, $4)", [nome, cpf, data_nascimento, hash]);
    res.status(201).json({ mensagem: "Conta criada com sucesso!" });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao criar conta." });
  }
});

// ==========================
// LOGIN
// ==========================
app.post("/login", async (req, res) => {
  const { cpf, senha } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE cpf = $1", [cpf]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(senha, user.senha))) {
      return res.status(400).json({ erro: "CPF ou senha inválidos." });
    }

    res.json({
      usuario: { id: user.id, nome: user.nome, foto: user.foto, horas: user.horas, cuidados: user.cuidados }
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao realizar login." });
  }
});

// ==========================
// ALTERAR SENHA
// ==========================

app.post("/reset-password", async (req, res) => {
  const { cpf, data_nascimento, novaSenha } = req.body;
  try {
    const result = await pool.query("SELECT id FROM users WHERE cpf = $1 AND data_nascimento = $2", [cpf, data_nascimento]);
    if (result.rows.length === 0) return res.status(400).json({ erro: "CPF ou Data de Nascimento incorretos." });

    const hash = await bcrypt.hash(novaSenha, 10);
    await pool.query("UPDATE users SET senha = $1 WHERE cpf = $2", [hash, cpf]);
    res.json({ sucesso: true });
  } catch (e) {
    res.status(500).json({ erro: "Erro ao redefinir senha." });
  }
});

// ==========================
// ATUALIZAR NOME
// ==========================
app.post("/update-name", async (req, res) => {
  const { user_id, nome } = req.body;
  if (!user_id || !nome) return res.status(400).json({ erro: "Dados inválidos." });

  try {
    const result = await pool.query("UPDATE users SET nome = $1 WHERE id = $2", [nome, user_id]);
    if (result.rowCount === 0) return res.status(404).json({ erro: "Usuário não encontrado." });
    res.json({ sucesso: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar nome." });
  }
});

// ==========================
// Upload de foto
//===========================
app.post("/upload-foto", upload.single("foto"), async (req, res) => {
  try {
    const user_id = req.body.user_id || req.query.user_id; // pegar do body ou da query
    if (!user_id || !req.file) return res.status(400).json({ erro: "Dados inválidos." });

    // Cria URL da foto
    const fotoUrl = `https://circulo-de-cuidado-api.onrender.com/uploads/${req.file.filename}`;

    // Salva no banco
    await pool.query("UPDATE users SET foto = $1 WHERE id = $2", [fotoUrl, user_id]);
    res.json({ url: fotoUrl });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao salvar foto." });
  }
});

// ==========================
// SALVAR DISPONIBILIDADE
// ==========================
app.post("/disponibilidade", async (req, res) => {
  const { user_id, data, periodo } = req.body;
  if (!user_id || !data || !periodo) return res.status(400).json({ erro: "Dados inválidos." });

  const dataObj = new Date(data + "T12:00:00");
  const diaSemana = dataObj.getDay();
  if (diaSemana === 0 || diaSemana === 6) return res.status(400).json({ erro: "Sábado e Domingo não são permitidos." });

  try {
    const check = await pool.query(
      "SELECT id FROM disponibilidades WHERE user_id = $1 AND data = $2 AND periodo = $3",
      [user_id, data, periodo]
    );
    if (check.rows.length > 0) return res.status(400).json({ erro: "Você já cadastrou essa data nesse turno." });

    await pool.query(
      "INSERT INTO disponibilidades (user_id, data, periodo) VALUES ($1, $2, $3)",
      [user_id, data, periodo]
    );

    res.json({ sucesso: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao salvar no banco." });
  }
});

// ==========================
// LISTAR DISPONIBILIDADES
// ==========================
app.get("/disponibilidade/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM disponibilidades WHERE user_id = $1 ORDER BY data ASC", [user_id]);
    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar disponibilidades." });
  }
});

// ==========================
// EXCLUIR DISPONIBILIDADE
// ==========================
app.delete("/disponibilidade/:id", async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;

  try {
    const result = await pool.query(
      "DELETE FROM disponibilidades WHERE id = $1 AND user_id = $2",
      [id, user_id]
    );
    if (result.rowCount === 0) return res.status(403).json({ erro: "Não autorizado." });
    res.json({ sucesso: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao excluir." });
  }
});

// ==========================
// SALVAR PEDIDO DE AJUDA
// ==========================
app.post("/pedidos", async (req, res) => {
  const { solicitante_id, data, periodo } = req.body;
  if (!solicitante_id || !data || !periodo) return res.status(400).json({ erro: "Dados inválidos." });

  try {
    await pool.query(
      "INSERT INTO pedidos (solicitante_id, data, periodo) VALUES ($1, $2, $3)",
      [solicitante_id, data, periodo]
    );
    res.json({ sucesso: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao salvar pedido." });
  }
});

// ==========================
// HISTÓRICO DISPONIBILIDADE
// ==========================
app.get("/historico-disponibilidade/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      "SELECT data, periodo FROM disponibilidades WHERE user_id = $1 ORDER BY data ASC",
      [user_id]
    );
    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar histórico de disponibilidades." });
  }
});

// ==========================
// HISTÓRICO PEDIDOS
// ==========================
app.get("/historico-pedidos/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      "SELECT data, periodo FROM pedidos WHERE solicitante_id = $1 ORDER BY data ASC",
      [user_id]
    );
    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar histórico de pedidos." });
  }
});

// ==========================
// BUSCAR CUIDADOS PENDENTES DE CONFIRMAÇÃO
// ==========================
app.get("/cuidados-pendentes/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    // Traz apenas agendamentos onde ela FOI CUIDADA, e a data é hoje ou no passado
    const result = await pool.query(`
      SELECT a.id, a.data, a.periodo, u.nome as cuidadora
      FROM agendamentos a
      JOIN users u ON a.cuidadora_id = u.id
      WHERE a.mae_cuidada_id = $1 AND a.status = 'agendado' AND a.data <= CURRENT_DATE
    `, [user_id]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar cuidados pendentes." });
  }
});

// ==========================
// CONFIRMAR CUIDADO E DISTRIBUIR HORAS
// ==========================
app.post("/confirmar-cuidado", async (req, res) => {
  const { agendamento_id } = req.body;
  try {
    const check = await pool.query("SELECT * FROM agendamentos WHERE id = $1", [agendamento_id]);
    const agendamento = check.rows[0];

    if (!agendamento) return res.status(404).json({ erro: "Agendamento não encontrado." });

    // Prevenção de fraude garantida pelo backend
    if (new Date(agendamento.data) > new Date()) {
      return res.status(400).json({ erro: "Você não pode confirmar um cuidado no futuro!" });
    }

    // Marca como confirmado
    await pool.query("UPDATE agendamentos SET status = 'confirmado' WHERE id = $1", [agendamento_id]);

    // Cuidadora ganha +4 horas e +1 no contador de cuidados
    await pool.query("UPDATE users SET horas = horas + 4, cuidados = cuidados + 1 WHERE id = $1", [agendamento.cuidadora_id]);

    // Mãe cuidada perde -4 horas
    await pool.query("UPDATE users SET horas = horas - 4 WHERE id = $1", [agendamento.mae_cuidada_id]);

    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao confirmar cuidado." });
  }
});

// ==========================
// EXCLUIR PEDIDO DE AJUDA
// ==========================
app.delete("/pedidos/:id", async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body; 

  try {
    const result = await pool.query(
      "DELETE FROM pedidos WHERE id = $1 AND solicitante_id = $2",
      [id, user_id]
    );
    if (result.rowCount === 0) return res.status(403).json({ erro: "Não autorizado." });
    res.json({ sucesso: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao excluir pedido." });
  }
});

// ==========================
// MATCH: MÃES PRECISANDO DE AJUDA
// ==========================
app.get("/pedidos-abertos/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT p.id, p.data, p.periodo, u.nome, u.id as solicitante_id, u.foto
       FROM pedidos p JOIN users u ON p.solicitante_id = u.id
       WHERE p.solicitante_id != $1 ORDER BY p.data ASC`, [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar pedidos." });
  }
});

// ==========================
// MATCH: MÃES DISPONÍVEIS PARA AJUDAR
// ==========================
app.get("/disponibilidades-abertas/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT d.id, d.data, d.periodo, u.nome, u.id as voluntaria_id, u.foto
       FROM disponibilidades d JOIN users u ON d.user_id = u.id
       WHERE d.user_id != $1 ORDER BY d.data ASC`, [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar disponibilidades." });
  }
});

// ==========================
// ENVIAR NOTIFICAÇÃO DE MATCH
// ==========================
app.post("/enviar-notificacao", async (req, res) => {
  const { remetente_id, destinatario_id, tipo, data, periodo } = req.body;
  try {
    // Evita duplicatas de notificação pendente
    const check = await pool.query(
      "SELECT id FROM notificacoes WHERE remetente_id=$1 AND destinatario_id=$2 AND data=$3 AND periodo=$4",
      [remetente_id, destinatario_id, data, periodo]
    );
    if (check.rows.length > 0) return res.status(400).json({ erro: "Notificação já enviada para esta data!" });

    await pool.query(
      "INSERT INTO notificacoes (remetente_id, destinatario_id, tipo, data, periodo) VALUES ($1, $2, $3, $4, $5)",
      [remetente_id, destinatario_id, tipo, data, periodo]
    );
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao enviar notificação." });
  }
});

// ==========================
// BUSCAR NOTIFICAÇÕES DO USUÁRIO
// ==========================
app.get("/notificacoes/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT n.id, n.tipo, n.data, n.periodo, u.nome as remetente_nome, u.foto as remetente_foto
       FROM notificacoes n JOIN users u ON n.remetente_id = u.id
       WHERE n.destinatario_id = $1 AND n.status = 'pendente'
       ORDER BY n.created_at DESC`, [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar notificações." });
  }
});

// ==========================
// RESPONDER NOTIFICAÇÃO
// ==========================
app.post("/responder-notificacao", async (req, res) => {
  const { notificacao_id, resposta } = req.body; // resposta deve ser 'aceito' ou 'recusado'
  
  try {
    const check = await pool.query("SELECT * FROM notificacoes WHERE id = $1", [notificacao_id]);
    const n = check.rows[0];
    if (!n) return res.status(404).json({ erro: "Notificação não encontrada." });

    // Atualiza o status da notificação
    await pool.query("UPDATE notificacoes SET status = $1 WHERE id = $2", [resposta, notificacao_id]);

    // Se aceitou, tira o pedido/disponibilidade da visão de todos e CRIA O AGENDAMENTO
    if (resposta === 'aceito') {
      let cuidadora_id, mae_cuidada_id;

      if (n.tipo === 'oferece_ajuda') {
        cuidadora_id = n.remetente_id;
        mae_cuidada_id = n.destinatario_id;
        await pool.query("DELETE FROM pedidos WHERE solicitante_id = $1 AND data = $2 AND periodo = $3", [n.destinatario_id, n.data, n.periodo]);
        await pool.query("DELETE FROM disponibilidades WHERE user_id = $1 AND data = $2 AND periodo = $3", [n.remetente_id, n.data, n.periodo]);
      } else if (n.tipo === 'pede_ajuda') {
        cuidadora_id = n.destinatario_id;
        mae_cuidada_id = n.remetente_id;
        await pool.query("DELETE FROM pedidos WHERE solicitante_id = $1 AND data = $2 AND periodo = $3", [n.remetente_id, n.data, n.periodo]);
        await pool.query("DELETE FROM disponibilidades WHERE user_id = $1 AND data = $2 AND periodo = $3", [n.destinatario_id, n.data, n.periodo]);
      }

      // Registra o compromisso oficial na agenda
      await pool.query(
        "INSERT INTO agendamentos (cuidadora_id, mae_cuidada_id, data, periodo) VALUES ($1, $2, $3, $4)",
        [cuidadora_id, mae_cuidada_id, n.data, n.periodo]
      );
    }
    // Caso seja recusado, o código já faz o correto (apenas muda o status da notificação e mantém o pedido aberto).
    
    res.json({ sucesso: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao processar a resposta." });
  }
});


// ==========================
// BUSCAR CUIDADOS PENDENTES DE CONFIRMAÇÃO
// ==========================
app.get("/cuidados-pendentes/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    // Traz apenas agendamentos onde ela FOI CUIDADA, e a data é hoje ou no passado
    const result = await pool.query(`
      SELECT a.id, a.data, a.periodo, u.nome as cuidadora
      FROM agendamentos a
      JOIN users u ON a.cuidadora_id = u.id
      WHERE a.mae_cuidada_id = $1 AND a.status = 'agendado' AND a.data <= CURRENT_DATE
    `, [user_id]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar cuidados pendentes." });
  }
});

// ==========================
// CONFIRMAR CUIDADO E DISTRIBUIR HORAS
// ==========================
app.post("/confirmar-cuidado", async (req, res) => {
  const { agendamento_id } = req.body;
  try {
    const check = await pool.query("SELECT * FROM agendamentos WHERE id = $1", [agendamento_id]);
    const agendamento = check.rows[0];

    if (!agendamento) return res.status(404).json({ erro: "Agendamento não encontrado." });

    // Prevenção de fraude garantida pelo backend
    if (new Date(agendamento.data) > new Date()) {
      return res.status(400).json({ erro: "Você não pode confirmar um cuidado no futuro!" });
    }

    // Marca como confirmado
    await pool.query("UPDATE agendamentos SET status = 'confirmado' WHERE id = $1", [agendamento_id]);

    // Cuidadora ganha +4 horas e +1 no contador de cuidados
    await pool.query("UPDATE users SET horas = horas + 4, cuidados = cuidados + 1 WHERE id = $1", [agendamento.cuidadora_id]);

    // Mãe cuidada perde -4 horas
    await pool.query("UPDATE users SET horas = horas - 4 WHERE id = $1", [agendamento.mae_cuidada_id]);

    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao confirmar cuidado." });
  }
});

// ==========================
// LISTAR AGENDA COMPLETA (Agendamentos confirmados)
// ==========================
app.get("/agenda/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    // 1. Se eu vou AJUDAR -> Quero o nome e a foto de quem vai ser cuidada (mae_cuidada_id)
    const vou_ajudar = await pool.query(
      `SELECT a.id, a.data, a.periodo, 'ajudar' as tipo, u.nome as outra_pessoa, u.foto as outra_foto 
       FROM agendamentos a JOIN users u ON a.mae_cuidada_id = u.id 
       WHERE a.cuidadora_id = $1 AND a.status = 'agendado'`, [user_id]
    );
    
    // 2. Se eu VOU SER CUIDADA -> Quero o nome e a foto da cuidadora (cuidadora_id)
    const vou_ser_cuidada = await pool.query(
      `SELECT a.id, a.data, a.periodo, 'preciso' as tipo, u.nome as outra_pessoa, u.foto as outra_foto 
       FROM agendamentos a JOIN users u ON a.cuidadora_id = u.id 
       WHERE a.mae_cuidada_id = $1 AND a.status = 'agendado'`, [user_id]
    );

    const agenda = [...vou_ajudar.rows, ...vou_ser_cuidada.rows];
    agenda.sort((a, b) => new Date(a.data) - new Date(b.data));

    res.json(agenda);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar agenda." });
  }
});

// ==========================
// BUSCAR DADOS ATUALIZADOS DO USUÁRIO
// ==========================
app.get("/usuario/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT horas, cuidados FROM users WHERE id = $1", [req.params.id]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ erro: "Usuário não encontrado." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar dados do usuário." });
  }
});

// ==========================
// CANCELAR AGENDAMENTO (Pela Agenda)
// ==========================
app.delete("/agendamentos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM agendamentos WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ erro: "Agendamento não encontrado." });
    res.json({ sucesso: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao cancelar agendamento." });
  }
});

// ==========================
// NEGAR CUIDADO (Mãe informa que não recebeu)
// ==========================
app.post("/negar-cuidado", async (req, res) => {
  const { agendamento_id } = req.body;
  try {
    // Muda o status para 'nao_realizado' para sair da lista de pendentes sem transferir horas
    const result = await pool.query("UPDATE agendamentos SET status = 'nao_realizado' WHERE id = $1", [agendamento_id]);
    if (result.rowCount === 0) return res.status(404).json({ erro: "Agendamento não encontrado." });
    
    res.json({ sucesso: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao registrar falha no cuidado." });
  }
});

// ==========================
// BUSCAR MÃES (Aleatório + Filtro de Nome)
// ==========================
app.get("/buscar-maes/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const { nome } = req.query; // Pega o que foi digitado na lupa
  
  try {
    let query = "SELECT id, nome, foto FROM users WHERE id != $1";
    let values = [user_id];

    if (nome) {
      query += " AND nome ILIKE $2";
      values.push(`%${nome}%`);
    }

    query += " ORDER BY RANDOM()"; // Ordem sempre aleatória

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar mães." });
  }
});

// ==========================
// CONTADOR DE MENSAGENS NÃO LIDAS
// ==========================
app.get("/mensagens-nao-lidas/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      "SELECT count(*) FROM mensagens WHERE destinatario_id = $1 AND lida = false",
      [user_id]
    );
    res.json({ nao_lidas: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao contar mensagens." });
  }
});

// ==========================
// LISTA DE CHATS (Com última mensagem e favoritos)
// ==========================
app.get("/chats/:user_id", async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(`
      SELECT 
        u.id as contato_id, u.nome, u.foto,
        (SELECT conteudo FROM mensagens WHERE (remetente_id = $1 AND destinatario_id = u.id) OR (remetente_id = u.id AND destinatario_id = $1) ORDER BY created_at DESC LIMIT 1) as ultima_mensagem,
        (SELECT COUNT(*) FROM mensagens WHERE remetente_id = u.id AND destinatario_id = $1 AND lida = false) as nao_lidas,
        CASE WHEN f.contato_id IS NOT NULL THEN true ELSE false END as is_favorito
      FROM users u
      LEFT JOIN chats_favoritos f ON f.user_id = $1 AND f.contato_id = u.id
      WHERE u.id IN (
        SELECT remetente_id FROM mensagens WHERE destinatario_id = $1
        UNION
        SELECT destinatario_id FROM mensagens WHERE remetente_id = $1
      )
      ORDER BY is_favorito DESC, nao_lidas DESC, u.nome ASC
    `, [user_id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar chats." });
  }
});

// ==========================
// FAVORITAR / DESFAVORITAR CHAT
// ==========================
app.post("/favoritar", async (req, res) => {
  const { user_id, contato_id, favoritar } = req.body;
  try {
    if (favoritar) {
      await pool.query("INSERT INTO chats_favoritos (user_id, contato_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user_id, contato_id]);
    } else {
      await pool.query("DELETE FROM chats_favoritos WHERE user_id = $1 AND contato_id = $2", [user_id, contato_id]);
    }
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao favoritar." });
  }
});

// ==========================
// BUSCAR MENSAGENS (E marcar como lidas)
// ==========================
app.get("/mensagens/:user_id/:contato_id", async (req, res) => {
  const { user_id, contato_id } = req.params;
  try {
    // Marca como lidas
    await pool.query("UPDATE mensagens SET lida = true WHERE remetente_id = $1 AND destinatario_id = $2 AND lida = false", [contato_id, user_id]);
    
    // Busca o histórico
    const result = await pool.query(`
      SELECT remetente_id, conteudo, tipo, created_at 
      FROM mensagens 
      WHERE (remetente_id = $1 AND destinatario_id = $2) OR (remetente_id = $2 AND destinatario_id = $1)
      ORDER BY created_at ASC
    `, [user_id, contato_id]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar mensagens." });
  }
});

// ==========================
// ENVIAR MENSAGEM (Texto ou Notificação de Proposta)
// ==========================
app.post("/mensagens", async (req, res) => {
  const { remetente_id, destinatario_id, conteudo, tipo } = req.body;
  try {
    await pool.query(
      "INSERT INTO mensagens (remetente_id, destinatario_id, conteudo, tipo) VALUES ($1, $2, $3, $4)",
      [remetente_id, destinatario_id, conteudo, tipo || 'texto']
    );
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao enviar mensagem." });
  }
});

// ==========================
// UPLOAD DE ÁUDIO NO CHAT
// ==========================
app.post("/upload-audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: "Nenhum áudio enviado." });
    const audioUrl = `https://circulo-de-cuidado-api.onrender.com/uploads/${req.file.filename}`;
    res.json({ url: audioUrl });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao salvar áudio." });
  }
});

// ==========================
// UPLOAD DE IMAGEM NO CHAT
// ==========================
app.post("/upload-imagem", upload.single("imagem"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: "Nenhuma imagem enviada." });
    
    // Cria a URL da imagem baseada na pasta uploads
    const imgUrl = `https://circulo-de-cuidado-api.onrender.com/uploads/${req.file.filename}`;
    res.json({ url: imgUrl });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao salvar imagem." });
  }
});

// ==========================
// TRATAMENTO 404
// ==========================
app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada." });
});


app.listen(3000, () => {
  console.log("🚀 Servidor rodando em https://circulo-de-cuidado-api.onrender.com");
});