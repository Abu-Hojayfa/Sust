import fs from 'fs';
import path from 'path';
import app from './api/index.js';

const PORT = 3005;

async function runTests() {
  console.log("Starting test runner...");

  // Start local server programmatically
  const server = app.listen(PORT, async () => {
    console.log(`Test server running on port ${PORT}`);

    try {
      // Read the sample cases JSON file
      const sampleCasesPath = path.resolve('SUST_Preli_Sample_Cases.json');
      if (!fs.existsSync(sampleCasesPath)) {
        console.error("Could not find SUST_Preli_Sample_Cases.json!");
        server.close();
        process.exit(1);
      }

      const rawData = fs.readFileSync(sampleCasesPath, 'utf8');
      const data = JSON.parse(rawData);
      const cases = data.cases;

      console.log(`Loaded ${cases.length} sample cases for verification.\n`);

      let passedCount = 0;
      let failedCount = 0;

      for (const testCase of cases) {
        console.log(`--------------------------------------------------`);
        console.log(`Testing Case ${testCase.id}: "${testCase.label}"`);

        const response = await fetch(`http://localhost:${PORT}/analyze-ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testCase.input)
        });

        if (!response.ok) {
          console.error(`❌ Request failed with status ${response.status}`);
          failedCount++;
          continue;
        }

        const result = await response.json();
        const expected = testCase.expected_output;

        // Perform assertions
        const assertions = [
          { name: 'relevant_transaction_id', actual: result.relevant_transaction_id, expected: expected.relevant_transaction_id },
          { name: 'evidence_verdict', actual: result.evidence_verdict, expected: expected.evidence_verdict },
          { name: 'case_type', actual: result.case_type, expected: expected.case_type },
          { name: 'department', actual: result.department, expected: expected.department },
          { name: 'human_review_required', actual: result.human_review_required, expected: expected.human_review_required }
        ];

        let caseFailed = false;
        for (const assertion of assertions) {
          if (assertion.actual !== assertion.expected) {
            console.error(`  ❌ Mismatch on ${assertion.name}: expected "${assertion.expected}", got "${assertion.actual}"`);
            caseFailed = true;
          }
        }

        // Basic verification of the customer reply for security (PIN/OTP check)
        const secretsRegex = /(?:ask|give|send|share|provide|tell|input|enter|write|verify|confirm)\s+(?:us\s+)?(?:your\s+)?(?:pin|otp|password|cvv|passcode|secret\s*key|card\s*number)/i;
        if (secretsRegex.test(result.customer_reply)) {
          const isWarning = /do\s+not\s+share|don't\s+share|never\s+share|security\s+reasons/i.test(result.customer_reply);
          if (!isWarning) {
            console.error("  ❌ SECURITY VIOLATION: customer_reply requests credentials!");
            caseFailed = true;
          }
        }

        if (caseFailed) {
          failedCount++;
        } else {
          console.log(`  ✅ Passed!`);
          passedCount++;
        }
      }

      console.log(`\n==================================================`);
      console.log(`Test Execution Summary:`);
      console.log(`Passed: ${passedCount}/${cases.length}`);
      console.log(`Failed: ${failedCount}/${cases.length}`);
      console.log(`==================================================`);

      server.close();
      if (failedCount > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    } catch (err) {
      console.error("Error running tests:", err);
      server.close();
      process.exit(1);
    }
  });
}

runTests();
