import readline from 'node:readline';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { BootstrapError, createInitialSuperAdmin } from '../services/bootstrap';

const USAGE = `Usage:
  npm run create-super-admin -- --email <email> [--name "<display name>"]

The password is read from the SUPER_ADMIN_PASSWORD environment variable, or
prompted for without echo when run in a terminal. Passwords are never accepted
as command-line arguments.

Environment variables (fallbacks):
  SUPER_ADMIN_EMAIL / BOOTSTRAP_SUPER_ADMIN_EMAIL
  SUPER_ADMIN_NAME / BOOTSTRAP_SUPER_ADMIN_NAME
  SUPER_ADMIN_PASSWORD / BOOTSTRAP_SUPER_ADMIN_PASSWORD`;

function parseArgs(argv: string[]) {
  const out: { email?: string; name?: string; help: boolean } = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--email' || arg === '-e') out.email = argv[++i];
    else if (arg === '--name' || arg === '-n') out.name = argv[++i];
    else if (arg === '--password' || arg === '-p') {
      throw new BootstrapError(
        'Do not pass the password on the command line. Use SUPER_ADMIN_PASSWORD or the interactive prompt.',
      );
    } else {
      throw new BootstrapError(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function readHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new BootstrapError('Cancelled'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on('data', onData);
  });
}

async function readPipedLine(question: string): Promise<string> {
  process.stdout.write(question);
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    process.stdout.write('\n');
    return line;
  }
  throw new BootstrapError('No password was provided on stdin');
}

async function resolvePassword(): Promise<string> {
  const fromEnv = process.env.SUPER_ADMIN_PASSWORD ?? process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;

  if (!process.stdin.isTTY) {
    return readPipedLine('Super Admin password (stdin): ');
  }

  const first = await readHidden('Super Admin password: ');
  const second = await readHidden('Confirm password: ');
  if (first !== second) throw new BootstrapError('Passwords do not match');
  return first;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const email = args.email ?? process.env.SUPER_ADMIN_EMAIL ?? process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
  const name =
    args.name ?? process.env.SUPER_ADMIN_NAME ?? process.env.BOOTSTRAP_SUPER_ADMIN_NAME ?? 'Super Admin';

  if (!email) {
    throw new BootstrapError(`An email address is required.\n\n${USAGE}`);
  }

  const password = await resolvePassword();
  const user = await createInitialSuperAdmin({ email, name, password });

  process.stdout.write(
    [
      '',
      'Initial Super Admin created.',
      `  Email: ${user.email}`,
      `  Role:  ${user.role}`,
      '',
      `Sign in at ${env.APP_URL}/login (or your deployment URL).`,
      '',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\nSuper Admin setup failed: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
