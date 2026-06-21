'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteEvent } from '../actions';

interface DeleteEventButtonProps {
  eventId: string;
  eventName: string;
}

export function DeleteEventButton({ eventId, eventName }: DeleteEventButtonProps) {
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleOpenChange(open: boolean) {
    if (!open) {
      setConfirmName('');
      setDeleteError(null);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteEvent(eventId);
    if (result?.error) {
      setDeleteError(result.error);
      setDeleting(false);
    }
    // On success, deleteEvent calls redirect() — execution stops here.
  }

  return (
    <AlertDialog onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete event
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete event</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete <strong>{eventName}</strong> and all associated data —
            conversations, orders, KB, gate scans, escalations, and payment recovery records.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <Label htmlFor="confirm-event-name" className="text-sm">
            Type <strong>{eventName}</strong> to confirm
          </Label>
          <Input
            id="confirm-event-name"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            className="mt-1.5"
            placeholder={eventName}
            autoComplete="off"
          />
          {deleteError && <p className="mt-1.5 text-xs text-destructive">{deleteError}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirmName !== eventName || deleting}
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? 'Deleting…' : 'Delete event'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
