import express from 'express';
import { investigateTicket } from '../src/investigator.js';
import { validateRequestSchema } from '../src/utils.js';

const app = express();

// Enable JSON body parsing with clean error handling for malformed JSON
app.use(express.json());

// GET /health
app.get('/health', (req, res) => {
  return res.status(200).json({ status: "ok" });
});

// POST /analyze-ticket
app.post('/analyze-ticket', async (req, res, next) => {
  try {
    // 1. Check schema validation
    const validation = validateRequestSchema(req.body);
    if (!validation.valid) {
      return res.status(validation.code).json({ error: validation.error });
    }

    // 2. Perform the ticket investigation
    const result = await investigateTicket(req.body);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// Route not found fallback
app.use((req, res) => {
  return res.status(404).json({ error: 'Not Found' });
});

// Global error handling middleware (never leaks stack traces or secrets)
app.use((err, req, res, next) => {
  // Catch express JSON parser syntax errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON input' });
  }

  console.error("Internal Application Error:", err.message);

  // Return a generic non-sensitive message
  return res.status(500).json({
    error: 'Internal Server Error'
  });
});

// Local runner - start server if not deployed as a Vercel serverless function
const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;
if (!isVercel) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[QueueStorm Investigator] Local server running on http://localhost:${PORT}`);
  });
}

export default app;
