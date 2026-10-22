import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { env } from './env';

const PgSession = connectPgSimple(session);

export const sessionPool = new Pool({ connectionString: env.DATABASE_URL });

export const sessionMiddleware = session({
  store: new PgSession({
    pool: sessionPool,
    tableName: 'session',
    createTableIfMissing: false,
  }),
  name: 'ims.sid',
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  },
});
