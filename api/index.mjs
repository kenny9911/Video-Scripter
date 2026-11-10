// Vercel entry point: every /api/* and /media/* request is rewritten here (see vercel.json).
// Static files in public/ are served by the platform itself.
export { handler as default } from '../server.mjs';
