# Q-BYTES — Full Stack Quantum Learning Platform

This package connects the supplied Q-BYTES frontend pages to a Node/Express backend.

## Included
- `public/index.html` — Q-BYTES landing page
- `public/game.html` — Quantum Games + flashcards
- `public/quiz.html` — 50-question quiz UI
- `public/lab/index.html` — Quantum Lab UI
- `public/lab/app.js` — Lab frontend connected to backend APIs
- `public/lab/style.css` — Lab styling
- `server.js` — API server
- `public/data/quizzes.json` — backend quiz dataset extracted from the supplied quiz page
- `.env.example` — secure configuration template

## Run
1. Install Node.js 18+.
2. Open this folder in a terminal.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Start with `npm start`.
6. Open `http://localhost:3000`.

## Quantum AI API key
Do NOT put the key in HTML or JavaScript.

1. Copy `.env.example` to `.env`.
2. Put your provider's OpenAI-compatible chat-completions endpoint in `QUANTUM_AI_API_URL`.
3. Put your secret key in `QUANTUM_AI_API_KEY`.
4. Put the model name in `QUANTUM_AI_MODEL`.
5. Restart `npm start` after changing `.env`.

Set:
- `QUANTUM_AI_API_URL`
- `QUANTUM_AI_API_KEY`
- `QUANTUM_AI_MODEL`

The backend sends `/api/quantum-chat` requests to the configured OpenAI-compatible chat-completions endpoint.

If no AI key is configured, the app remains usable in local/offline mode and the AI panel explains that configuration is missing.

## Backend endpoints
- `GET /api/health`
- `GET /api/quizzes`
- `POST /api/quiz/answer`
- `POST /api/quiz/submit`
- `POST /api/quantum/run`
- `POST /api/quantum/optimize`
- `POST /api/quantum-chat`
- `POST /api/auth/email`

The quantum simulator supports H, X, Y, Z, S, T, CX/CNOT and SWAP for 1–4 qubits, shot sampling, state amplitudes, and per-qubit Bloch vectors. The noisy mode applies configurable bit/phase noise to sampled results.

## Important
The current Google/GitHub buttons in the supplied landing page are UI placeholders. Real OAuth needs provider credentials and callback routes; those should be added only when you provide the OAuth configuration.
