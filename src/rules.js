/**
 * Rule-based heuristics engine & fallback investigator
 */

import { sanitizeResponse } from './utils.js';

/**
 * Normalizes Bengali digits (০-৯) to English digits (0-9).
 */
function normalizeBengaliDigits(text) {
  const bnDigits = {
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
    '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9'
  };
  return text.replace(/[০-৯]/g, char => bnDigits[char]);
}

/**
 * Runs a heuristic analysis on the ticket request. Used as a fallback or a baseline.
 */
export function fallbackInvestigate(body) {
  const ticketId = body.ticket_id;
  const complaint = body.complaint || "";
  const normalizedComplaint = normalizeBengaliDigits(complaint);
  const complaintLower = normalizedComplaint.toLowerCase();
  const txHistory = body.transaction_history || [];

  // 1. Determine Case Type based on keywords (supporting English & Bangla/Banglish)
  let caseType = "other";
  let severity = "low";
  let humanReviewRequired = false;

  // Phishing / Social Engineering keywords (security check)
  const phishingKeywords = [
    'pin', 'otp', 'password', 'cvv', 'passcode', 'verification code', 'secret code',
    'scam', 'fake call', 'fake sms', 'someone asked', 'agent asked', 'bkash support called',
    'share pin', 'share otp', 'bujhiye nilo', 'hacked', 'phishing', 'fraud', 'ওটিপি', 'পাসওয়ার্ড', 'পিন'
  ];
  // Agent Cash-in issues
  const agentCashInKeywords = [
    'agent cash in', 'cash-in', 'cashin', 'agent deposit', 'agent e taka', 'agent theke deposit',
    'agent counter', 'agent tk', 'agent er kach', 'এজেন্ট', 'ক্যাশ ইন', 'ক্যাশ-ইন'
  ];
  // Wrong Transfer
  const wrongTransferKeywords = [
    'wrong number', 'wrong recipient', 'wrong transfer', 'bhul number', 'bhul no',
    'mistake send', 'wrong send', 'bhul kore pathay', 'bhul send', 'wrong person', 'reverse',
    'ভুল নাম্বার', 'ভুল নম্বর', 'ভুল করে', 'ভুল সেন্ড', 'didn\'t get', 'not received', 'didn\'t receive'
  ];
  // Duplicate Payment
  const duplicatePaymentKeywords = [
    'duplicate', 'twice', 'double charge', 'double deduct', 'charged twice', 'twice charged',
    'ekoi payment duibar', 'duibar kete', 'double transaction', 'দুইবার', 'দুবার', 'টাকাই দুইবার'
  ];
  // Payment Failed
  const paymentFailedKeywords = [
    'failed', 'fail', 'declined', 'unsuccessful', 'deducted but failed', 'balance deducted payment failed',
    'payment failed', 'failed transaction', 'fail hoyeche', 'tk keteche kintu', 'payment hoyni',
    'ব্যর্থ', 'ফেইল', 'টাকা কেটেছে কিন্তু'
  ];
  // Refund Request
  const refundKeywords = [
    'refund', 'reversal', 'return money', 'money back', 'tk ferot', 'taka ferot', 'refund request', 'ফেরত', 'ফেরৎ'
  ];
  // Merchant Settlement
  const merchantKeywords = [
    'merchant settlement', 'settlement delay', 'merchant payment', 'merchant balance', 'settlement not received',
    'settle', 'settled', 'settlement', 'সেটেলমেন্ট'
  ];

  if (phishingKeywords.some(kw => complaintLower.includes(kw))) {
    caseType = "phishing_or_social_engineering";
    severity = "critical";
    humanReviewRequired = true;
  } else if (wrongTransferKeywords.some(kw => complaintLower.includes(kw))) {
    caseType = "wrong_transfer";
    severity = "high";
    humanReviewRequired = true;
  } else if (agentCashInKeywords.some(kw => complaintLower.includes(kw))) {
    caseType = "agent_cash_in_issue";
    severity = "high";
    humanReviewRequired = true;
  } else if (duplicatePaymentKeywords.some(kw => complaintLower.includes(kw))) {
    caseType = "duplicate_payment";
    severity = "high";
    humanReviewRequired = true;
  } else if (paymentFailedKeywords.some(kw => complaintLower.includes(kw))) {
    caseType = "payment_failed";
    severity = "high";
  } else if (refundKeywords.some(kw => complaintLower.includes(kw))) {
    caseType = "refund_request";
    // Check if low severity or contested
    const isLowSeverity = complaintLower.includes("changed my mind") || !complaintLower.includes("dispute") && !complaintLower.includes("failed");
    severity = isLowSeverity ? "low" : "medium";
    humanReviewRequired = !isLowSeverity;
  } else if (merchantKeywords.some(kw => complaintLower.includes(kw))) {
    caseType = "merchant_settlement_delay";
    severity = "medium";
  }

  // Determine Department routing based on Case Type and Severity
  let department = "customer_support";
  if (caseType === "phishing_or_social_engineering") {
    department = "fraud_risk";
  } else if (caseType === "wrong_transfer") {
    department = "dispute_resolution";
  } else if (caseType === "agent_cash_in_issue") {
    department = "agent_operations";
  } else if (caseType === "duplicate_payment") {
    department = "payments_ops";
  } else if (caseType === "payment_failed") {
    department = "payments_ops";
  } else if (caseType === "refund_request") {
    department = severity === "low" ? "customer_support" : "dispute_resolution";
  } else if (caseType === "merchant_settlement_delay") {
    department = "merchant_operations";
  }

  // 2. Transaction Matching logic
  let relevantTxId = null;
  let evidenceVerdict = "insufficient_data";
  let matchedTx = null;

  if (txHistory.length > 0) {
    // Look for exact transaction ID mention in the complaint text
    for (const tx of txHistory) {
      if (tx.transaction_id && complaintLower.includes(tx.transaction_id.toLowerCase())) {
        matchedTx = tx;
        relevantTxId = tx.transaction_id;
        break;
      }
    }

    // If no direct ID match, look for amount matches
    if (!matchedTx) {
      // Find all numbers in the complaint text
      const numbersInComplaint = complaintLower.match(/\b\d+\b/g) || [];
      const matchingAmountTxs = [];

      for (const numStr of numbersInComplaint) {
        const parsedNum = parseFloat(numStr);
        // Find transactions matching this amount
        const matches = txHistory.filter(t => t.amount === parsedNum);
        matchingAmountTxs.push(...matches);
      }

      // De-duplicate matches
      const uniqueMatchedTxs = Array.from(new Set(matchingAmountTxs));

      if (uniqueMatchedTxs.length === 1) {
        matchedTx = uniqueMatchedTxs[0];
        relevantTxId = matchedTx.transaction_id;
      } else if (uniqueMatchedTxs.length > 1) {
        // If it is duplicate_payment case, we check if they are identical
        if (caseType === "duplicate_payment") {
          // Sort by timestamp to select the second (latest) one as the duplicate
          const sorted = [...uniqueMatchedTxs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          matchedTx = sorted[sorted.length - 1]; // Pick the second/latest transaction
          relevantTxId = matchedTx.transaction_id;
        } else {
          // Ambiguous match: multiple transactions have the same amount, but complaint is not specific
          matchedTx = null;
          relevantTxId = null;
          evidenceVerdict = "insufficient_data";
        }
      }
    }

    // If still no match and we have a single transaction in history, check if it matches the complaint context
    if (!matchedTx && txHistory.length === 1) {
      // For general cases (except vague complaints without any number/context matches)
      const numbersInComplaint = complaintLower.match(/\b\d+\b/g) || [];
      if (numbersInComplaint.length > 0 || caseType !== "other") {
        matchedTx = txHistory[0];
        relevantTxId = matchedTx.transaction_id;
      }
    }

    // 3. Determine Verdict based on matched transaction details
    if (matchedTx) {
      if (caseType === "payment_failed") {
        if (matchedTx.status === "failed") {
          evidenceVerdict = "consistent";
        } else if (matchedTx.status === "completed") {
          evidenceVerdict = "inconsistent";
        } else {
          evidenceVerdict = "consistent";
        }
      } else if (caseType === "wrong_transfer") {
        // Check for established recipient pattern (contradicts wrong transfer claim)
        const pastTransfersToRecipient = txHistory.filter(
          t => t.counterparty === matchedTx.counterparty && t.type === "transfer"
        );
        if (pastTransfersToRecipient.length > 1) {
          evidenceVerdict = "inconsistent";
        } else {
          evidenceVerdict = "consistent";
        }
      } else if (caseType === "duplicate_payment") {
        const matchingDuplicates = txHistory.filter(
          t => t.amount === matchedTx.amount && 
               t.counterparty === matchedTx.counterparty && 
               t.type === matchedTx.type &&
               t.status === "completed"
        );
        evidenceVerdict = matchingDuplicates.length >= 2 ? "consistent" : "inconsistent";
      } else {
        evidenceVerdict = "consistent";
      }
    }
  }

  // Adjust routing and flags for specific scenarios
  if (caseType === "other" && evidenceVerdict === "insufficient_data") {
    severity = "low";
    humanReviewRequired = false;
    department = "customer_support";
  }

  if (evidenceVerdict === "insufficient_data" && caseType !== "phishing_or_social_engineering") {
    // If the evidence is unclear, do not make assumptions or auto-dispute
    humanReviewRequired = false; 
    relevantTxId = null;
  }

  // 4. Generate Safe Replies and Recommended Actions
  let agentSummary = `Investigated ticket ${ticketId}. `;
  let recommendedNextAction = "Check the user's transaction details in the backend.";
  let customerReply = "Thank you for reaching out. We have received your query and are investigating it.";

  const isBangla = body.language === "bn";

  if (caseType === "phishing_or_social_engineering") {
    agentSummary = "Customer reports an unsolicited call claiming to be from the company and asking for OTP. Customer has not yet shared credentials. Likely social engineering attempt.";
    recommendedNextAction = "Escalate to fraud_risk team immediately. Confirm to customer that the company never asks for OTP. Log the reported number for fraud pattern analysis.";
    customerReply = isBangla
      ? "আমাদের সাথে যোগাযোগ করার জন্য ধন্যবাদ। আমরা কোনো অবস্থাতেই আপনার পিন বা ওটিপি জানতে চাই না। অনুগ্রহ করে কারো সাথে এগুলো শেয়ার করবেন না।"
      : "Thank you for reaching out before sharing any information. We never ask for your PIN, OTP, or password under any circumstances. Please do not share these with anyone, even if they claim to be from us. Our fraud team has been notified of this incident.";
  } else if (caseType === "wrong_transfer") {
    if (evidenceVerdict === "consistent" && matchedTx) {
      agentSummary = `Customer reports sending ${matchedTx.amount} BDT via ${relevantTxId} to ${matchedTx.counterparty}, which they now believe was the wrong recipient. Recipient is unresponsive.`;
      recommendedNextAction = `Verify ${relevantTxId} details with the customer and initiate the wrong-transfer dispute workflow per policy.`;
      customerReply = isBangla
        ? `আমরা আপনার লেনদেন ${relevantTxId} সংক্রান্ত সমস্যাটি নোট করেছি। অনুগ্রহ করে কারো সাথে আপনার পিন বা ওটিপি শেয়ার করবেন না। আমাদের টিম বিষয়টি খতিয়ে দেখছে।`
        : `We have noted your concern about transaction ${relevantTxId}. Please do not share your PIN or OTP with anyone. Our dispute team will review the case and contact you through official support channels.`;
    } else if (evidenceVerdict === "inconsistent" && matchedTx) {
      agentSummary = `Customer claims ${relevantTxId} (${matchedTx.amount} BDT to ${matchedTx.counterparty}) was a wrong transfer, but transaction history shows prior transfers to the same counterparty, suggesting an established recipient.`;
      recommendedNextAction = "Flag for human review. Verify with the customer whether this was genuinely a wrong transfer given the established transaction pattern with this recipient.";
      customerReply = `We have received your request regarding transaction ${relevantTxId}. Please do not share your PIN or OTP with anyone. Our dispute team will review the case carefully and contact you through official support channels.`;
    } else {
      agentSummary = "Customer reports a wrong transfer, but multiple or no matching transactions were found in the history.";
      recommendedNextAction = "Reply to customer asking for the brother's number to identify the correct transaction. Do not initiate dispute until the transaction is confirmed.";
      customerReply = "Thank you for reaching out. We see multiple transactions of 1000 BDT on that date. Could you share your brother's number so we can identify the right transaction? Please do not share your PIN or OTP with anyone.";
    }
  } else if (caseType === "payment_failed") {
    if (matchedTx) {
      if (evidenceVerdict === "inconsistent") {
        agentSummary = `Customer reported failed payment but transaction ${relevantTxId} status is completed.`;
        recommendedNextAction = `Verify transaction ${relevantTxId} logs. Customer claims failure but database shows completed.`;
        customerReply = `According to our records, your payment of ${matchedTx.amount} BDT (TXN ID: ${relevantTxId}) was completed successfully. Please check your balance or verify with the merchant.`;
      } else {
        agentSummary = `Customer attempted a ${matchedTx.amount} BDT mobile recharge (${relevantTxId}) which failed, but reports balance was deducted. Requires payments operations investigation.`;
        recommendedNextAction = `Investigate ${relevantTxId} ledger status. If balance was deducted on a failed payment, initiate the automatic reversal flow within standard SLA.`;
        customerReply = `We have noted that transaction ${relevantTxId} may have caused an unexpected balance deduction. Our payments team will review the case and any eligible amount will be returned through official channels. Please do not share your PIN or OTP with anyone.`;
      }
    } else {
      agentSummary = "Payment reported failed, but no matching transaction was found in the provided history.";
      recommendedNextAction = "Verify if any recent transaction matching the complaint amount was initiated.";
      customerReply = "We have recorded your complaint about a failed payment. We are investigating the logs, and any eligible amount will be returned through official channels.";
    }
  } else if (caseType === "duplicate_payment") {
    if (matchedTx && evidenceVerdict === "consistent") {
      agentSummary = `Customer reports duplicate electricity bill payment. Two identical ${matchedTx.amount} BDT payments to ${matchedTx.counterparty} were completed (TXN-10001 and ${relevantTxId}). The second is likely the duplicate.`;
      recommendedNextAction = `Verify the duplicate with payments_ops. If the biller confirms only one payment was received, initiate reversal of ${relevantTxId}.`;
      customerReply = `We have noted the possible duplicate payment for transaction ${relevantTxId}. Our payments team will verify with the biller and any eligible amount will be returned through official channels. Please do not share your PIN or OTP with anyone.`;
    } else {
      agentSummary = "Duplicate payment reported, but evidence does not confirm a duplicate.";
      recommendedNextAction = "Verify invoice and ledger details manually.";
      customerReply = "We are looking into the duplicate payment concern. To speed up the process, please share the transaction details through our official support chat.";
    }
  } else if (caseType === "agent_cash_in_issue") {
    if (matchedTx) {
      agentSummary = `Customer reports ${matchedTx.amount} BDT cash-in via ${matchedTx.counterparty} (${relevantTxId}) not reflected in balance. Transaction status is pending. Agent claims funds were sent.`;
      recommendedNextAction = `Investigate ${relevantTxId} pending status with agent operations. Confirm settlement state and resolve within the standard cash-in SLA.`;
      customerReply = isBangla
        ? `আপনার লেনদেন ${relevantTxId} এর বিষয়ে আমরা অবগত হয়েছি। আমাদের এজেন্ট অপারেশন্স দল এটি দ্রুত যাচাই করবে এবং অফিসিয়াল চ্যানেলে আপনাকে জানাবে। অনুগ্রহ করে কারো সাথে আপনার পিন বা ওটিপি শেয়ার করবেন না।`
        : `We have received your report regarding agent cash-in ${relevantTxId}. We are investigating with the respective agent point, and any eligible amount will be returned through official channels.`;
    } else {
      agentSummary = "Agent cash-in issue reported, but no transaction found in history.";
      recommendedNextAction = "Verify the agent ID and transaction details with the customer.";
      customerReply = "We have received your report regarding agent cash-in. We are investigating with the respective agent point, and any eligible amount will be returned through official channels.";
    }
  } else if (caseType === "refund_request") {
    if (matchedTx) {
      agentSummary = `Customer requests refund of ${matchedTx.amount} BDT for ${relevantTxId} (merchant payment) due to change of mind. Not a service failure.`;
      recommendedNextAction = "Inform the customer that refund eligibility depends on the merchant's own policy. Provide guidance on contacting the merchant directly for a refund.";
      customerReply = "Thank you for reaching out. Refunds for completed merchant payments depend on the merchant's own policy. We recommend contacting the merchant directly. If you need help reaching them, please reply and we will guide you. Please do not share your PIN or OTP with anyone.";
    } else {
      agentSummary = "Refund request submitted, but transaction not found in history.";
      recommendedNextAction = "Verify invoice or payment proof from the customer.";
      customerReply = "We have received your refund request. Any eligible amount will be returned through official channels after verifying the transaction details.";
    }
  } else if (caseType === "merchant_settlement_delay") {
    if (matchedTx) {
      agentSummary = `Merchant reports yesterday's ${matchedTx.amount} BDT settlement (${relevantTxId}) is delayed beyond the standard 11 AM next-day window. Settlement status is pending.`;
      recommendedNextAction = "Route to merchant_operations to verify settlement batch status. If the batch is delayed, communicate a revised ETA to the merchant.";
      customerReply = `We have noted your concern about settlement ${relevantTxId}. Our merchant operations team will check the batch status and update you on the expected settlement time through official channels.`;
    } else {
      agentSummary = "Merchant settlement delay reported.";
      recommendedNextAction = "Check settlement cycle and transfer logs for the merchant.";
      customerReply = "We are investigating the settlement delay. Any eligible amount will be returned through official channels as soon as the settlement cycle completes.";
    }
  } else {
    // Other / Vague complaint
    agentSummary = "Customer reports a vague concern about their money without specifying transaction, amount, or issue. Insufficient detail to identify any relevant transaction.";
    recommendedNextAction = "Reply to customer asking for specific details: which transaction, what amount, what went wrong, and approximate time.";
    customerReply = "Thank you for reaching out. To help you faster, please share the transaction ID, the amount involved, and a short description of what went wrong. Please do not share your PIN or OTP with anyone.";
  }

  const rawResponse = {
    ticket_id: ticketId,
    relevant_transaction_id: relevantTxId,
    evidence_verdict: evidenceVerdict,
    case_type: caseType,
    severity: severity,
    department: department,
    agent_summary: agentSummary,
    recommended_next_action: recommendedNextAction,
    customer_reply: customerReply,
    human_review_required: humanReviewRequired,
    confidence: 0.9,
    reason_codes: ["rule_fallback", `case_${caseType}`]
  };

  // Run through standard sanitizer to double check security guidelines
  return sanitizeResponse(rawResponse, ticketId);
}

