#!/usr/bin/env node

/**
 * Generate Test Users Script
 *
 * Creates multiple test users in Supabase for load testing.
 *
 * Usage:
 *   node scripts/generate-test-users.js [count] [password]
 *
 * Examples:
 *   node scripts/generate-test-users.js              # Creates 10 users
 *   node scripts/generate-test-users.js 50           # Creates 50 users
 *   node scripts/generate-test-users.js 50 "MyPass123"  # Custom password
 *
 * Environment Variables:
 *   SUPABASE_URL         - Your Supabase project URL
 *   SUPABASE_ANON_KEY    - Supabase anon key
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (for creating users)
 *
 * Reference: docs/LOAD_TEST_SETUP.md
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_COUNT = parseInt(process.argv[2] || '10');
const PASSWORD = process.argv[3] || 'TestPass123!@#';
const EMAIL_DOMAIN = 'taskflow.local';

// Validation
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing environment variables:');
  console.error('   SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  console.error('');
  console.error('Set these in .env.local or your shell:');
  console.error('   export SUPABASE_URL="your-project.supabase.co"');
  console.error('   export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"');
  process.exit(1);
}

if (USER_COUNT < 1 || USER_COUNT > 1000) {
  console.error('❌ User count must be between 1 and 1000');
  process.exit(1);
}

// Initialize Supabase admin client (requires service role key)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function generateTestUsers() {
  console.log('🔧 TaskFlow Test User Generator');
  console.log('━'.repeat(50));
  console.log(`📊 Creating ${USER_COUNT} test users...`);
  console.log(`🔐 Password: ${PASSWORD}`);
  console.log(`📧 Email domain: ${EMAIL_DOMAIN}`);
  console.log('');

  const createdUsers = [];
  const failedUsers = [];
  let successCount = 0;

  for (let i = 1; i <= USER_COUNT; i++) {
    const email = `test-user-${i}@${EMAIL_DOMAIN}`;
    process.stdout.write(`[${i}/${USER_COUNT}] Creating ${email}... `);

    try {
      // Create user via Supabase admin API
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true, // Auto-confirm email to avoid verification
        user_metadata: {
          name: `Test User ${i}`,
          role: i === 1 ? 'owner' : 'member', // First user is owner
        },
      });

      if (error) {
        if (error.message.includes('already exists')) {
          console.log('✓ (already exists)');
        } else {
          throw error;
        }
      } else {
        console.log('✓');
        createdUsers.push({
          id: data.user.id,
          email: data.user.email,
          created_at: data.user.created_at,
        });
        successCount++;
      }
    } catch (error) {
      console.log('✗');
      failedUsers.push({
        email,
        error: error.message,
      });
    }
  }

  console.log('');
  console.log('━'.repeat(50));
  console.log('📈 Results:');
  console.log(`  ✓ Created: ${successCount}`);
  console.log(`  ✗ Failed: ${failedUsers.length}`);
  console.log('');

  if (failedUsers.length > 0) {
    console.log('⚠️  Failed users:');
    failedUsers.forEach(({ email, error }) => {
      console.log(`  - ${email}: ${error}`);
    });
    console.log('');
  }

  // Save credentials to file
  if (createdUsers.length > 0) {
    const credentialsFile = 'test-users-credentials.json';
    const credentials = {
      generated_at: new Date().toISOString(),
      password: PASSWORD,
      users: createdUsers,
      usage: {
        environment_variables: {
          AUTH_TOKEN: 'Bearer {generate with: node scripts/generate-test-tokens.js}',
          TEST_USER_ID: createdUsers[0].id,
          BASE_URL: 'http://localhost:3000',
        },
        next_step: 'Run: node scripts/generate-test-tokens.js',
      },
    };

    fs.writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2));
    console.log(`💾 Credentials saved to: ${credentialsFile}`);
    console.log('');
  }

  // Print instructions
  console.log('📝 Next Steps:');
  console.log('  1. Generate JWT tokens:');
  console.log('     node scripts/generate-test-tokens.js');
  console.log('');
  console.log('  2. Set environment variable:');
  console.log(`     export AUTH_TOKEN="Bearer <token-from-step-1>"`);
  console.log(`     export TEST_USER_ID="${createdUsers[0]?.id || 'user-id-here'}"`);
  console.log('');
  console.log('  3. Run load tests:');
  console.log('     ./testing/run-load-tests.sh --scenario baseline');
  console.log('');
  console.log('📖 Reference: docs/LOAD_TEST_SETUP.md');
  console.log('');

  return successCount > 0 ? 0 : 1;
}

// Run the script
generateTestUsers().then((exitCode) => {
  process.exit(exitCode);
}).catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
