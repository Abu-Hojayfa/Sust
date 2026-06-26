/**
 * Request validation and response sanitization utilities
 */

/**
 * Validates the incoming ticket request schema.
 * Returns { valid: true } or { valid: false, code: HTTP_CODE, error: string }
 */
export function validateRequestSchema(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      code: 400,
      error: 'Request body must be a JSON object'
    };
  }

  // Check required fields
  if (body.ticket_id === undefined || body.ticket_id === null) {
    return {
      valid: false,
      code: 400,
      error: 'Missing required field: ticket_id'
    };
  }

  if (typeof body.ticket_id !== 'string') {
    return {
      valid: false,
      code: 422,
      error: 'ticket_id must be a string'
    };
  }

  if (body.ticket_id.trim() === '') {
    return {
      valid: false,
      code: 422,
      error: 'ticket_id cannot be empty'
    };
  }

  if (body.complaint === undefined || body.complaint === null) {
    return {
      valid: false,
      code: 400,
      error: 'Missing required field: complaint'
    };
  }

  if (typeof body.complaint !== 'string') {
    return {
      valid: false,
      code: 422,
      error: 'complaint must be a string'
    };
  }

  if (body.complaint.trim() === '') {
    return {
      valid: false,
      code: 422,
      error: 'complaint cannot be empty'
    };
  }

  // Validate transaction_history if provided
  if (body.transaction_history !== undefined && body.transaction_history !== null) {
    if (!Array.isArray(body.transaction_history)) {
      return {
        valid: false,
        code: 422,
        error: 'transaction_history must be an array'
      };
    }

    for (let i = 0; i < body.transaction_history.length; i++) {
      const tx = body.transaction_history[i];
      if (!tx || typeof tx !== 'object' || Array.isArray(tx)) {
        return {
          valid: false,
          code: 422,
          error: `transaction_history[${i}] must be an object`
        };
      }

      const requiredTxFields = ['transaction_id', 'timestamp', 'type', 'amount', 'counterparty', 'status'];
      for (const field of requiredTxFields) {
        if (tx[field] === undefined || tx[field] === null) {
          return {
            valid: false,
            code: 422,
            error: `transaction_history[${i}] is missing required field: ${field}`
          };
        }
      }

      if (typeof tx.amount !== 'number') {
        return {
          valid: false,
          code: 422,
          error: `transaction_history[${i}].amount must be a number`
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Programmatically sanitizes outputs to enforce the safety rules (Section 8)
 * even if the LLM produces a hallucinated response or suffers a prompt injection.
 */
export function sanitizeResponse(response, ticketId) {
  // Ensure basic response structure
  const result = {
    ticket_id: ticketId || response.ticket_id || "",
    relevant_transaction_id: response.relevant_transaction_id !== undefined ? response.relevant_transaction_id : null,
    evidence_verdict: response.evidence_verdict || "insufficient_data",
    case_type: response.case_type || "other",
    severity: response.severity || "medium",
    department: response.department || "customer_support",
    agent_summary: response.agent_summary || "No summary available.",
    recommended_next_action: response.recommended_next_action || "Investigate the customer complaint.",
    customer_reply: response.customer_reply || "Thank you for contacting customer support. We are looking into your query.",
    human_review_required: response.human_review_required !== undefined ? !!response.human_review_required : true,
    confidence: typeof response.confidence === 'number' ? response.confidence : 0.8,
    reason_codes: Array.isArray(response.reason_codes) ? response.reason_codes : []
  };

  // 1. PIN / OTP / Password safety check (Rule 1: Never ask for secrets)
  // Look for any request for credentials
  const secretsRegex = /(?:ask|give|send|share|provide|tell|input|enter|write|verify|confirm)\s+(?:us\s+)?(?:your\s+)?(?:pin|otp|password|cvv|passcode|secret\s*key|card\s*number|card\s*no)/i;
  
  if (secretsRegex.test(result.customer_reply)) {
    const isWarning = /do\s+not\s+share|don't\s+share|never\s+share|security\s+reasons/i.test(result.customer_reply);
    if (!isWarning) {
      result.customer_reply = "For security reasons, we will never ask for your PIN, OTP, password, or full card details. Your issue has been escalated to our team for secure review.";
      result.human_review_required = true;
      result.severity = "critical";
      if (!result.reason_codes.includes("safety_violation_mitigated")) {
        result.reason_codes.push("safety_violation_mitigated");
      }
    }
  }

  // 2. Refund / Reversal / Unblock authority check (Rule 2: Never confirm a refund or reversal without authority)
  // Replace direct refund/reversal confirmations with safe official language
  const refundConfirmRegex = /(?:refund(?:ed)?\s+you|we\s+will\s+refund|refund\s+is\s+confirmed|money\s+will\s+be\s+refunded|reversal?\s+(?:is|has\s+been)\s+(?:completed|confirmed|done)|will\s+reverse|account\s+(?:is|has\s+been)\s+(?:unblocked|recovered|activated|restored))/i;
  
  // We sanitize both customer_reply and recommended_next_action
  if (refundConfirmRegex.test(result.customer_reply) || refundConfirmRegex.test(result.recommended_next_action)) {
    // Helper function to substitute direct confirmation with safe phrasing
    const substituteSafeRefundLanguage = (text) => {
      let temp = text;
      // Replace variations of "we will refund you", "we refunded you"
      temp = temp.replace(/we\s+(?:will|have)\s+refund(?:ed)?(?:\s+you)?/ig, "any eligible amount will be returned through official channels");
      temp = temp.replace(/refund\s+is\s+confirmed/ig, "any eligible amount will be returned through official channels");
      temp = temp.replace(/we\s+will\s+reverse/ig, "any eligible amount will be returned through official channels");
      temp = temp.replace(/reversal\s+(?:is|has\s+been)\s+(?:completed|confirmed|done)/ig, "any eligible amount will be returned through official channels");
      temp = temp.replace(/(?:unblock|recover|activate|restore)\s+your\s+account/ig, "process your request through official support channels");
      temp = temp.replace(/account\s+(?:is|has\s+been)\s+(?:unblocked|recovered|activated|restored)/ig, "account status is being reviewed through official support channels");
      
      // Secondary check: if it still has refund/reversal assurances, do a direct override
      if (refundConfirmRegex.test(temp)) {
        return "We have logged your request. Any eligible amount will be returned through official channels after verification.";
      }
      return temp;
    };

    result.customer_reply = substituteSafeRefundLanguage(result.customer_reply);
    result.recommended_next_action = substituteSafeRefundLanguage(result.recommended_next_action);
    
    if (!result.reason_codes.includes("refund_authority_mitigated")) {
      result.reason_codes.push("refund_authority_mitigated");
    }
  }

  // 3. Third party redirects check (Rule 3: Never direct to suspicious third parties)
  // Direct customers only to official support channels. Let's scan for any non-official links or phone numbers.
  // We allow the official Sust / bKash or local system indicators if any, but replace other links/phones.
  const externalLinkRegex = /https?:\/\/(?!(?:[a-zA-Z0-9-]+\.)*(?:bkash\.com|sust\.edu))(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b[^\s]*/gi;
  // Match generic international/local phone numbers that aren't typical official shortcodes
  const phoneRegex = /\+?(?:880|01)\d{9,11}\b|\+?\d{10,15}\b/g;

  if (externalLinkRegex.test(result.customer_reply)) {
    result.customer_reply = result.customer_reply.replace(externalLinkRegex, "our official support website");
    if (!result.reason_codes.includes("third_party_redirection_mitigated")) {
      result.reason_codes.push("third_party_redirection_mitigated");
    }
  }

  // We replace generic phone numbers in reply unless it's a known short code (like 16247 for bKash)
  if (phoneRegex.test(result.customer_reply)) {
    result.customer_reply = result.customer_reply.replace(phoneRegex, (match) => {
      if (match.includes("16247")) return match; // Keep official bKash hotline
      return "our official support hotline";
    });
    if (!result.reason_codes.includes("third_party_redirection_mitigated")) {
      result.reason_codes.push("third_party_redirection_mitigated");
    }
  }

  return result;
}
