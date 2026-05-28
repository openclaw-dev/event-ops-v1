import { redirect } from 'next/navigation';

/**
 * /admin/settings — redirect to the first sub-page (KB).
 * The sidebar always links to sub-pages directly.
 */
export default function SettingsPage() {
  redirect('/admin/settings/kb');
}
