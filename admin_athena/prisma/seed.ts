/**
 * Admin Athena - Database Seed Script
 *
 * Creates default roles and admin user.
 *
 * Usage:
 *   # With env vars:
 *   ADMIN_EMAIL=admin@llmatscale.ai ADMIN_PASSWORD=secret ADMIN_NAME="Admin" npx tsx prisma/seed.ts
 *
 *   # Interactive:
 *   npx tsx prisma/seed.ts
 *
 *   # Via npm scripts:
 *   npm run db:seed
 */

import 'dotenv/config';
import { hashPassword } from '../lib/encryption';
import prisma from '../lib/db';
import { ROLE_TEMPLATES } from '../lib/constants/role-templates';
import * as readline from 'node:readline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function prompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Missing required input: "${question.trim()}" ` +
      'Set the corresponding environment variable (ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME) ' +
      'or run in an interactive terminal.'
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Seed Roles
// ---------------------------------------------------------------------------

async function seedRoles(): Promise<string> {
  console.log('\n--- Role Setup ---\n');

  let adminRoleId = '';

  for (const template of ROLE_TEMPLATES) {
    const existing = await prisma.role.findUnique({
      where: { name: template.name },
    });

    if (existing) {
      console.log(`  Role "${template.name}" already exists. Skipping.`);
      if (template.name === 'Admin') adminRoleId = existing.id;
      continue;
    }

    const role = await prisma.role.create({
      data: {
        name: template.name,
        description: template.description,
        isSystemRole: template.isSystemRole,
        permissions: template.permissions,
        allowedModels: template.allowedModels,
        systemInstructions: template.systemInstructions,
        customInstructionsEnabled: template.customInstructionsEnabled,
        customInstructionsMaxLength: template.customInstructionsMaxLength,
        personalMcpEnabled: template.personalMcpEnabled,
        personalMcpMaxCount: template.personalMcpMaxCount,
        dailyRequestLimit: template.dailyRequestLimit,
        dailyTokenLimit: template.dailyTokenLimit,
      },
    });

    console.log(`  Role "${role.name}" created.`);
    if (template.name === 'Admin') adminRoleId = role.id;
  }

  console.log(`\n${ROLE_TEMPLATES.length} roles processed.`);
  return adminRoleId;
}

// ---------------------------------------------------------------------------
// Seed Admin User
// ---------------------------------------------------------------------------

async function seedAdminUser(adminRoleId: string): Promise<void> {
  console.log('\n--- Admin User Setup ---\n');

  const email = process.env.ADMIN_EMAIL || await prompt('Admin email: ');
  const password = process.env.ADMIN_PASSWORD || await prompt('Admin password: ');
  const name = process.env.ADMIN_NAME || await prompt('Admin name: ');

  if (!email || !password || !name) {
    throw new Error('Admin email, password, and name are all required.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    // Upgrade existing user to admin
    if (!existing.isAdmin) {
      await prisma.user.update({
        where: { email },
        data: {
          isAdmin: true,
          roleId: adminRoleId || undefined,
        },
      });
      console.log(`User "${email}" upgraded to Admin.`);
    } else {
      console.log(`Admin "${email}" already exists. Skipping.`);
    }
    return;
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      isAdmin: true,
      roleId: adminRoleId || undefined,
      status: 'ACTIVE',
    },
  });
  console.log(`Admin "${email}" created successfully.`);
}

// ---------------------------------------------------------------------------
// Seed MCP Registry
// ---------------------------------------------------------------------------

async function seedMcpRegistry(): Promise<void> {
  console.log('\n--- MCP Registry ---\n');

  const mcpServers = [
    { displayName: 'CMF - Critical Manufacturing', serverUrl: 'https://sd6ch0xtng.execute-api.us-west-2.amazonaws.com/mcp' },
    { displayName: 'CM MES - Assembly', serverUrl: 'https://9vh4xw2kb1.execute-api.us-west-2.amazonaws.com/mcp' },
    { displayName: 'CM MES - Lab Data', serverUrl: 'https://f09ls0pyr9.execute-api.us-west-2.amazonaws.com/mcp' },
    { displayName: 'Opcenter - Siemens', serverUrl: 'https://rniju3wscb.execute-api.us-west-2.amazonaws.com/mcp' },
    { displayName: 'Opcenter - CoreSi', serverUrl: 'https://bu6num9hr8.execute-api.us-west-2.amazonaws.com/mcp' },
    { displayName: 'PSI Quantum', serverUrl: 'https://fezokoagz5.execute-api.us-west-2.amazonaws.com/mcp' },
    { displayName: 'Lumentum Server', serverUrl: 'https://ocx3mhgaw5.execute-api.us-west-2.amazonaws.com/mcp' },
    { displayName: 'Genealogy', serverUrl: 'https://7rpv3zjs57.execute-api.us-west-2.amazonaws.com/mcp' },
    { displayName: 'Bottleneck Analysis', serverUrl: 'https://5f99aat4n5.execute-api.us-west-2.amazonaws.com/mcp' },
    { displayName: 'Scrap Pareto', serverUrl: 'https://z65vkyrme5.execute-api.us-west-2.amazonaws.com/mcp' },
  ];

  for (const server of mcpServers) {
    await prisma.mcpRegistry.upsert({
      where: { serverUrl: server.serverUrl },
      create: { displayName: server.displayName, serverUrl: server.serverUrl, authType: 'none' },
      update: { displayName: server.displayName },
    });
    console.log(`  MCP "${server.displayName}" registered.`);
  }

  console.log(`\n${mcpServers.length} MCP servers registered.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Admin Athena - Database Seed Script');
  console.log('===================================');

  const adminRoleId = await seedRoles();
  await seedAdminUser(adminRoleId);
  await seedMcpRegistry();

  console.log('\nSeed complete.');
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error.message || error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
