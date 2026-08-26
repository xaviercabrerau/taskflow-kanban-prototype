#!/usr/bin/env node

/**
 * Generate Test JWT Tokens Script
 *
 * Generates JWT tokens for test users created in Supabase.
 * These tokens are used for load testing and security testing.
 *
 * Usage:
 *   node scripts/generate-test-tokens.js
 *   node scripts/generate-test-tokens.js 5         # First 5 users
 *   node scripts/generate-test-tokens.js 20 TestPass123!@#  # Custom password
 *
 * Environment Variables:
 *   SUPABASE_URL      - Your Supabase project URL
 *   SUPABASE_ANON_KEY - Supabase anon key (for signInWithPassword)
 *
 * Reference: docs/LOAD_TEST_SETUP.md
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TOKEN_COUNT = parseInt(process.argv[2] || '5');
const PASSWORD = process.argv[3] || 'TestPass123!@#';
const EMAIL_DOMAIN = 'taskflow.local';

// Validation
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing environment variables:');
  console.error('   SUPABASE_URL');
  console.error('   SUPABASE_ANON_KEY');
  console.error('');
  console.error('Set these in .env.local or your shell:');
  console.error('   export SUPABASE_URL="https://your-project.supabase.co"');
  console.error('   export SUPABASE_ANON_KEY="your-anon-key"');
  process.exit(1);
}

if (TOKEN_COUNT < 1 || TOKEN_COUNT > 100) {
  console.error('❌ Token count must be between 1 and 100');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function generateTokens() {
  console.log('🔐 TaskFlow Test Token Generator');
  console.log('━'.repeat(50));
  console.log(`📝 Generating ${TOKEN_COUNT} JWT tokens...`);
  console.log(`🔐 Password: ${PASSWORD}`);
  console.log('');

  const tokens = [];
  const failedTokens = [];

  for (let i = 1; i <= TOKEN_COUNT; i++) {
    const email = `test-user-${i}@${EMAIL_DOMAIN}`;
    process.stdout.write(`[${i}/${TOKEN_COUNT}] Signing in ${email}... `);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: PASSWORD,
      });

      if (error) {
        throw error;
      }

      if (!data.session || !data.session.access_token) {
        throw new Error('No access token in response');
      }

      console.log('✓');
      tokens.push({
        user_index: i,
        email,
        access_token: data.session.access_token,
        token_type: data.session.token_type || 'Bearer',
        expires_at: new Date(data.session.expires_at * 1000).toISOString(),
        expires_in: data.session.expires_in || 3600,
      });
    } catch (error) {
      console.log('✗');
      failedTokens.push({
        email,
        error: error.message,
      });
    }
  }

  console.log('');
  console.log('━'.repeat(50));
  console.log('📈 Results:');
  console.log(`  ✓ Generated: ${tokens.length}`);
  console.log(`  ✗ Failed: ${failedTokens.length}`);
  console.log('');

  if (failedTokens.length > 0) {
    console.log('⚠️  Failed authentications:');
    failedTokens.forEach(({ email, error }) => {
      console.log(`  - ${email}: ${error}`);
    });
    console.log('');
  }

  if (tokens.length === 0) {
    console.error('❌ No tokens generated. Check:');
    console.error('  1. SUPABASE_URL is correct');
    console.error('  2. SUPABASE_ANON_KEY is correct');
    console.error('  3. Test users exist in Supabase');
    console.error('  4. Password matches test user password');
    return 1;
  }

  // Display first token for quick copy-paste
  console.log('🔑 Primary Token (for AUTH_TOKEN):');
  console.log(`   export AUTH_TOKEN="Bearer ${tokens[0].access_token}"`);
  console.log('');
  console.log(`   ⏰ Expires: ${tokens[0].expires_at}`);
  console.log('');

  // Display all tokens in a usable format
  console.log('🔗 All Generated Tokens:');
  tokens.forEach((token, index) => {
    console.log(`   # ${token.email}`);
    console.log(`   export AUTH_TOKEN_${index + 1}="Bearer ${token.access_token}"`);
  });
  console.log('');

  // Save tokens to file
  const tokensFile = 'test-tokens.json';
  const tokensData = {
    generated_at: new Date().toISOString(),
    password_used: PASSWORD,
    primary_token: `Bearer ${tokens[0].access_token}`,
    all_tokens: tokens,
    usage: {
      quick_start: `export AUTH_TOKEN="Bearer ${tokens[0].access_token}"`,
      load_test: './testing/run-load-tests.sh --scenario baseline',
      security_test: './testing/2-security-testing.sh',
    },
  };

  fs.writeFileSync(tokensFile, JSON.stringify(tokensData, null, 2));
  console.log(`💾 Tokens saved to: ${tokensFile}`);
  console.log('');

  // Print instructions
  console.log('📝 Next Steps:');
  console.log('  1. Copy the primary token:');
  console.log(`     export AUTH_TOKEN="Bearer ${tokens[0].access_token}"`);
  console.log('');
  console.log('  2. Run load test:');
  console.log('     ./testing/run-load-tests.sh --scenario baseline');
  console.log('');
  console.log('  3. Or run security tests:');
  console.log('     ./testing/2-security-testing.sh');
  console.log('');
  console.log('⚠️  Remember: Tokens expire in 1 hour');
  console.log('   Regenerate this script before running long tests');
  console.log('');
  console.log('📖 Reference: docs/LOAD_TEST_SETUP.md');
  console.log('');

  return 0;
}

// Run the script
generateTokens().then((exitCode) => {
  process.exit(exitCode);
}).catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
