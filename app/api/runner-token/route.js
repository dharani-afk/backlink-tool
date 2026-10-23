import { team } from '@/lib/auth';

// Shown to logged-in team members so they can set up the runner on their PC.
export const GET = team(async () => Response.json({ token: process.env.RUNNER_TOKEN || '' }));
