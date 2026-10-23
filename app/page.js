import { redirect } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  if (!(await isLoggedIn())) redirect('/login');
  return <Dashboard />;
}
