require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json({ limit: "1mb" }));

const sessions = new Map();
const quizAttempts = new Map();

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function cleanGate(g) {
  if (!g || typeof g !== "object") return null;
  const gate = String(g.gate || g.type || "").toUpperCase();
  const q = Array.isArray(g.qubits) ? g.qubits.map(Number) : [];
  const col = Number.isInteger(g.column) ? g.column : Number.isInteger(g.col) ? g.col : 0;
  return { gate, qubits: q, column: col };
}

function complexMul(a, b) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}
function complexAdd(a, b) {
  return { re: a.re + b.re, im: a.im + b.im };
}
function abs2(a) {
  return a.re * a.re + a.im * a.im;
}

const SQRT1_2 = Math.SQRT1_2;
const MATRICES = {
  H: [
    [{re: SQRT1_2,im:0},{re: SQRT1_2,im:0}],
    [{re: SQRT1_2,im:0},{re:-SQRT1_2,im:0}]
  ],
  X: [
    [{re:0,im:0},{re:1,im:0}],
    [{re:1,im:0},{re:0,im:0}]
  ],
  Y: [
    [{re:0,im:0},{re:0,im:-1}],
    [{re:0,im:1},{re:0,im:0}]
  ],
  Z: [
    [{re:1,im:0},{re:0,im:0}],
    [{re:0,im:0},{re:-1,im:0}]
  ],
  S: [
    [{re:1,im:0},{re:0,im:0}],
    [{re:0,im:0},{re:0,im:1}]
  ],
  T: [
    [{re:1,im:0},{re:0,im:0}],
    [{re:0,im:0},{re:Math.SQRT1_2,im:Math.SQRT1_2}]
  ]
};

function applySingle(state, n, target, matrix) {
  const out = state.map(z => ({...z}));
  const mask = 1 << target;
  for (let i = 0; i < state.length; i++) {
    if ((i & mask) === 0) {
      const j = i | mask;
      const a = state[i], b = state[j];
      out[i] = complexAdd(complexMul(matrix[0][0], a), complexMul(matrix[0][1], b));
      out[j] = complexAdd(complexMul(matrix[1][0], a), complexMul(matrix[1][1], b));
    }
  }
  return out;
}

function applyCX(state, control, target) {
  const out = state.map(z => ({...z}));
  const cm = 1 << control, tm = 1 << target;
  for (let i = 0; i < state.length; i++) {
    if ((i & cm) !== 0 && (i & tm) === 0) {
      const j = i | tm;
      out[i] = state[j];
      out[j] = state[i];
    }
  }
  return out;
}

function applySWAP(state, a, b) {
  if (a === b) return state;
  const out = state.map(z => ({...z}));
  const ma = 1 << a, mb = 1 << b;
  for (let i = 0; i < state.length; i++) {
    const abit = (i & ma) !== 0, bbit = (i & mb) !== 0;
    if (abit !== bbit) {
      const j = i ^ ma ^ mb;
      if (i < j) {
        out[i] = state[j];
        out[j] = state[i];
      }
    }
  }
  return out;
}

function normalizeGateList(circuit, n) {
  const list = Array.isArray(circuit) ? circuit : [];
  const normalized = [];
  for (const item of list) {
    const g = cleanGate(item);
    if (!g || !g.gate) continue;
    if (["H","X","Y","Z","S","T"].includes(g.gate)) {
      const q = g.qubits[0];
      if (Number.isInteger(q) && q >= 0 && q < n) normalized.push({ ...g, qubits:[q] });
    } else if (g.gate === "CX" || g.gate === "CNOT") {
      if (g.qubits.length >= 2 && g.qubits[0] !== g.qubits[1] &&
          g.qubits.every(q => Number.isInteger(q) && q >= 0 && q < n)) {
        normalized.push({ ...g, gate:"CX", qubits:g.qubits.slice(0,2) });
      }
    } else if (g.gate === "SWAP") {
      if (g.qubits.length >= 2 && g.qubits[0] !== g.qubits[1] &&
          g.qubits.every(q => Number.isInteger(q) && q >= 0 && q < n)) {
        normalized.push({ ...g, qubits:g.qubits.slice(0,2) });
      }
    }
  }
  return normalized;
}

function simulate(n, circuit, shots = 1000, mode = "simulator") {
  n = clamp(Number(n) || 2, 1, 4);
  shots = clamp(Number(shots) || 1000, 100, 10000);
  const gates = normalizeGateList(circuit, n);
  let state = Array.from({length: 1 << n}, (_, i) => i === 0 ? {re:1,im:0} : {re:0,im:0});

  for (const g of gates) {
    if (MATRICES[g.gate]) state = applySingle(state, n, g.qubits[0], MATRICES[g.gate]);
    else if (g.gate === "CX") state = applyCX(state, g.qubits[0], g.qubits[1]);
    else if (g.gate === "SWAP") state = applySWAP(state, g.qubits[0], g.qubits[1]);
  }

  const probabilities = state.map(abs2);
  const total = probabilities.reduce((a,b) => a+b, 0) || 1;
  for (let i=0;i<probabilities.length;i++) probabilities[i] /= total;

  const cumulative = [];
  let running = 0;
  for (const p of probabilities) { running += p; cumulative.push(running); }

  const counts = {};
  const noisyRate = mode === "noisy" ? 0.025 : 0;
  for (let s=0;s<shots;s++) {
    let r = Math.random();
    let idx = cumulative.findIndex(c => r <= c);
    if (idx < 0) idx = cumulative.length - 1;
    if (noisyRate && Math.random() < noisyRate) {
      const bit = 1 << Math.floor(Math.random() * n);
      idx ^= bit;
    }
    const bitstring = idx.toString(2).padStart(n, "0");
    counts[bitstring] = (counts[bitstring] || 0) + 1;
  }

  const amplitudes = state.map((z, i) => ({
    state: i.toString(2).padStart(n,"0"),
    re: Number(z.re.toFixed(8)),
    im: Number(z.im.toFixed(8)),
    probability: Number(probabilities[i].toFixed(8))
  })).filter(x => x.probability > 1e-10);

  const bloch = [];
  for (let q=0;q<n;q++) {
    let x=0,y=0,z=0;
    const mask = 1 << q;
    for (let i=0;i<state.length;i++) {
      if ((i & mask) === 0) {
        const j=i|mask;
        const a=state[i], b=state[j];
        const cross=complexMul({re:a.re, im:-a.im}, b);
        x += 2*cross.re;
        y += 2*cross.im;
        z += abs2(a)-abs2(b);
      }
    }
    bloch.push({
      qubit:q,
      x:Number(x.toFixed(6)),
      y:Number(y.toFixed(6)),
      z:Number(z.toFixed(6))
    });
  }

  return { n, shots, mode, circuit:gates, counts, probabilities, amplitudes, bloch };
}

function optimizeCircuit(circuit, n) {
  const gates = normalizeGateList(circuit, n);
  const out = [];
  for (const g of gates) {
    const prev = out[out.length-1];
    if (prev && g.gate === prev.gate && ["X","Y","Z","H"].includes(g.gate) &&
        JSON.stringify(g.qubits) === JSON.stringify(prev.qubits)) {
      out.pop();
      continue;
    }
    out.push(g);
  }
  return {
    circuit: out,
    removed: gates.length - out.length,
    message: gates.length === out.length
      ? "No safe local simplifications were found."
      : `Removed ${gates.length - out.length} redundant adjacent gate operation(s).`
  };
}

function qiskitCode(n, circuit) {
  const lines = [`from qiskit import QuantumCircuit`, ``, `qc = QuantumCircuit(${n}, ${n})`];
  for (const g of normalizeGateList(circuit,n)) {
    if (["H","X","Y","Z","S","T"].includes(g.gate)) lines.push(`qc.${g.gate.toLowerCase()}(${g.qubits[0]})`);
    else if (g.gate === "CX") lines.push(`qc.cx(${g.qubits[0]}, ${g.qubits[1]})`);
    else if (g.gate === "SWAP") lines.push(`qc.swap(${g.qubits[0]}, ${g.qubits[1]})`);
  }
  lines.push(`qc.measure(range(${n}), range(${n}))`);
  return lines.join("\n");
}

function aiConfigPresent() {
  return Boolean(process.env.QUANTUM_AI_API_KEY && process.env.QUANTUM_AI_API_URL);
}

async function callQuantumAI(messages, context = {}) {
  if (!aiConfigPresent()) {
    return {
      answer:
        "Quantum AI is ready, but its API key is not configured yet. Add QUANTUM_AI_API_KEY and QUANTUM_AI_API_URL to .env and restart the server.",
      configured: false
    };
  }

  const system = [
    "You are Quantum AI inside Q-BYTES, an educational quantum-computing platform.",
    "Be accurate, practical, and beginner-friendly.",
    "When discussing a circuit, distinguish exact simulator results from conceptual explanations.",
    "Do not invent hardware results.",
    `Current lab context: ${JSON.stringify(context)}`
  ].join("\n");

  const payload = {
    model: process.env.QUANTUM_AI_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
    messages: [
      { role: "system", content: system },
      ...messages
    ],
    temperature: 0.2,
    max_tokens: 1000
  };

  const apiUrl = process.env.QUANTUM_AI_API_URL.trim();
  const apiKey = process.env.QUANTUM_AI_API_KEY.trim();

  console.log("Quantum AI request:");
  console.log("URL:", apiUrl);
  console.log("Model:", payload.model);
  console.log("API key loaded:", Boolean(apiKey));

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Q-BYTES Quantum Learning Platform"
    },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text();

  let data = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    console.error("Non-JSON AI response:", rawText);
  }

  if (!response.ok) {
    console.error("OpenRouter error:", data);
    const msg =
      data?.error?.message ||
      data?.error ||
      rawText ||
      `AI provider returned HTTP ${response.status}`;

    throw new Error(String(msg));
  }

  console.log("OpenRouter response:", JSON.stringify(data, null, 2));

  const answer =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    data?.output_text ||
    data?.answer;

  if (!answer) {
    throw new Error(
      "OpenRouter returned a successful response, but no assistant text was found."
    );
  }

  return {
    answer: String(answer),
    configured: true,
    model: payload.model
  };
}

app.get("/api/health", (req,res) => {
  res.json({
    ok:true,
    service:"Q-BYTES backend",
    aiConfigured: aiConfigPresent(),
    time:new Date().toISOString()
  });
});

app.get("/api/quizzes", (req,res) => {
  const file = path.join(PUBLIC_DIR,"data","quizzes.json");
  const data = JSON.parse(fs.readFileSync(file,"utf8"));
  res.json(data);
});

app.post("/api/quiz/answer", (req,res) => {
  const {questionId, selectedIndex, correct} = req.body || {};
  const id = String(req.ip || "anonymous");
  const attempt = quizAttempts.get(id) || {answers:[], score:0};
  attempt.answers.push({questionId, selectedIndex, correct:Boolean(correct), at:Date.now()});
  if (correct) attempt.score++;
  quizAttempts.set(id, attempt);
  res.json({ok:true, recorded:true});
});

app.post("/api/quiz/submit", (req,res) => {
  const score = Number(req.body?.score || 0);
  const total = Number(req.body?.total || 0);
  res.json({
    ok:true,
    score,
    total,
    percentage: total ? Number((score/total*100).toFixed(1)) : 0
  });
});

app.post("/api/quantum/run", (req,res) => {
  try {
    const result = simulate(req.body?.qubits, req.body?.circuit, req.body?.shots, req.body?.mode);
    res.json({ok:true, result, code:qiskitCode(result.n,result.circuit)});
  } catch (e) {
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/quantum/optimize", (req,res) => {
  try {
    const n = clamp(Number(req.body?.qubits) || 2, 1, 4);
    const result = optimizeCircuit(req.body?.circuit, n);
    res.json({ok:true,...result,code:qiskitCode(n,result.circuit)});
  } catch (e) {
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/quantum-chat", async (req,res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-20) : [];
    const context = req.body?.context || {};
    const result = await callQuantumAI(messages, context);
    res.json(result);
  } catch (e) {
    res.status(502).json({error:e.message});
  }
});

app.post("/api/auth/email", (req,res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ok:false,error:"Please enter a valid email address."});
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token,{email,createdAt:Date.now()});
  res.json({
    ok:true,
    token,
    user:{email},
    message:"Demo sign-in session created. Connect an email provider before using this for real passwordless authentication."
  });
});

app.use(express.static(PUBLIC_DIR));

app.get("*", (req,res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({error:"API route not found"});
  res.sendFile(path.join(PUBLIC_DIR,"index.html"));
});

app.listen(PORT, () => {
  console.log(`Q-BYTES running at http://localhost:${PORT}`);
  console.log(`Quantum AI configured: ${aiConfigPresent() ? "yes" : "no (add key later)"}`);
});
