import { redirect } from 'next/navigation';

/**
 * Public root — redirect to the admin shell.
 * Middleware handles the /login redirect if the user is not authenticated.
 */
export default function RootPage() {
  redirect('/admin');
}
