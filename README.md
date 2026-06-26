# QueueStorm Investigator API Service

An AI-powered SupportOps copilot designed to help digital finance platforms investigate customer complaints, cross-reference tickets with transaction histories, route them to appropriate departments, and generate safe replies. Built as a lightweight, zero-dependency-bloat Node.js API service optimized for **Vercel Serverless Functions**.

Developed for the **bKash presents SUST CSE Carnival 2026 Codex Community Hackathon (Online Preliminary)**.

---

## 🛠️ Technology Stack & Architecture

- **Core Runtime:** Node.js (v18+ using native `fetch` to keep deployments extremely lightweight and prevent cold-start latency).
- **Framework:** Express.js (integrated as a single serverless function wrapper for identical local and production behavior).
- **Routing:** Configured via `vercel.json` rewrites to expose `/health` and `/analyze-ticket` endpoints at the root directory level.
- **Deployment Platform:** Vercel (Serverless Functions).

---

## 📂 Project Structure

```text
se/
├── .env.example              # Template for environment variables (API keys)
├── vercel.json               # Vercel deployment routing & rewrites configuration
├── package.json              # Project dependencies and script runner
├── README.md                 # Human-oriented documentation and runbook
├── AI_README.md              # Contextual instructions for AI copilots/assistants
├── api/
│   └── index.js              # Serverless entry point wrapping the Express application
└── src/
    ├── investigator.js       # Core investigator routing (Gemini/OpenAI call logic)
    ├── rules.js              # Heuristics rules engine and fallback analysis
    ├── prompt.js             # Specialized LLM system instructions and prompt builder
    └── utils.js              # Request validator and programmatic safety sanitizers
```

---

## 🚀 Setup & Local Execution

### Prerequisites
- Node.js version 18 or higher installed on your system.

### 1. Installation
Install the minimal dependencies (Express for API routing and Dotenv for local dev variables):
```bash
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root folder based on `.env.example`:
```bash
cp .env.example .env
```
Fill in the API keys for the LLM providers. **Note:** If no keys are provided, the application will automatically fall back to the heuristics rule engine, meaning it will function out-of-the-box without keys.

### 3. Run Locally
Start the server in development mode:
```bash
npm run dev
```
The server will start at `http://localhost:3000`.

---

## 🤖 Models & Cost Reasoning

This service implements a multi-tier hybrid decision engine:

1. **Gemini 1.5 Flash (Primary Model):**
   - **Why chosen:** Extremely fast response times, high safety alignment, and native support for structured JSON schema response formatting (`responseMimeType: "application/json"`).
   - **Cost Reasoning:** Outstanding cost efficiency ($0.075 / 1M input tokens) compared to larger LLMs, making it highly scalable for high-volume support queues.
2. **GPT-4o-mini (Secondary Fallback Model):**
   - **Why chosen:** Highly capable, low latency, and supports JSON mode (`type: "json_object"`).
3. **Local Heuristics Engine (Tertiary Fallback):**
   - **Why chosen:** Zero cost, runs entirely in memory without network requests, and ensures the API never crashes or timeouts if third-party LLM APIs are offline.

---

## 🛡️ Safety Logic & Security Guardrails

The service implements a **two-layered safety firewall** to strictly adhere to the challenge rules:

1. **Prompt-Level Guardrails:** The system instructions explicitly enforce restrictions against requesting credentials, making unauthorized refund promises, or directing users to third parties.
2. **Programmatic Sanitizer:** Every response (LLM-generated or fallback-generated) passes through the sanitizer in `src/utils.js` before returning to the client:
   - **Secret Requests Check:** If the response asks for PIN, OTP, CVV, or card numbers, the text is overridden with a generic security block, severity is upgraded to `critical`, and `human_review_required` is set to `true`.
   - **Refund Promising Check:** Rewrites direct refund assertions (e.g. *"we will refund you"*) to official safe language (e.g. *"any eligible amount will be returned through official channels"*).
   - **Third-Party Redirects:** Strips phone numbers and external URLs, replacing them with generic references to official channels.

---

## 📝 API Contract

### 1. Health Endpoint
**GET** `/health`
- **Response:** `200 OK`
- **Payload:** `{"status": "ok"}`

### 2. Analyze Ticket Endpoint
**POST** `/analyze-ticket`
- **Request Body (JSON):**
  ```json
  {
    "ticket_id": "TKT-001",
    "complaint": "I sent 5000 BDT to the wrong number. Help me reverse it.",
    "transaction_history": [
      {
        "transaction_id": "TXN-9101",
        "timestamp": "2026-04-14T14:08:22Z",
        "type": "transfer",
        "amount": 5000,
        "counterparty": "+8801719876543",
        "status": "completed"
      }
    ]
  }
  ```
- **Response Shape (JSON):**
  ```json
  {
    "ticket_id": "TKT-001",
    "relevant_transaction_id": "TXN-9101",
    "evidence_verdict": "consistent",
    "case_type": "wrong_transfer",
    "severity": "high",
    "department": "dispute_resolution",
    "agent_summary": "Customer reports wrong transfer...",
    "recommended_next_action": "Verify wrong transfer details...",
    "customer_reply": "We have noted your concern regarding...",
    "human_review_required": true,
    "confidence": 0.9,
    "reason_codes": ["wrong_transfer", "transaction_match"]
  }
  ```

---

## ⚡ Deployment to Vercel

To deploy the project to Vercel, run the following command using the Vercel CLI from the root folder:
```bash
vercel
```
Or connect the repository to your Vercel Dashboard for automated Git integration. Ensure your environment variables (`GEMINI_API_KEY`, `OPENAI_API_KEY`) are set in the Vercel project configuration dashboard.
